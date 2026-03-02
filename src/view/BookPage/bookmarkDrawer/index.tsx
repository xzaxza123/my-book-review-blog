import React, { useEffect, useRef, useState, useMemo } from "react";
import { createPageDiv } from "../../../utils/paginate";
import { renderJsxToPage, renderJsxToDom } from "../../../utils/jsxToDom";
import { createRoot, Root } from "react-dom/client";

// 存储 React root 引用的 WeakMap，用于正确清理
const reactRootMap = new WeakMap<HTMLElement, Root>();
import "./index.scss";
import LeftBookmarkImg from "../../../assets/img/Left-Bookmark.png";
import RightBookmarkImg from "../../../assets/img/Right-Bookmark.png";
import { PREFACE_VIRTUAL_ID, TOC_VIRTUAL_ID } from "../toc";
import { getCachedArticlePages } from "../../../core/pagination/articlePaginator";

// 节流函数：限制函数在指定时间间隔内只能执行一次
function throttle<T extends (...args: any[]) => void>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let lastExecTime = 0;
  return function (this: any, ...args: Parameters<T>) {
    const now = Date.now();
    if (now - lastExecTime >= delay) {
      lastExecTime = now;
      func.apply(this, args);
    }
  };
}

// 文章元信息，与分页和目录/书签抽屉相关
export type ArticleMeta = {
  id: string;
  path: string;
  title: string;
  meta?: Record<string, any>;
};

export type ArticleStartPageMap = Record<string, number>;

// 书签抽屉第 4 页的位置状态
export type BookmarkDrawerPosition = "hidden" | "bookmark" | "drawer";

type SetStateAction<T> = React.Dispatch<React.SetStateAction<T>>;

// 注意：由于改为替换页面内容而非添加页面，不再需要页码偏移计算

// 左书签抽屉页组件 Props
interface LeftBookmarkDrawerPageProps {
  articles: ArticleMeta[];
  articleStartPages: ArticleStartPageMap;
  contentStartOffset: number; // 内容页起始偏移量（用于将逻辑页码转换为显示页码）
}

// 目录列表项组件
function TocListItem({
  entry,
  index,
  articleStartPages,
  contentStartOffset,
}: {
  entry: { id: string; title: string };
  index: number;
  articleStartPages: ArticleStartPageMap;
  contentStartOffset: number;
}) {
  const startPage = articleStartPages[entry.id];
  const hasValidStartPage = typeof startPage === "number" && !Number.isNaN(startPage);
  const displayPage = hasValidStartPage ? startPage - contentStartOffset : null;

  return (
    <li
      className={`bookmark-drawer-toc-item ${hasValidStartPage ? "bookmark-drawer-toc-item--clickable" : ""}`}
      {...(hasValidStartPage && {
        "data-target-page": String(startPage), // 跳转使用逻辑页码
      })}
    >
      <span className="bookmark-drawer-toc-item__title">{entry.title}</span>
      <span className="bookmark-drawer-toc-item__page">
        {displayPage !== null ? String(displayPage) : "-"}
      </span>
    </li>
  );
}

