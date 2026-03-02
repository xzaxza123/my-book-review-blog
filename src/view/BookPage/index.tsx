import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type React from "react";
import { useNavigate, useLocation } from "react-router";
import "./index.scss";
import "../../utils/turn.js";
import { useResponsiveBookLayout } from "../../hooks/useResponsiveBookLayout";
import { SinglePageModeNotice } from "../../components/SinglePageModeNotice";
import pageMap from "../../../public/page-map.json"; // 构建时生成的文章元数据
import { routes } from "virtual:react-press-routes"; // 只导入 routes
import { createBlankPage, createPageDiv, wrapPageWithFooter, } from "../../utils/paginate";
import type { ArticleMeta, ArticleStartPageMap, BookmarkDrawerPosition, } from "./bookmarkDrawer";
import { updateLeftBookmarkDrawer, updateRightBookmarkDrawer, } from "./bookmarkDrawer";
import { TOC_ITEMS_PER_PAGE, buildTocPages } from "./toc";
import { buildPrefacePages } from "./preface";
import {
  BOOK_PAGE_CONFIG,
  PREFACE_CONFIG,
  ANIMATION_CONFIG,
  VIRTUAL_IDS,
  ROUTES,
} from "../../config";

// 从配置文件导入常量
const TURN_CONTENT_OFFSET = BOOK_PAGE_CONFIG.TURN_CONTENT_OFFSET;
const ACTUAL_CONTENT_START = BOOK_PAGE_CONFIG.ACTUAL_CONTENT_START;
const ENTER_ANIMATION_DURATION = ANIMATION_CONFIG.ENTER_DURATION;
const EXIT_ANIMATION_DURATION = ANIMATION_CONFIG.EXIT_DURATION;
const BASE_WIDTH = BOOK_PAGE_CONFIG.BASE_WIDTH;
const BASE_HEIGHT = BOOK_PAGE_CONFIG.BASE_HEIGHT;
const PREFACE_VIRTUAL_ID = VIRTUAL_IDS.PREFACE;
const TOC_VIRTUAL_ID = VIRTUAL_IDS.TOC;

type BookTransitionStage = "booting" | "entering" | "idle" | "leaving";