// 左书签抽屉页组件
function LeftBookmarkDrawerPage({
  articles,
  articleStartPages,
  contentStartOffset,
}: LeftBookmarkDrawerPageProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // 构建目录条目列表：前言（若存在）、目录本身、所有文章
  const tocEntries = useMemo(() => {
    const entries: Array<{ id: string; title: string }> = [];

    if (typeof articleStartPages[PREFACE_VIRTUAL_ID] === "number") {
      entries.push({
        id: PREFACE_VIRTUAL_ID,
        title: "前言",
      });
    }

    if (typeof articleStartPages[TOC_VIRTUAL_ID] === "number") {
      entries.push({
        id: TOC_VIRTUAL_ID,
        title: "目录",
      });
    }

    for (const article of articles) {
      entries.push({
        id: article.id,
        title: article.title || article.path || article.id,
      });
    }

    return entries;
  }, [articles, articleStartPages]);

  return (
    <div className="bookmark-drawer-page-Left">
      <div className="bookmark-drawer-page-Left__Bookmark">
        <img src={LeftBookmarkImg} alt="左书签" />
      </div>

      <div className="bookmark-drawer-page-Left__Drawer">
        <div className="bookmark-drawer-toc">
          <div className="bookmark-drawer-toc__header">目录</div>
          <div className="bookmark-drawer-toc__list-container" ref={scrollContainerRef}>
            <ul className="bookmark-drawer-toc__list">
              {tocEntries.map((entry, index) => (
                <TocListItem
                  key={entry.id}
                  entry={entry}
                  index={index}
                  articleStartPages={articleStartPages}
                  contentStartOffset={contentStartOffset}
                />
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

// 构建左书签抽屉页面（第 4 页）：包含目录内容
export async function buildLeftBookmarkDrawerPage(
  baseWidth: number,
  baseHeight: number,
  articles: ArticleMeta[],
  articleStartPages: ArticleStartPageMap,
  contentStartOffset: number = 2 // 默认内容页起始偏移量为 2
): Promise<HTMLElement> {

  const jsxElement = (
    <LeftBookmarkDrawerPage
      articles={articles}
      articleStartPages={articleStartPages}
      contentStartOffset={contentStartOffset}
    />
  );

  const { element: page, renderPromise } = renderJsxToPage(jsxElement, baseWidth, baseHeight);
  // 等待 React 渲染完成
  await renderPromise;
  // 初始状态不再强制加 fixed，是否需要固定由运行时根据当前视图范围动态控制
  page.setAttribute("class", "own-size bookmark-drawer-page");
  page.setAttribute("data-bookmark-side", "left");
  page.setAttribute("data-bookmark-index", "4");

  return page;
}

// 搜索结果项类型
interface SearchResultItem {
  articleId: string;
  articleTitle: string;
  pageNumber: number; // 逻辑页码
  displayPageNumber: number; // 显示页码
  snippet: string; // 匹配的文本片段
  matchIndex: number; // 匹配位置
}

// 右书签抽屉页组件 Props
interface RightBookmarkDrawerPageProps {
  articles: ArticleMeta[];
  articleStartPages: ArticleStartPageMap;
  contentStartOffset: number;
}

// 右书签抽屉页组件
function RightBookmarkDrawerPage({
  articles,
  articleStartPages,
  contentStartOffset,
}: RightBookmarkDrawerPageProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 从DOM中提取文本内容
  const extractTextFromPages = (pages: HTMLElement[]): string => {
    return pages
      .map((page) => {
        // 克隆页面以避免修改原始DOM
        const clone = page.cloneNode(true) as HTMLElement;
        // 移除页脚等不需要搜索的元素
        const footer = clone.querySelector(".page-footer");
        if (footer) footer.remove();
        return clone.innerText || clone.textContent || "";
      })
      .join(" ");
  };

  // 执行搜索
  const performSearch = async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    const results: SearchResultItem[] = [];
    const lowerQuery = query.toLowerCase();

    try {
      // 遍历所有文章
      for (const article of articles) {
        const cached = getCachedArticlePages(article.id);
        if (!cached) continue;

        const articleText = extractTextFromPages(cached.pages);
        const lowerText = articleText.toLowerCase();

        // 查找所有匹配位置
        let searchIndex = 0;
        while ((searchIndex = lowerText.indexOf(lowerQuery, searchIndex)) !== -1) {
          // 确定匹配位置所在的页码
          // 需要按页计算字符位置，找到匹配位置所在的页码
          let charCount = 0;
          let pageIndex = 0;
          for (let i = 0; i < cached.pages.length; i++) {
            const pageText = extractTextFromPages([cached.pages[i]]);
            const nextCharCount = charCount + pageText.length;
            // 如果搜索索引在当前页的字符范围内（包含边界）
            if (searchIndex >= charCount && searchIndex < nextCharCount) {
              pageIndex = i;
              break;
            }
            charCount = nextCharCount;
          }

          // 获取文章起始页码
          const articleStartPage = articleStartPages[article.id];
          if (typeof articleStartPage !== "number" || Number.isNaN(articleStartPage)) {
            searchIndex++;
            continue;
          }

          // 计算逻辑页码（文章起始页 + 文章内页号）
          const logicalPage = articleStartPage + pageIndex;
          const displayPage = logicalPage - contentStartOffset;

          // 提取匹配片段（前后各50个字符）
          const start = Math.max(0, searchIndex - 50);
          const end = Math.min(articleText.length, searchIndex + query.length + 50);
          let snippet = articleText.substring(start, end);
          if (start > 0) snippet = "..." + snippet;
          if (end < articleText.length) snippet = snippet + "...";

          results.push({
            articleId: article.id,
            articleTitle: article.title || article.path || article.id,
            pageNumber: logicalPage,
            displayPageNumber: displayPage,
            snippet: snippet.trim(),
            matchIndex: searchIndex,
          });

          searchIndex++;
        }
      }

      setSearchResults(results);
    } catch (error) {
      console.error("[Search] 搜索失败", error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  // 防抖搜索
  useEffect(() => {

    const timer = setTimeout(() => {
      performSearch(searchQuery);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // React 事件处理器
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  return (
    <div className="bookmark-drawer-page-Right">
      <div className="bookmark-drawer-page-Right__Drawer">
        <div className="bookmark-drawer-search">
          <div className="bookmark-drawer-search__header">搜索</div>

          <div className="bookmark-drawer-search__input-container">
            
            <input
              ref={inputRef}
              type="text"
              className="bookmark-drawer-search__input"
              placeholder="搜索文章内容..."
              value={searchQuery}
              onChange ={handleSearchChange}
            />

            {isSearching && (
              <div className="bookmark-drawer-search__loading">搜索中...</div>
            )}

          </div>

          <div className="bookmark-drawer-search__results-container" ref={scrollContainerRef}>
            {searchQuery && !isSearching && (
              <div className="bookmark-drawer-search__results-count">
                找到 {searchResults.length} 个结果
              </div>
            )}
            {searchResults.length > 0 ? (
              <ul className="bookmark-drawer-search__results-list">
                {searchResults.map((result, index) => (
                  <li
                    key={`${result.articleId}-${result.pageNumber}-${index}`}
                    className="bookmark-drawer-search-result-item bookmark-drawer-search-result-item--clickable"
                    data-target-page={String(result.pageNumber)}
                  >
                    <div className="bookmark-drawer-search-result-item__header">
                      <span className="bookmark-drawer-search-result-item__title">
                        {result.articleTitle}
                      </span>
                      <span className="bookmark-drawer-search-result-item__page">
                        第 {result.displayPageNumber} 页
                      </span>
                    </div>
                    <div className="bookmark-drawer-search-result-item__snippet">
                      {result.snippet}
                    </div>
                  </li>
                ))}
              </ul>
            ) : searchQuery && !isSearching ? (
              <div className="bookmark-drawer-search__no-results">未找到匹配结果</div>
            ) : null}
          </div>

        </div>
      </div>

      <div className="bookmark-drawer-page-Right__Bookmark">
        <img src={RightBookmarkImg} alt="右书签" />
      </div>
    </div>
  );
}

// 安全地清理 React root
async function safelyUnmountReactRoot(container: HTMLElement): Promise<void> {
  const existingRoot = reactRootMap.get(container);
  if (existingRoot) {
    try {
      existingRoot.unmount();
      // 等待 React 完成卸载操作，确保 DOM 节点被正确移除
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      });
    } catch (error) {
      // 如果容器已经被清空或修改，unmount 可能会失败，忽略错误
      console.warn('[BookmarkDrawer] Failed to unmount React root:', error);
    }
    reactRootMap.delete(container);
  }
}

// 重新渲染右书签抽屉组件到已存在的 DOM 元素
async function reRenderRightBookmarkDrawerPage(
  container: HTMLElement,
  articles: ArticleMeta[],
  articleStartPages: ArticleStartPageMap,
  contentStartOffset: number
): Promise<void> {
  // 清理旧的 React root（如果存在）
  await safelyUnmountReactRoot(container);

  // 使用 JSX 构建右书签抽屉页内容
  const jsxElement = (
    <RightBookmarkDrawerPage
      articles={articles}
      articleStartPages={articleStartPages}
      contentStartOffset={contentStartOffset}
    />
  );

  // 创建新的 React root 并渲染（容器应该已经被清空）
  const root = createRoot(container);
  root.render(jsxElement);
  reactRootMap.set(container, root);

  // 等待 React 渲染完成
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });
}

// 构建右书签抽屉页面（倒数第 4 页）：包含工具内容
export async function buildRightBookmarkDrawerPage(
  baseWidth: number,
  baseHeight: number,
  articles: ArticleMeta[],
  articleStartPages: ArticleStartPageMap,
  contentStartOffset: number = 2 // 默认内容页起始偏移量为 2
): Promise<HTMLElement> {
  // 使用 JSX 构建右书签抽屉页内容
  const jsxElement = (
    <RightBookmarkDrawerPage
      articles={articles}
      articleStartPages={articleStartPages}
      contentStartOffset={contentStartOffset}
    />
  );

  // 将 JSX 渲染到页面容器中
  const { element: page, renderPromise } = renderJsxToPage(jsxElement, baseWidth, baseHeight);

  // 等待 React 渲染完成
  await renderPromise;
  // 初始状态同样不加 fixed，由运行时逻辑按需添加/移除
  page.setAttribute("class", "own-size bookmark-drawer-page");
  page.setAttribute("data-bookmark-side", "right");
  page.setAttribute("data-bookmark-index", "4");

  // 保存 root 引用
  const root = (page as any)._reactRootContainer;
  if (!root) {
    // 如果没有保存，尝试从 renderJsxToPage 返回的 root 中获取
    // 但 renderJsxToPage 没有返回 root，所以我们需要在调用后保存
    // 这里我们先不处理，因为新创建的页面会有 root
  }

  return page;
}

interface LeftBookmarkDrawerParams {
  /** 书本容器的 DOM 元素，用于查询和操作书签抽屉页 */
  element: HTMLElement;

  /** turn.js 的书籍对象，用于管理翻页 */
  book: JQuery<HTMLElement>;

  /** 是否允许显示左侧书签抽屉页（根据某些条件判断，如滚动位置等） */
  canShowLeftBookmarkPages: boolean;

  /**
   * 左侧书签抽屉页第4页的当前位置状态
   * - "hidden": 第4页显示原始内容（不符合显示条件时，恢复原始内容）
   * - "bookmark": 第4页处于书签位置（收起状态，仅显示书签图标）
   * - "drawer": 第4页处于抽屉展开位置（展开状态，显示完整的抽屉内容）
   */
  leftBookmarkPage4Position: BookmarkDrawerPosition;

  /** 设置左侧书签抽屉页第4页位置状态的状态更新函数 */
  setLeftBookmarkPage4Position: SetStateAction<BookmarkDrawerPosition>;

  /** 页面基础宽度（用于创建书签抽屉页） */
  baseWidth: number;

  /** 页面基础高度（用于创建书签抽屉页） */
  baseHeight: number;

  /** 文章列表元信息数组（用于构建目录内容） */
  articles: ArticleMeta[];

  /** 文章起始页码映射表（文章ID -> 起始页码，用于目录跳转） */
  articleStartPages: ArticleStartPageMap;

  /** 内容页起始偏移量（用于将逻辑页码转换为显示页码） */
  contentStartOffset: number;

  /** 第4页的原始内容（用于恢复） */
  originalPage4Content: HTMLElement | null;

  /** 设置第4页原始内容的函数 */
  setOriginalPage4Content: SetStateAction<HTMLElement | null>;

  /** 用于防止重复执行的 ref */
  isUpdatingRef: React.MutableRefObject<boolean>;

  /** 用于清理 setTimeout 的 ref */
  timeoutRef: React.MutableRefObject<number | null>;
}

// 控制左书签抽屉页的内容替换和位置
export async function updateLeftBookmarkDrawer({
  element,
  book,
  canShowLeftBookmarkPages,
  leftBookmarkPage4Position,
  setLeftBookmarkPage4Position,
  baseWidth,
  baseHeight,
  articles,
  articleStartPages,
  contentStartOffset,
  originalPage4Content,
  setOriginalPage4Content,
  isUpdatingRef,
  timeoutRef,
}: LeftBookmarkDrawerParams) {
  // 如果正在执行，直接返回，避免重复执行
  if (isUpdatingRef.current) {
    return;
  }

  // 清理之前的 setTimeout
  if (timeoutRef.current !== null) {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }

  // 设置执行标志
  isUpdatingRef.current = true;

  try {

    const pageNumber = 4;
    
    // 等待页面被创建（处理快速翻页导致页面还未创建的情况）
    const waitForPage = async (): Promise<HTMLElement | null> => {
      let page4 = element.querySelector(
        `[data-page-number="${pageNumber}"]`
      ) as HTMLElement | null;
      
      if (page4) {
        return page4;
      }
      
      // 如果页面不存在，等待几帧后重试
      const retryCount = 5;
      for (let i = 0; i < retryCount; i++) {
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              resolve();
            });
          });
        });
        
        page4 = element.querySelector(
          `[data-page-number="${pageNumber}"]`
        ) as HTMLElement | null;
        
        if (page4) {
          return page4;
        }
      }
      
      return null;
    };
    
    const page4 = await waitForPage();
    
    if (!page4) {
      // 如果页面仍然不存在，放弃操作
      isUpdatingRef.current = false;
      return;
    }

    const page4Father = element.querySelector(`[page="${pageNumber}"]`) as HTMLElement | null;

    // 如果还没有保存原始内容，且当前页面不是书签抽屉，先保存
    if (!originalPage4Content && !page4.hasAttribute("data-bookmark-side")) {
      const cloned = page4.cloneNode(true) as HTMLElement;
      // 移除 turn.js 动态添加的类名，只保留原始类名
      const turnJsClasses = ['p4', 'page', 'odd', 'even'];
      cloned.className = cloned.className.split(" ").filter(c => !turnJsClasses.includes(c)).join(" ");
      setOriginalPage4Content(cloned);
    }

    if (canShowLeftBookmarkPages) {

      // 符合阈值条件
      if (leftBookmarkPage4Position === "hidden") {

        // 如果书签抽屉被隐藏，按照正常流程显示
        // 1. 如果页面不存在（被 turn.js 回收），需要重新创建
        // 2. 如果页面存在但没有保存原始内容，先保存原始内容
        if (!page4) {
          // 页面不存在，说明被 turn.js 回收了
          // 需要重新创建页面，但如果没有原始内容，无法恢复
          // 这种情况下，如果 originalPage4Content 存在，可以重新创建页面
          if (!originalPage4Content) {
            // 没有原始内容，无法恢复，放弃操作
            isUpdatingRef.current = false;
            return;
          }
          // 重新创建页面：turn.js 应该会自动创建，但我们需要确保它存在
          // 先同步 fixed 状态，确保页面不会被回收
          syncBookmarkFixedPages(book);
          // 再次等待页面创建
          const retryPage4 = await waitForPage();
          if (!retryPage4) {
            // 仍然找不到页面，放弃操作
            isUpdatingRef.current = false;
            return;
          }
          // 使用重新找到的页面
          const retryPage4Father = element.querySelector(`[page="${pageNumber}"]`) as HTMLElement | null;
          // 恢复原始内容到新页面
          const turnJsClasses = retryPage4.className.split(" ").filter(c =>
            c.startsWith("p") || c === "page" || c === "odd" || c === "even"
          ).join(" ");
          retryPage4.innerHTML = originalPage4Content.innerHTML;
          const originalClasses = originalPage4Content.className || "";
          retryPage4.className = turnJsClasses + (originalClasses ? " " + originalClasses : "");
          // 更新 page4 和 page4Father 引用
          const tempPage4 = retryPage4;
          const tempPage4Father = retryPage4Father;
          // 继续后续流程，使用新的页面引用
          const leftBookmarkPage4 = await buildLeftBookmarkDrawerPage(
            baseWidth,
            baseHeight,
            articles,
            articleStartPages,
            contentStartOffset
          );
          const existingClasses = tempPage4.className.split(" ").filter(c =>
            c.startsWith("p") || c === "page" || c === "odd" || c === "even" || c === "own-size" || c === "fixed"
          ).join(" ");
          tempPage4.innerHTML = leftBookmarkPage4.innerHTML;
          tempPage4.className = `${existingClasses} bookmark-drawer-page`;
          tempPage4.setAttribute("data-bookmark-side", "left");
          tempPage4.setAttribute("data-bookmark-index", "4");
          if (tempPage4Father) {
            $(tempPage4Father).removeClass("bookmark-page-Zindex");
            tempPage4Father.style.transition = "transform 1s ease";
            tempPage4Father.style.transform = "translateX(-20%)";
          }
          const leftBookmarkElement = tempPage4.querySelector(".bookmark-drawer-page-Left__Bookmark") as HTMLElement | null;
          if (leftBookmarkElement && !leftBookmarkElement.hasAttribute("data-click-handler-attached")) {
            const clickHandler = throttle((e: MouseEvent) => {
              e.stopPropagation();
              setLeftBookmarkPage4Position((prev) => {
                if (prev === "bookmark") {
                  return "drawer";
                } else {
                  return "bookmark";
                }
              });
            }, 1200);
            leftBookmarkElement.addEventListener("click", clickHandler);
            leftBookmarkElement.setAttribute("data-click-handler-attached", "true");
            leftBookmarkElement.style.cursor = "pointer";
          }
          setLeftBookmarkPage4Position("bookmark");
          isUpdatingRef.current = false;
          return;
        }

        // 页面存在，正常流程
        // 1. 保存原始内容（已在上面完成）
        // 2. 替换为书签抽屉内容
        const leftBookmarkPage4 = await buildLeftBookmarkDrawerPage(
          baseWidth,
          baseHeight,
          articles,
          articleStartPages,
          contentStartOffset
        );

        // 替换页面内容：保留原有的 data-page-number 和 turn.js 需要的类名
        const existingClasses = page4.className.split(" ").filter(c =>
          c.startsWith("p") || c === "page" || c === "odd" || c === "even" || c === "own-size" || c === "fixed"
        ).join(" ");

        page4.innerHTML = leftBookmarkPage4.innerHTML;
        page4.className = `${existingClasses} bookmark-drawer-page`;
        page4.setAttribute("data-bookmark-side", "left");
        page4.setAttribute("data-bookmark-index", "4");

        // 3. 将第4页向外移动，显示书签位置
        if (page4Father) {
          $(page4Father).removeClass("bookmark-page-Zindex");
          page4Father.style.transition = "transform 1s ease";
          page4Father.style.transform = "translateX(-20%)";
        }

        // 4. 为书签添加点击事件
        const leftBookmarkElement = page4.querySelector(".bookmark-drawer-page-Left__Bookmark") as HTMLElement | null;
        if (leftBookmarkElement && !leftBookmarkElement.hasAttribute("data-click-handler-attached")) {
          const clickHandler = throttle((e: MouseEvent) => {
            e.stopPropagation();
            // 切换状态：bookmark <-> drawer
            setLeftBookmarkPage4Position((prev) => {
              if (prev === "bookmark") {
                return "drawer";
              } else {
                return "bookmark";
              }
            });
          }, 1200); // 1.2秒节流
          leftBookmarkElement.addEventListener("click", clickHandler);
          leftBookmarkElement.setAttribute("data-click-handler-attached", "true");
          leftBookmarkElement.style.cursor = "pointer";
        }

        // 5. 确保页面不会被 turn.js 回收
        syncBookmarkFixedPages(book);

        setLeftBookmarkPage4Position("bookmark");
        isUpdatingRef.current = false;

      } else if (leftBookmarkPage4Position === "bookmark" || leftBookmarkPage4Position === "drawer") {

        // 如果书签抽屉是显示的，确保点击事件存在，并根据状态设置位置
        const leftBookmarkElement = page4.querySelector(".bookmark-drawer-page-Left__Bookmark") as HTMLElement | null;
        if (leftBookmarkElement && !leftBookmarkElement.hasAttribute("data-click-handler-attached")) {
          const clickHandler = throttle((e: MouseEvent) => {
            e.stopPropagation();
            setLeftBookmarkPage4Position((prev) => {
              if (prev === "bookmark") {
                return "drawer";
              } else {
                return "bookmark";
              }
            });
          }, 1200); // 1.2秒节流
          leftBookmarkElement.addEventListener("click", clickHandler);
          leftBookmarkElement.setAttribute("data-click-handler-attached", "true");
          leftBookmarkElement.style.cursor = "pointer";
        }

        // 根据当前状态设置位置
        if (page4Father) {
          page4Father.style.transition = "transform 1s ease";
          if (leftBookmarkPage4Position === "drawer") {
            page4Father.style.transform = "translateX(-70.5%)";
            // 保存延迟添加 z-index 的 setTimeout，以便在需要时清理
            const delayedZIndexTimeout = window.setTimeout(() => {
              if (page4Father) {
                $(page4Father).addClass("bookmark-page-Zindex");
              }
            }, 1000);
            timeoutRef.current = delayedZIndexTimeout;
          } else {
            $(page4Father).removeClass("bookmark-page-Zindex");
            page4Father.style.zIndex = "";
            page4Father.style.transform = "translateX(-20%)";
          }
        }

        // 确保页面不会被 turn.js 回收
        syncBookmarkFixedPages(book);

        isUpdatingRef.current = false;
      }

    } else {

      // 不符合阈值条件
      if (leftBookmarkPage4Position === "hidden") {
        // 如果书签抽屉是隐藏的，不用再管
        isUpdatingRef.current = false;
        return;
      }

      // 如果书签抽屉不是隐藏的，根据实际状态进行缩回和内容替换
      if (leftBookmarkPage4Position === "drawer") {
        // 如果显示的是书签抽屉，先缩回到书签位置
        // 在开始缩回动画之前，立即移除 bookmark-page-Zindex 类，确保不会浮于内容之上
        if (page4Father) {
          // 立即移除 z-index，避免动画过程中浮于内容之上
          $(page4Father).removeClass("bookmark-page-Zindex");
          // 强制移除内联样式中的 z-index（如果有）
          page4Father.style.zIndex = "";
          page4Father.style.transition = "transform 1s ease";
          page4Father.style.transform = "translateX(-20%)";
        }
        // 在动画过程中持续检查并移除 z-index（防止延迟添加的 setTimeout 执行）
        const checkInterval = window.setInterval(() => {
          if (page4Father) {
            $(page4Father).removeClass("bookmark-page-Zindex");
            page4Father.style.zIndex = "";
          }
        }, 100); // 每100ms检查一次
        // 等待动画完成后，再缩回到原始位置并恢复内容
        const timeout1 = window.setTimeout(() => {
          // 清理检查间隔
          clearInterval(checkInterval);
          if (page4Father) {
            // 再次确保移除 z-index
            $(page4Father).removeClass("bookmark-page-Zindex");
            page4Father.style.zIndex = "";
            page4Father.style.transition = "transform 1s ease";
            page4Father.style.transform = "translateX(0%)";
          }
          const timeout2 = window.setTimeout(() => {
            if (!originalPage4Content) {
              isUpdatingRef.current = false;
              return;
            }
            // 恢复原始内容前，最后一次确保移除 z-index
            if (page4Father) {
              $(page4Father).removeClass("bookmark-page-Zindex");
              page4Father.style.zIndex = "";
            }
            // 恢复原始内容
            const turnJsClasses = page4.className.split(" ").filter(c =>
              c.startsWith("p") || c === "page" || c === "odd" || c === "even"
            ).join(" ");
            page4.innerHTML = originalPage4Content.innerHTML;
            const originalClasses = originalPage4Content.className || "";
            page4.className = turnJsClasses + (originalClasses ? " " + originalClasses : "");
            page4.removeAttribute("data-bookmark-side");
            page4.removeAttribute("data-bookmark-index");
            // 恢复内容后，确保页面不会被 turn.js 回收（通过 syncBookmarkFixedPages 管理）
            syncBookmarkFixedPages(book);
            setLeftBookmarkPage4Position("hidden");
            isUpdatingRef.current = false;
          }, 1000); // 等待缩回动画完成
          timeoutRef.current = timeout2;
        }, 1000); // 等待第一次缩回动画完成
        timeoutRef.current = timeout1;
      } else if (leftBookmarkPage4Position === "bookmark") {
        // 如果只显示书签，直接缩回到原始位置并恢复内容
        if (page4Father) {
          // 立即移除 z-index
          $(page4Father).removeClass("bookmark-page-Zindex");
          page4Father.style.zIndex = "";
          page4Father.style.transition = "transform 1s ease";
          page4Father.style.transform = "translateX(0%)";
        }
        // 等待动画完成后恢复原始内容
        const timeout = window.setTimeout(() => {
          if (!originalPage4Content) {
            isUpdatingRef.current = false;
            return;
          }
          // 恢复原始内容前，确保移除 z-index
          if (page4Father) {
            $(page4Father).removeClass("bookmark-page-Zindex");
            page4Father.style.zIndex = "";
          }
          const turnJsClasses = page4.className.split(" ").filter(c =>
            c.startsWith("p") || c === "page" || c === "odd" || c === "even"
          ).join(" ");
          page4.innerHTML = originalPage4Content.innerHTML;
          const originalClasses = originalPage4Content.className || "";
          page4.className = turnJsClasses + (originalClasses ? " " + originalClasses : "");
          page4.removeAttribute("data-bookmark-side");
          page4.removeAttribute("data-bookmark-index");
          // 恢复内容后，确保页面不会被 turn.js 回收（通过 syncBookmarkFixedPages 管理）
          syncBookmarkFixedPages(book);
          setLeftBookmarkPage4Position("hidden");
          isUpdatingRef.current = false;
        }, 1000); // 与 CSS 动画时长一致
        timeoutRef.current = timeout;
      }
    }

  } finally {
    // 对于同步操作，确保标志被清除
    // 对于异步操作（setTimeout），在回调中清除
  }
}

interface RightBookmarkDrawerParams {
  element: HTMLElement;
  book: JQuery<HTMLElement>;
  canShowRightBookmarkPages: boolean;
  rightBookmarkPage4Position: BookmarkDrawerPosition;
  totalLogicalPages: number | null;
  baseWidth: number;
  baseHeight: number;
  articles: ArticleMeta[];
  articleStartPages: ArticleStartPageMap;
  contentStartOffset: number;
  setRightBookmarkPage4Position: SetStateAction<BookmarkDrawerPosition>;
  /** 倒数第4页的原始内容（用于恢复） */
  originalLastPage4Content: HTMLElement | null;
  /** 设置倒数第4页原始内容的函数 */
  setOriginalLastPage4Content: SetStateAction<HTMLElement | null>;
  /** 用于防止重复执行的 ref */
  isUpdatingRef: React.MutableRefObject<boolean>;
  /** 用于清理 setTimeout 的 ref */
  timeoutRef: React.MutableRefObject<number | null>;
}

// 控制右书签抽屉页的内容替换和位置
export async function updateRightBookmarkDrawer({
  element,
  book,
  canShowRightBookmarkPages,
  rightBookmarkPage4Position,
  totalLogicalPages,
  baseWidth,
  baseHeight,
  articles,
  articleStartPages,
  contentStartOffset,
  setRightBookmarkPage4Position,
  originalLastPage4Content,
  setOriginalLastPage4Content,
  isUpdatingRef,
  timeoutRef,
}: RightBookmarkDrawerParams) {

  // 如果正在执行，直接返回，避免重复执行
  if (isUpdatingRef.current) {
    return;
  }

  // 清理之前的 setTimeout
  if (timeoutRef.current !== null) {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }

  // 设置执行标志
  isUpdatingRef.current = true;

  try {
    if (!totalLogicalPages) {
      isUpdatingRef.current = false;
      return;
    }
    // 获取当前实际总页数
    const currentTotal = book.turn("pages");

    // 倒数第4页（封底有2页，所以倒数第4页是 currentTotal - 3）
    const lastPage4Number = currentTotal - 3;
    
    // 等待页面被创建（处理快速翻页导致页面还未创建的情况）
    const waitForPage = async (): Promise<HTMLElement | null> => {
      let page4 = element.querySelector(
        `[data-page-number="${lastPage4Number}"]`
      ) as HTMLElement | null;
      
      if (page4) {
        return page4;
      }
      
      // 如果页面不存在，等待几帧后重试
      const retryCount = 5;
      for (let i = 0; i < retryCount; i++) {
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              resolve();
            });
          });
        });
        
        page4 = element.querySelector(
          `[data-page-number="${lastPage4Number}"]`
        ) as HTMLElement | null;
        
        if (page4) {
          return page4;
        }
      }
      
      return null;
    };
    
    const page4 = await waitForPage();
    
    if (!page4) {
      // 如果页面仍然不存在，放弃操作
      isUpdatingRef.current = false;
      return;
    }

    const page4Father = element.querySelector(`[page="${lastPage4Number}"]`) as HTMLElement | null;

  // 如果还没有保存原始内容，且当前页面不是书签抽屉，先保存
  if (!originalLastPage4Content && !page4.hasAttribute("data-bookmark-side")) {
    const cloned = page4.cloneNode(true) as HTMLElement;
    // 移除 turn.js 动态添加的类名，只保留原始类名
    const turnJsClasses = [`p${lastPage4Number}`, 'page', 'odd', 'even'];
    cloned.className = cloned.className.split(" ").filter(c => !turnJsClasses.includes(c)).join(" ");
    setOriginalLastPage4Content(cloned);
  }

  if (canShowRightBookmarkPages) {

    // 符合阈值条件
    if (rightBookmarkPage4Position === "hidden") {
      // 如果书签抽屉被隐藏，按照正常流程显示
      // 1. 如果页面不存在（被 turn.js 回收），需要重新创建
      if (!page4) {
        // 页面不存在，说明被 turn.js 回收了
        // 需要重新创建页面，但如果没有原始内容，无法恢复
        if (!originalLastPage4Content) {
          // 没有原始内容，无法恢复，放弃操作
          isUpdatingRef.current = false;
          return;
        }
        // 重新创建页面：turn.js 应该会自动创建，但我们需要确保它存在
        // 先同步 fixed 状态，确保页面不会被回收
        syncBookmarkFixedPages(book);
        // 再次等待页面创建
        const retryPage4 = await waitForPage();
        if (!retryPage4) {
          // 仍然找不到页面，放弃操作
          isUpdatingRef.current = false;
          return;
        }
        // 使用重新找到的页面
        const retryPage4Father = element.querySelector(`[page="${lastPage4Number}"]`) as HTMLElement | null;
        // 恢复原始内容到新页面
        const turnJsClasses = retryPage4.className.split(" ").filter(c =>
          c.startsWith("p") || c === "page" || c === "odd" || c === "even"
        ).join(" ");
        retryPage4.innerHTML = originalLastPage4Content.innerHTML;
        const originalClasses = originalLastPage4Content.className || "";
        retryPage4.className = turnJsClasses + (originalClasses ? " " + originalClasses : "");
        // 更新 page4 和 page4Father 引用
        const tempPage4 = retryPage4;
        const tempPage4Father = retryPage4Father;
        // 继续后续流程，使用新的页面引用
        const rightBookmarkPage4 = await buildRightBookmarkDrawerPage(
          baseWidth,
          baseHeight,
          articles,
          articleStartPages,
          contentStartOffset
        );



        const existingClasses = tempPage4.className.split(" ").filter(c =>
          c.startsWith("p") || c === "page" || c === "odd" || c === "even" || c === "own-size" || c === "fixed"
        ).join(" ");
        // 在清空容器之前，先安全地卸载 React root
        await safelyUnmountReactRoot(tempPage4);
        // 清空容器并重新渲染 React 组件（而不是直接替换 innerHTML，这样会丢失 React root）
        tempPage4.innerHTML = "";
        await reRenderRightBookmarkDrawerPage(
          tempPage4,
          articles,
          articleStartPages,
          contentStartOffset
        );
        tempPage4.className = `${existingClasses} bookmark-drawer-page`;
        tempPage4.setAttribute("data-bookmark-side", "right");
        tempPage4.setAttribute("data-bookmark-index", "4");
        if (tempPage4Father) {
          $(tempPage4Father).removeClass("bookmark-page-Zindex");
          tempPage4Father.style.transition = "transform 1s ease";
          tempPage4Father.style.transform = "translateX(20%)";
        }
        const rightBookmarkElement = tempPage4.querySelector(".bookmark-drawer-page-Right__Bookmark") as HTMLElement | null;
        if (rightBookmarkElement && !rightBookmarkElement.hasAttribute("data-click-handler-attached")) {
          const clickHandler = throttle((e: MouseEvent) => {
            e.stopPropagation();
            setRightBookmarkPage4Position((prev) => {
              if (prev === "bookmark") {
                return "drawer";
              } else {
                return "bookmark";
              }
            });
          }, 1200);
          rightBookmarkElement.addEventListener("click", clickHandler);
          rightBookmarkElement.setAttribute("data-click-handler-attached", "true");
          rightBookmarkElement.style.cursor = "pointer";
        }
        setRightBookmarkPage4Position("bookmark");
        isUpdatingRef.current = false;
        return;
      }

      // 页面存在，正常流程
      // 1. 保存原始内容（已在上面完成）
      // 2. 替换为书签抽屉内容
      const rightBookmarkPage4 = await buildRightBookmarkDrawerPage(
        baseWidth,
        baseHeight,
        articles,
        articleStartPages,
        contentStartOffset
      );

      // 替换页面内容：保留原有的 data-page-number 和 turn.js 需要的类名
      const existingClasses = page4.className.split(" ").filter(c =>
        c.startsWith("p") || c === "page" || c === "odd" || c === "even" || c === "own-size" || c === "fixed"
      ).join(" ");

      // 在清空容器之前，先安全地卸载 React root
      await safelyUnmountReactRoot(page4);
      // 清空容器并重新渲染 React 组件（而不是直接替换 innerHTML，这样会丢失 React root）
      page4.innerHTML = "";
      await reRenderRightBookmarkDrawerPage(
        page4,
        articles,
        articleStartPages,
        contentStartOffset
      );
      page4.className = `${existingClasses} bookmark-drawer-page`;
      page4.setAttribute("data-bookmark-side", "right");
      page4.setAttribute("data-bookmark-index", "4");

      // 3. 将倒数第4页向外移动，显示书签位置（右侧向右移动）
      if (page4Father) {
        $(page4Father).removeClass("bookmark-page-Zindex");
        page4Father.style.transition = "transform 1s ease";
        page4Father.style.transform = "translateX(20%)";
      }

      // 4. 为书签添加点击事件
      const rightBookmarkElement = page4.querySelector(".bookmark-drawer-page-Right__Bookmark") as HTMLElement | null;
      if (rightBookmarkElement && !rightBookmarkElement.hasAttribute("data-click-handler-attached")) {
        const clickHandler = throttle((e: MouseEvent) => {
          e.stopPropagation();
          // 切换状态：bookmark <-> drawer
          setRightBookmarkPage4Position((prev) => {
            if (prev === "bookmark") {
              return "drawer";
            } else {
              return "bookmark";
            }
          });
        }, 1200); // 1.2秒节流
        rightBookmarkElement.addEventListener("click", clickHandler);
        rightBookmarkElement.setAttribute("data-click-handler-attached", "true");
        rightBookmarkElement.style.cursor = "pointer";
      }

      // 5. 确保页面不会被 turn.js 回收
      syncBookmarkFixedPages(book);

      setRightBookmarkPage4Position("bookmark");
      isUpdatingRef.current = false;
    } else if (rightBookmarkPage4Position === "bookmark" || rightBookmarkPage4Position === "drawer") {
      // 如果书签抽屉是显示的，确保点击事件存在，并根据状态设置位置
      const rightBookmarkElement = page4.querySelector(".bookmark-drawer-page-Right__Bookmark") as HTMLElement | null;
      if (rightBookmarkElement && !rightBookmarkElement.hasAttribute("data-click-handler-attached")) {
        const clickHandler = throttle((e: MouseEvent) => {
          e.stopPropagation();
          setRightBookmarkPage4Position((prev) => {
            if (prev === "bookmark") {
              return "drawer";
            } else {
              return "bookmark";
            }
          });
        }, 1200); // 1.2秒节流
        rightBookmarkElement.addEventListener("click", clickHandler);
        rightBookmarkElement.setAttribute("data-click-handler-attached", "true");
        rightBookmarkElement.style.cursor = "pointer";
      }

      // 根据当前状态设置位置
      if (page4Father) {
        page4Father.style.transition = "transform 1s ease";
        if (rightBookmarkPage4Position === "drawer") {
          page4Father.style.transform = "translateX(70.5%)";
          // 保存延迟添加 z-index 的 setTimeout，以便在需要时清理
          const delayedZIndexTimeout = window.setTimeout(() => {
            if (page4Father) {
              $(page4Father).addClass("bookmark-page-Zindex");
            }
          }, 1000);
          timeoutRef.current = delayedZIndexTimeout;
        } else {
          $(page4Father).removeClass("bookmark-page-Zindex");
          page4Father.style.zIndex = "";
          page4Father.style.transform = "translateX(20%)";
        }
      }

      // 确保页面不会被 turn.js 回收
      syncBookmarkFixedPages(book);

      isUpdatingRef.current = false;
    }
  } else {
    // 不符合阈值条件
    if (rightBookmarkPage4Position === "hidden") {
      // 如果书签抽屉是隐藏的，不用再管
      isUpdatingRef.current = false;
      return;
    }

    // 如果书签抽屉不是隐藏的，根据实际状态进行缩回和内容替换
    if (rightBookmarkPage4Position === "drawer") {
      // 如果显示的是书签抽屉，先缩回到书签位置
      // 在开始缩回动画之前，立即移除 bookmark-page-Zindex 类，确保不会浮于内容之上
      if (page4Father) {
        // 立即移除 z-index，避免动画过程中浮于内容之上
        $(page4Father).removeClass("bookmark-page-Zindex");
        // 强制移除内联样式中的 z-index（如果有）
        page4Father.style.zIndex = "";
        page4Father.style.transition = "transform 1s ease";
        page4Father.style.transform = "translateX(20%)";
      }
      // 在动画过程中持续检查并移除 z-index（防止延迟添加的 setTimeout 执行）
      const checkInterval = window.setInterval(() => {
        if (page4Father) {
          $(page4Father).removeClass("bookmark-page-Zindex");
          page4Father.style.zIndex = "";
        }
      }, 100); // 每100ms检查一次
      // 等待动画完成后，再缩回到原始位置并恢复内容
      const timeout1 = window.setTimeout(() => {
        // 清理检查间隔
        clearInterval(checkInterval);
        if (page4Father) {
          // 再次确保移除 z-index
          $(page4Father).removeClass("bookmark-page-Zindex");
          page4Father.style.zIndex = "";
          page4Father.style.transition = "transform 1s ease";
          page4Father.style.transform = "translateX(0%)";
        }
        const timeout2 = window.setTimeout(async () => {
          if (!originalLastPage4Content) {
            isUpdatingRef.current = false;
            return;
          }
          // 恢复原始内容前，最后一次确保移除 z-index
          if (page4Father) {
            $(page4Father).removeClass("bookmark-page-Zindex");
            page4Father.style.zIndex = "";
          }
          // 在恢复原始内容之前，先安全地卸载 React root
          await safelyUnmountReactRoot(page4);
          // 恢复原始内容
          const turnJsClasses = page4.className.split(" ").filter(c =>
            c.startsWith("p") || c === "page" || c === "odd" || c === "even"
          ).join(" ");
          page4.innerHTML = originalLastPage4Content.innerHTML;
          const originalClasses = originalLastPage4Content.className || "";
          page4.className = turnJsClasses + (originalClasses ? " " + originalClasses : "");
          page4.removeAttribute("data-bookmark-side");
          page4.removeAttribute("data-bookmark-index");
          // 恢复内容后，确保页面不会被 turn.js 回收（通过 syncBookmarkFixedPages 管理）
          syncBookmarkFixedPages(book);
          setRightBookmarkPage4Position("hidden");
          isUpdatingRef.current = false;
        }, 1000); // 等待缩回动画完成
        timeoutRef.current = timeout2;
      }, 1000); // 等待第一次缩回动画完成
      timeoutRef.current = timeout1;
    } else if (rightBookmarkPage4Position === "bookmark") {
      // 如果只显示书签，直接缩回到原始位置并恢复内容
      if (page4Father) {
        // 立即移除 z-index
        $(page4Father).removeClass("bookmark-page-Zindex");
        page4Father.style.zIndex = "";
        page4Father.style.transition = "transform 1s ease";
        page4Father.style.transform = "translateX(0%)";
      }
      // 等待动画完成后恢复原始内容
      const timeout = window.setTimeout(async () => {
        if (!originalLastPage4Content) {
          isUpdatingRef.current = false;
          return;
        }
        // 恢复原始内容前，确保移除 z-index
        if (page4Father) {
          $(page4Father).removeClass("bookmark-page-Zindex");
          page4Father.style.zIndex = "";
        }
        // 在恢复原始内容之前，先安全地卸载 React root
        await safelyUnmountReactRoot(page4);
        const turnJsClasses = page4.className.split(" ").filter(c =>
          c.startsWith("p") || c === "page" || c === "odd" || c === "even"
        ).join(" ");
        page4.innerHTML = originalLastPage4Content.innerHTML;
        const originalClasses = originalLastPage4Content.className || "";
        page4.className = turnJsClasses + (originalClasses ? " " + originalClasses : "");
        page4.removeAttribute("data-bookmark-side");
        page4.removeAttribute("data-bookmark-index");
        // 恢复内容后，确保页面不会被 turn.js 回收（通过 syncBookmarkFixedPages 管理）
        syncBookmarkFixedPages(book);
        setRightBookmarkPage4Position("hidden");
        isUpdatingRef.current = false;
      }, 1000); // 与 CSS 动画时长一致
      timeoutRef.current = timeout;
    }
  }
  } finally {
    // 对于同步操作，确保标志被清除
    // 对于异步操作（setTimeout），在回调中清除
  }
}