function BookPage() {

  const navigate = useNavigate();
  const location = useLocation();
  const HorizontalBook = useRef<HTMLDivElement>(null);
  const stageTimerRef = useRef<number | null>(null);
  const stageFrameRef = useRef<number | null>(null);
  const [transitionStage, setTransitionStage] = useState<BookTransitionStage>("booting");
  const [isContentLoaded, setIsContentLoaded] = useState(false); // 跟踪内容是否加载完成
  const { deviceInfo, bookDimensions, scaleRatio, reinitializeTurnJS, updateBookScaleRatio } = useResponsiveBookLayout();
  const isDoubleMode = deviceInfo.suggestedBookMode === "double";
  const [showSinglePageNotice, setShowSinglePageNotice] = useState(false);
  
  // 跟踪之前的模式状态，用于检测模式切换
  const prevModeRef = useRef<boolean | null>(null);

  // 当前逻辑页码（包含封面 / 前言 / 目录 / 正文等）
  const [currentLogicalPage, setCurrentLogicalPage] = useState<number>(TURN_CONTENT_OFFSET + 1);

  // 书本总逻辑页数（包含前后封面及所有尾页）
  const [totalLogicalPages, setTotalLogicalPages] = useState<number | null>(null);

  // 左侧书签阈值：目录全部不可见后才允许出现（当前页必须严格大于该阈值）
  const [leftBookmarkThreshold, setLeftBookmarkThreshold] = useState<number | null>(null);

  // 左侧书签抽屉页第4页的位置状态（用于控制抽屉页的显示/隐藏动画）
  const [leftBookmarkPage4Position, setLeftBookmarkPage4Position] = useState<BookmarkDrawerPosition>("hidden");
  // 右侧书签抽屉页倒数第4页的位置状态（用于控制抽屉页的显示/隐藏动画）
  const [rightBookmarkPage4Position, setRightBookmarkPage4Position] = useState<BookmarkDrawerPosition>("hidden");

  // 保存第4页和倒数第4页的原始内容（用于恢复）
  const [originalPage4Content, setOriginalPage4Content] = useState<HTMLElement | null>(null);
  const [originalLastPage4Content, setOriginalLastPage4Content] = useState<HTMLElement | null>(null);

  // 保存 articles 和 articleStartPages，供动态插入书签抽屉页时使用
  const articlesRef = useRef<ArticleMeta[]>([]);
  const articleStartPagesRef = useRef<ArticleStartPageMap>({});

  // 用于防止重复执行书签抽屉操作的 ref
  const isUpdatingLeftBookmarkRef = useRef(false);
  const isUpdatingRightBookmarkRef = useRef(false);
  const leftBookmarkTimeoutRef = useRef<number | null>(null);
  const rightBookmarkTimeoutRef = useRef<number | null>(null);

  // 监听模式切换：当从双页模式切换到单页模式时，销毁书本并跳转首页
  // 当从单页模式切换回双页模式时，如果在 BookPage 路由，也跳转首页
  // 同时处理用户直接进入单页模式的情况
  useEffect(() => {
    const currentMode = isDoubleMode;
    const isOnBookPage = location.pathname === ROUTES.BOOK || location.pathname.startsWith(ROUTES.BOOK + "/");
    let cleanupTimer: ReturnType<typeof setTimeout> | null = null;

    // 初始化时记录当前模式
    if (prevModeRef.current === null) {
      prevModeRef.current = currentMode;
      
      // 如果初始化时就是单页模式，显示提示并跳转首页
      if (!currentMode && isOnBookPage) {
        setShowSinglePageNotice(true);
        cleanupTimer = setTimeout(() => {
          navigate("/");
        }, 1500);
      }
      
      return () => {
        if (cleanupTimer) {
          clearTimeout(cleanupTimer);
        }
      };
    }

    const prevMode = prevModeRef.current;

    // 从双页模式切换到单页模式
    if (prevMode && !currentMode && isOnBookPage) {
      // 先销毁 turn.js 实例
      const element = HorizontalBook.current;
      if (element) {
        const book = $(element);
        if (book && book.turn && book.turn("is")) {
          book.turn("destroy");
        }
      }
      
      // 显示提示并跳转首页
      setShowSinglePageNotice(true);
      cleanupTimer = setTimeout(() => {
        navigate("/");
      }, 1500);
    }

    // 从单页模式切换回双页模式
    if (!prevMode && currentMode && isOnBookPage) {
      // 直接跳转首页，避免双页模式的书本未正确初始化
      navigate("/");
    }

    // 更新之前的模式状态
    prevModeRef.current = currentMode;

    return () => {
      if (cleanupTimer) {
        clearTimeout(cleanupTimer);
      }
    };
  }, [isDoubleMode, navigate, location.pathname]);

  const OperationFooterPages = async (book: JQuery<HTMLElement>) => {
    // 当前书本总页数（包含封面、内容页、右书签抽屉页等）
    let total = book.turn("pages");

    // 保证"倒数第二页为奇数、最后一页为偶数"。
    if (total % 2 !== 0) {
      total += 1;
      book.turn("pages", total);
    }

    const operationFooterPages = [
      `<div class="hard fixed back-side BackCoverTitlePage-1"><div class="depth"></div></div>`,
      `<div class="hard BackCoverTitlePage-2"></div>`,
    ];

    // 先扩容 book 的总页数，给尾部操作页预留空间
    const footerCount = operationFooterPages.length;
    const newTotalPages = total + footerCount;

    book.turn("pages", newTotalPages);

    // 添加封底页
    operationFooterPages.forEach((pageEl, index) => {
      const logicalPage = total + index + 1; // 从 total 之后的下一页开始追加
      const pageElDom = $(pageEl);
      pageElDom.attr("data-page-number", String(logicalPage));
      book.turn("addPage", pageElDom, logicalPage);
    });

    // 立即同步总页数到 React 状态，不等待渲染
    // 这样可以确保状态更新及时，UI 可以立即响应
    setTotalLogicalPages(newTotalPages);

    // 等待 turn.js 完成 DOM 更新和渲染
    // 使用 requestAnimationFrame 确保浏览器完成渲染
    // 注意：这个等待不会阻塞状态更新，只是确保视觉上页面已经渲染完成
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });
  };

  // 全局书本分页：为所有文章依次做分页，并将页面挂载到 turn.js，同一本书中连续展示
  useEffect(() => {
    // 单页模式下不执行分页逻辑
    if (!isDoubleMode) {
      return;
    }

    const element = HorizontalBook.current;
    if (!element) return;

    const book = $(element);
    if (!book || !book.turn || !book.turn("is")) return;

    let cancelled = false;

    // 目录项和书签抽屉项点击事件处理函数（事件委托）
    const handleTocItemClick = (e: Event) => {
      const target = e.target as HTMLElement;
      // 查找最近的目录项元素（可能是点击了目录项内的子元素）
      const tocItem = target.closest<HTMLLIElement>(
        ".book-toc-page__item--clickable, .bookmark-drawer-toc-item--clickable, .bookmark-drawer-search-result-item--clickable"
      );

      if (tocItem) {
        const targetPageStr = tocItem.dataset.targetPage;
        const logicalPage = targetPageStr ? Number(targetPageStr) : NaN;

        if (!Number.isNaN(logicalPage) && book && book.turn && book.turn("is")) {
          e.preventDefault();
          e.stopPropagation();
          book.turn("page", logicalPage);
        }
      }
    };

    const articles = (pageMap as ArticleMeta[]).filter((a) => !!a.id);

    const run = async () => {
      try {
        const {
          paginateArticle,
          getCachedArticlePages,
        } = await import("../../core/pagination/articlePaginator");

        // 记录当前已经占用的内容逻辑页索引（从 1 开始递增）
        let nextContentIndex = 1;

        const attachPages = async (
          pages: HTMLElement[],
          options?: { title?: string; skipFooter?: boolean; isLastArticle?: boolean }
        ) => {

          // 页面内容在传递给 attachPages 时已经渲染完成（在 articlePaginator.ts 中完成）
          // 所以不需要在每个页面上等待 React 渲染
          for (const pageEl of pages) {
            // 内容页从第3页开始（跳过封面2页），turn.js会自动处理书签抽屉页的插入
            const logicalPage = ACTUAL_CONTENT_START + nextContentIndex;

            // 页码从前言开始为1，所以需要减去偏移量
            const displayPageNumber = nextContentIndex;
            nextContentIndex += 1;

            const pageTitle =
              options?.title && options.title.trim().length > 0
                ? options.title
                : "未命名内容";

            // 为除封面和书签抽屉页以外的内容页统一增加"内层容器 + 页脚"
            // 页脚显示的页码从1开始（从前言开始）
            if (!options?.skipFooter) {
              wrapPageWithFooter(pageEl, displayPageNumber, pageTitle);
            }

            pageEl.setAttribute("data-page-number", String(logicalPage));
            pageEl.setAttribute("class", "own-size");

            const currentTotal = book.turn("pages");
            if (logicalPage > currentTotal) {
              book.turn("pages", logicalPage);
            }

            if (!book.turn("hasPage", logicalPage)) {

              if (options?.isLastArticle && pages.length >= 2) {
                
                if (pageEl === pages[pages.length - 2]) {
                  if(Number($(pageEl).attr("data-page-number")) %2 !== 0){
                    $(pageEl).addClass("fixed");
                  };
                }

                if (pageEl === pages[pages.length - 1]) {
                  if(Number($(pageEl).attr("data-page-number")) %2 !== 0){
                    $(pageEl).addClass("fixed");
                  };
                }

              }

              book.turn("addPage", pageEl, logicalPage);
            }
          }

          // 批量添加完成后，等待一次浏览器渲染完成
          // 这样可以减少等待次数，提高性能
          await new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                resolve();
              });
            });
          });
        };

        // 1. 预先确保所有文章都已经完成分页（命中缓存则不会重复计算）
        const articlePageCounts = new Map<string, number>();
        for (const article of articles) {
          if (cancelled) break;

          let cached = getCachedArticlePages(article.id);
          if (!cached) {
            const r = routes.find((r) => r.id === article.id);
            const articleLoader = r?.loader;
            if (!articleLoader) continue;

            cached = await paginateArticle(article.id, articleLoader, {
              baseWidth: BASE_WIDTH,
              baseHeight: BASE_HEIGHT,
            });
          }

          if (cached) {
            articlePageCounts.set(article.id, cached.pages.length);
          }
        }

        if (cancelled) {
          return;
        }

        // 2. 基于配置与文章页数，计算前言 / 目录 / 各文章的起始“逻辑页码”，并缓存到 sessionStorage
        const articleStartPages: ArticleStartPageMap = {};

        // 2.1 规范化前言总页数：必须为偶数，且至少为 2（启用时）
        const rawPrefaceTotal =
          PREFACE_CONFIG.enabled && PREFACE_CONFIG.totalPages > 0
            ? PREFACE_CONFIG.totalPages
            : 0;
        let prefacePageCount =
          rawPrefaceTotal > 0 ? rawPrefaceTotal : 0;
        if (prefacePageCount % 2 !== 0) {
          prefacePageCount += 1;
        }

        // 2.2 计算目录条目总数：前言（若有） + 目录本身 + 所有文章
        const tocItemsCount =
          (prefacePageCount > 0 ? 1 : 0) + 1 + articles.length;

        const tocPageCount = Math.ceil(
          tocItemsCount / Math.max(1, TOC_ITEMS_PER_PAGE)
        );

        // 2.3 前言起始页：封面之后的第 1 个内容页（第3页）
        if (prefacePageCount > 0) {
          articleStartPages[PREFACE_VIRTUAL_ID] =
            ACTUAL_CONTENT_START + 1;
        }

        // 2.4 目录起始页：紧随前言之后
        const tocStartLogicalPage =
          ACTUAL_CONTENT_START + prefacePageCount + 1;
        articleStartPages[TOC_VIRTUAL_ID] = tocStartLogicalPage;

        // 2.5 各文章起始页：位于"前言 + 目录"之后
        let currentContentIndex = prefacePageCount + tocPageCount + 1;
        for (const article of articles) {
          const count = articlePageCounts.get(article.id) || 0;
          if (count <= 0) continue;

          const logicalStartPage = ACTUAL_CONTENT_START + currentContentIndex;
          articleStartPages[article.id] = logicalStartPage;
          currentContentIndex += count;
        }

        // 如有需要，可在此处将 articleStartPages 持久化到 sessionStorage

        // 保存 articles 和 articleStartPages 到 ref，供动态插入书签抽屉页时使用
        articlesRef.current = articles;
        articleStartPagesRef.current = articleStartPages;

        // 根据起始页信息预计算左侧书签的出现阈值：
        // 规则：当目录页（可能跨多页）完全不可见后，再往后翻四页，左书签才可以出现。
        // 也就是当前逻辑页必须严格大于"目录最后一页 + 4"的页码。
        // 如果目录后四页以后的所有页符合阈值条件，那么目录后四页的前面所有页都不符合阈值条件。
        if (!cancelled) {
          const tocLastLogicalPage =
            tocPageCount > 0 ? tocStartLogicalPage + tocPageCount - 1 : 0;

          const leftThreshold =
            tocLastLogicalPage > 0 ? tocLastLogicalPage + 4 : null;

          setLeftBookmarkThreshold(leftThreshold);
        }

        // 3. 先生成并插入前言页（可选）
        if (prefacePageCount > 0) {
          const prefacePages = await buildPrefacePages(
            BASE_WIDTH,
            BASE_HEIGHT,
            prefacePageCount
          );

          if (prefacePages.length > 0) {
            await attachPages(prefacePages, { title: "前言" });
          }
        }

        // 5. 生成并插入目录页，目录项包含：前言 / 目录本身 / 文章
        if (articles.length > 0 || prefacePageCount > 0) {
          const tocPages = await buildTocPages(articles, articleStartPages, {
            baseWidth: BASE_WIDTH,
            baseHeight: BASE_HEIGHT,
            itemsPerPage: TOC_ITEMS_PER_PAGE,
            contentStartOffset: ACTUAL_CONTENT_START,
          });

          if (tocPages.length > 0) {
            await attachPages(tocPages, { title: "目录" });
          }
        }

        // 6. 顺序插入所有文章内容页（此时都应已在缓存中）
        for (let i = 0; i < articles.length; i++) {
          if (cancelled) break;
          const article = articles[i];
          const cached = getCachedArticlePages(article.id);
          if (cached) {
            const articleTitle =
              article.title || article.path || article.id || "未命名内容";
            // 判断是否是最后一篇文章
            const isLastArticle = i === articles.length - 1;
            await attachPages(cached.pages, { title: articleTitle, isLastArticle });
          }
        }

        if (!cancelled) {
          // 7. 所有内容（前言 + 目录 + 文章）添加完成后，检查最后一页的奇偶性，决定是否需要添加"全书完"页
          // 目标：保证倒数第2页为奇数，倒数第1页为偶数
          // 如果倒数第2页是偶数，倒数第1页是奇数，则需要添加"全书完"页来调整
          const lastContentPage = ACTUAL_CONTENT_START + (nextContentIndex - 1);
          const secondLastContentPage =
            ACTUAL_CONTENT_START + (nextContentIndex - 2);

          // 只有当至少有一页内容时才需要检查
          if (nextContentIndex > 1) {
            const lastIsEven = lastContentPage % 2 === 0;
            const secondLastIsEven = secondLastContentPage % 2 === 0;

            // 如果倒数第2页是偶数，倒数第1页是奇数，需要添加"全书完"页
            if (secondLastIsEven && !lastIsEven) {
              const endPage = createBlankPage(
                BASE_WIDTH,
                BASE_HEIGHT,
                "—— 全书完 ——"
              );
              await attachPages([endPage], { title: "全书完" });
            }
          }

          // 8. 最后添加封底页（函数内部已包含等待逻辑）
          // 注意：在 OperationFooterPages 内部，会在添加封底页之前为倒数第四页添加 fixed 类
          await OperationFooterPages(book);

          // 9. 所有页面构建完成后，使用事件委托为目录项绑定点击事件：点击跳转到对应内容页
          // 使用事件委托可以避免 DOM 更新导致的事件丢失问题
          // 在容器上绑定事件委托
          element.addEventListener("click", handleTocItemClick);

          // 标记内容加载完成，触发入场动画
          setIsContentLoaded(true);
        }

      } catch (err) {
        console.error("全局分页流程异常", err);
        // 即使出错也标记为加载完成，避免一直停留在 booting 状态
        setIsContentLoaded(true);
      }
    };

    run();

    return () => {
      cancelled = true;
      // 清理事件监听器
      if (element) {
        element.removeEventListener("click", handleTocItemClick);
      }
    };
  }, []);

  //初始化书本
  useLayoutEffect(() => {
    // 单页模式下不初始化书本
    if (!isDoubleMode) {
      return;
    }

    const element = HorizontalBook.current;

    if (!element) {
      return;
    }

    if (stageTimerRef.current !== null) {
      window.clearTimeout(stageTimerRef.current);
      stageTimerRef.current = null;
    }
    if (stageFrameRef.current !== null) {
      cancelAnimationFrame(stageFrameRef.current);
      stageFrameRef.current = null;
    }

    // 双页模式：先保持桌面态，等 turn.js 初始化并定位到展开页后再入场
    setTransitionStage(isDoubleMode ? "booting" : "idle");

    // 初始化或重新初始化turn.js，不再把页码同步到路由，仅在内部管理阅读进度
    // 在翻页过程中同步当前逻辑页码，供侧边书签的阈值控制使用（更及时）
    // 在翻页完成时也同步一次，确保状态一致性
    reinitializeTurnJS(
      element, 
      bookDimensions, 
      (logicalPage) => {
        // 翻页完成时同步，确保状态一致性
        setCurrentLogicalPage(logicalPage);
      },
      (logicalPage) => {
        // 翻页过程中同步，及时进行阈值判断
        setCurrentLogicalPage(logicalPage);
      }
    );

    const book = $(element);
    const $doc = $(document);

    if(book && book.turn && book.turn("is")){
      $(book).css("transform", `scale(${scaleRatio})`);
    }

    // 键盘箭头导航(翻页) - 使用推荐的 .on 事件绑定方式
    const handleKeyDown = (e: JQuery.KeyDownEvent) => {
      const previous = 37;
      const next = 39;

      switch (e.which) {
        case previous:
          book.turn("previous");
          break;
        case next:
          book.turn("next");
          break;
      }
    };

    // 监听整个文档的键盘事件，不依赖具体元素焦点
    $doc.on("keydown", handleKeyDown);

    return () => {
      if (stageFrameRef.current !== null) {
        cancelAnimationFrame(stageFrameRef.current);
        stageFrameRef.current = null;
      }
      if (stageTimerRef.current !== null) {
        window.clearTimeout(stageTimerRef.current);
        stageTimerRef.current = null;
      }

      // 解绑键盘事件，避免内存泄漏
      $doc.off("keydown", handleKeyDown);
    };

  }, [isDoubleMode, reinitializeTurnJS, navigate]);

  // 监听 scaleRatio 变化，更新 turn.js 内部的 scaleRatio 以重新计算交互坐标
  useEffect(() => {
    if (!isDoubleMode) {
      return;
    }

    const element = HorizontalBook.current;
    if (element && scaleRatio > 0) {
      const $element = $(element);
      // 如果书本已经初始化，更新 scaleRatio 而不重新初始化

      if ($element.turn('is')) {
        updateBookScaleRatio(element, scaleRatio);
        $element.css("transform", `scale(${scaleRatio})`);
      }
    }
  }, [scaleRatio, isDoubleMode, updateBookScaleRatio]);

  // 监听内容加载完成状态，在双页模式下启动入场动画
  useEffect(() => {
    if (!isDoubleMode || !isContentLoaded) {
      return;
    }

    const element = HorizontalBook.current;
    if (!element) {
      return;
    }

    const book = $(element);
    if (!book || !book.turn || !book.turn("is")) {
      return;
    }

    // 清理之前的定时器
    if (stageTimerRef.current !== null) {
      window.clearTimeout(stageTimerRef.current);
      stageTimerRef.current = null;
    }
    if (stageFrameRef.current !== null) {
      cancelAnimationFrame(stageFrameRef.current);
      stageFrameRef.current = null;
    }

    // 双页进入时默认落在展开的第一页，避免闭合态突兀出现。
    // 现在内容已经加载完成，可以安全地执行动画
    stageTimerRef.current = window.setTimeout(() => {
      const pageCount = book.turn("pages");

      if (pageCount >= 2) {
        book.turn("page", 2);
      }
      book.turn("center");

      // 等待一帧确保 DOM 更新完成
      stageFrameRef.current = requestAnimationFrame(() => {
        setTransitionStage("entering");
        stageTimerRef.current = window.setTimeout(() => {
          setTransitionStage("idle");
        }, ENTER_ANIMATION_DURATION);
      });
    }, 40);

    return () => {
      if (stageFrameRef.current !== null) {
        cancelAnimationFrame(stageFrameRef.current);
        stageFrameRef.current = null;
      }
      if (stageTimerRef.current !== null) {
        window.clearTimeout(stageTimerRef.current);
        stageTimerRef.current = null;
      }
    };
  }, [isDoubleMode, isContentLoaded]);

  // 离开当前页面 / 路由时销毁 turn.js 实例
  useEffect(() => {
    // 在 effect 执行时就捕获当前 DOM 引用，避免卸载阶段 ref 已被置空
    const element = HorizontalBook.current;
    if (!element) return;

    return () => {
      const book = $(element);

      // 仅在实例已初始化时才调用 destroy，避免报错
      if (book && book.turn && book.turn("is")) {
        book.turn("destroy");
      }
    };
  }, []);

  // 退出当前页，回到首页
  const handleCloseClick = () => {
    // 单页模式下无需 3D 离场动画，直接返回首页
    if (!isDoubleMode) {
      navigate("/");
      return;
    }

    if (transitionStage === "leaving" || transitionStage === "booting") return;

    setTransitionStage("leaving");
    if (stageTimerRef.current !== null) {
      window.clearTimeout(stageTimerRef.current);
    }
    stageTimerRef.current = window.setTimeout(() => {
      navigate("/");
    }, EXIT_ANIMATION_DURATION);
  };

  // 当前书本是否处于"完全展开"的中间态（不是第一页，也不是最后一页）
  const isBookSpreadOpen = totalLogicalPages !== null && currentLogicalPage > 1 && currentLogicalPage < totalLogicalPages;

  // 计算倒数第4页的页码
  const lastPage4Number = totalLogicalPages !== null ? totalLogicalPages - 3 : null;

  // 是否允许显示左侧书签抽屉页：
  // 1. 必须书本已展开
  // 2. 必须已经完全翻过目录（当前逻辑页 > 阈值）
  // 3. 当前页必须 > 4（正数第四页之后）
  // 4. 当前页必须 < 倒数第4页（倒数第四页之前）
  const canShowLeftBookmarkPages = 
    isBookSpreadOpen && 
    leftBookmarkThreshold !== null && 
    currentLogicalPage > leftBookmarkThreshold &&
    currentLogicalPage > 4 &&
    (lastPage4Number === null || currentLogicalPage < lastPage4Number);

  // 是否允许显示右侧书签抽屉页：
  // 1. 必须书本已展开
  // 2. 当前页必须 < 倒数第4页再往前6页（倒数第四页之前6页，即倒数第10页之前）
  // 3. 当前页必须 > 4（正数第四页之后）
  const canShowRightBookmarkPages = 
    isBookSpreadOpen && 
    totalLogicalPages !== null && 
    lastPage4Number !== null &&
    currentLogicalPage < lastPage4Number - 6 &&
    currentLogicalPage > 4;

  // 控制左书签抽屉页的内容替换和位置
  // 每次翻页完成后（currentLogicalPage 变化时）或阈值条件变化时触发阈值判断
  // 注意：不依赖 leftBookmarkPage4Position，避免状态变化导致循环执行
  useEffect(() => {
    const element = HorizontalBook.current;
    if (!element) return;

    const book = $(element);
    if (!book || !book.turn || !book.turn("is")) return;

    updateLeftBookmarkDrawer({
      element,
      book,
      canShowLeftBookmarkPages,
      leftBookmarkPage4Position,
      setLeftBookmarkPage4Position,
      baseWidth: BASE_WIDTH,
      baseHeight: BASE_HEIGHT,
      articles: articlesRef.current,
      articleStartPages: articleStartPagesRef.current,
      contentStartOffset: ACTUAL_CONTENT_START,
      originalPage4Content,
      setOriginalPage4Content,
      isUpdatingRef: isUpdatingLeftBookmarkRef,
      timeoutRef: leftBookmarkTimeoutRef,
    }).catch((error) => {
      console.error("Failed to update left bookmark drawer:", error);
      isUpdatingLeftBookmarkRef.current = false;
    });

  }, [currentLogicalPage, canShowLeftBookmarkPages, originalPage4Content]);

  // 控制右书签抽屉页的内容替换和位置
  // 每次翻页完成后（currentLogicalPage 变化时）或阈值条件变化时触发阈值判断
  // 注意：不依赖 rightBookmarkPage4Position，避免状态变化导致循环执行
  useEffect(() => {
    const element = HorizontalBook.current;
    if (!element) return;

    const book = $(element);
    if (!book || !book.turn || !book.turn("is")) return;

    updateRightBookmarkDrawer({
      element,
      book,
      canShowRightBookmarkPages,
      rightBookmarkPage4Position,
      totalLogicalPages,
      baseWidth: BASE_WIDTH,
      baseHeight: BASE_HEIGHT,
      articles: articlesRef.current,
      articleStartPages: articleStartPagesRef.current,
      contentStartOffset: ACTUAL_CONTENT_START,
      setRightBookmarkPage4Position,
      originalLastPage4Content,
      setOriginalLastPage4Content,
      isUpdatingRef: isUpdatingRightBookmarkRef,
      timeoutRef: rightBookmarkTimeoutRef,
    }).catch((error) => {
      console.error("Failed to update right bookmark drawer:", error);
      isUpdatingRightBookmarkRef.current = false;
    });
  }, [
    currentLogicalPage,
    canShowRightBookmarkPages,
    totalLogicalPages,
    originalLastPage4Content,
  ]);

  // 当用户点击书签切换状态时，只更新位置，不执行其他操作
  useEffect(() => {
    const element = HorizontalBook.current;
    if (!element) return;

    const book = $(element);
    if (!book || !book.turn || !book.turn("is")) return;

    // 如果正在执行更新操作，跳过位置更新
    if (isUpdatingLeftBookmarkRef.current) return;

    // 只在状态是 bookmark 或 drawer 时更新位置
    if (leftBookmarkPage4Position === "bookmark" || leftBookmarkPage4Position === "drawer") {
      const page4 = element.querySelector(`[data-page-number="4"]`) as HTMLElement | null;
      const page4Father = element.querySelector(`[page="4"]`) as HTMLElement | null;

      if (page4 && page4.hasAttribute("data-bookmark-side") && page4Father) {
        page4Father.style.transition = "transform 1s ease";
        if (leftBookmarkPage4Position === "drawer") {

          page4Father.style.transform = "translateX(-70.5%)";
          let DelayedExecution = window.setTimeout(() => {
            if (page4Father) {
              $(page4Father).addClass("bookmark-page-Zindex");
            }
            clearTimeout(DelayedExecution);
          }, 1000);

        } else {

          $(page4Father).removeClass("bookmark-page-Zindex");
          page4Father.style.transform = "translateX(-20%)";

        }
      }
    }
  }, [leftBookmarkPage4Position]);

  // 当用户点击书签切换状态时，只更新位置，不执行其他操作
  useEffect(() => {
    const element = HorizontalBook.current;
    if (!element) return;

    const book = $(element);
    if (!book || !book.turn || !book.turn("is")) return;

    // 如果正在执行更新操作，跳过位置更新
    if (isUpdatingRightBookmarkRef.current) return;

    // 只在状态是 bookmark 或 drawer 时更新位置
    if (rightBookmarkPage4Position === "bookmark" || rightBookmarkPage4Position === "drawer") {
      if (!totalLogicalPages) return;
      const currentTotal = book.turn("pages");
      const lastPage4Number = currentTotal - 3;
      const page4 = element.querySelector(`[data-page-number="${lastPage4Number}"]`) as HTMLElement | null;
      const page4Father = element.querySelector(`[page="${lastPage4Number}"]`) as HTMLElement | null;

      if (page4 && page4.hasAttribute("data-bookmark-side") && page4Father) {
        page4Father.style.transition = "transform 1s ease";
        if (rightBookmarkPage4Position === "drawer") {
          page4Father.style.transform = "translateX(70.5%)";

          let DelayedExecution = window.setTimeout(() => {
            if (page4Father) {
              $(page4Father).addClass("bookmark-page-Zindex");
            }
            clearTimeout(DelayedExecution);
          }, 1000);

        } else {

          $(page4Father).removeClass("bookmark-page-Zindex");
          page4Father.style.transform = "translateX(20%)";

        }
      }
    }
  }, [rightBookmarkPage4Position, totalLogicalPages]);

  // 组件卸载时清理 setTimeout
  useEffect(() => {
    return () => {
      if (leftBookmarkTimeoutRef.current !== null) {
        clearTimeout(leftBookmarkTimeoutRef.current);
        leftBookmarkTimeoutRef.current = null;
      }
      if (rightBookmarkTimeoutRef.current !== null) {
        clearTimeout(rightBookmarkTimeoutRef.current);
        rightBookmarkTimeoutRef.current = null;
      }
      isUpdatingLeftBookmarkRef.current = false;
      isUpdatingRightBookmarkRef.current = false;
    };
  }, []);

  // 如果是单页模式，只显示提示，不渲染书本内容
  if (!isDoubleMode) {
    return (
      <div className={`BookPageOverlay BookPageOverlay--idle`}>
        <SinglePageModeNotice
          visible={showSinglePageNotice}
          onClose={() => setShowSinglePageNotice(false)}
        />
      </div>
    );
  }

  return (
    <div className={`BookPageOverlay BookPageOverlay--${transitionStage} ${isDoubleMode ? "is-double" : "is-single"}`}>
      <button
        type="button"
        className="BookPageOverlay__close-button"
        onClick={handleCloseClick}
      >
        返回首页
      </button>

      <div id="canvas" className={`BookPageCanvas BookPageCanvas--${transitionStage}`}>
        <div className="book-page">

          <div
            ref={HorizontalBook}
            className="sj-book animated"
            style={{
              transform: `scale(${scaleRatio})`,
              transformOrigin: 'center center',
            }}
          >
            <div className="hard"></div>
            <div className="hard front-side"><div className="depth"></div></div>
          </div>

        </div>
      </div>
    </div>
  );
}

export default BookPage;