/**
 * 根据 turn.js 当前的 page range，按需为
 * - 第 4 页
 * - 倒数第 4 页
 * 添加或移除 fixed 类，从而精确控制它们是否永久驻留在 DOM 中。
 *
 * 逻辑：
 * - 如果锚点页在当前 range 之内，则移除 fixed（由 turn.js 自己管理 DOM）；
 * - 如果锚点页在当前 range 之外，则添加 fixed，强制其保留在 DOM 中；
 * 这样自然就等价于你描述的"当当前显示页即将超过某个阈值时为锚点页加 fixed，小于该阈值时移除"。
 */
export function syncBookmarkFixedPages(book: JQuery<HTMLElement>) {
  if (!book || !book.turn || !book.turn("is")) return;

  const totalPages = book.turn("pages") as number;


  if (!totalPages || totalPages < 1) return;

  // 当前 turn.js 认为需要常驻 DOM 的物理页范围
  const range = book.turn("range") as [number, number];
  const [rangeStart, rangeEnd] = range;

  // 左侧书签锚点永远是物理第 4 页（封面之后第二个内容页）
  const firstAnchorPage = 4;
  // 右侧书签锚点是倒数第 4 页：最后两页是封底，之前两页预留给其它尾页
  const lastAnchorPage = totalPages >= 4 ? totalPages - 3 : null;

  const data = (book as any).data?.();

  const pageObjs = data?.pageObjs || {};

  const processAnchor = (pageNumber: number | null) => {
    if (!pageNumber || pageNumber < 1 || pageNumber > totalPages) return;

    const pageObj = pageObjs[pageNumber];

    if (!pageObj || pageObj.length === 0) return;

    const domElement = pageObj[0]; // jQuery对象的第一个DOM元素

    const inRange = pageNumber >= rangeStart && pageNumber <= rangeEnd;

    if (inRange) {

      // 在 turn.js 的可见窗口内，移除 fixed，让它按正常规则参与 DOM 管理
      pageObj.removeClass("fixed");

      // 同时直接操作DOM确保类被移除（双重保险）
      if (domElement && domElement.classList.contains("fixed")) {
        domElement.classList.remove("fixed");
      }

    } else {

      // 即将被 turn.js 回收时加上 fixed，使其始终保留在 DOM 中
      pageObj.addClass("fixed");

      // 同时直接操作DOM确保类被添加（双重保险）
      if (domElement && !domElement.classList.contains("fixed")) {
        domElement.classList.add("fixed");
      }

    }
  };

  processAnchor(firstAnchorPage);
  processAnchor(lastAnchorPage);
}

