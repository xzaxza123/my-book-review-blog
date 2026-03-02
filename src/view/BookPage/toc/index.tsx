import React from "react";
import "./index.scss";
import type { ArticleMeta, ArticleStartPageMap } from "../bookmarkDrawer";
import { renderJsxToPage } from "../../../utils/jsxToDom";
import { VIRTUAL_IDS, TOC_CONFIG, STORAGE_KEYS } from "../../../config";

// 从配置文件导出虚拟内容 ID（保持向后兼容）
export const PREFACE_VIRTUAL_ID = VIRTUAL_IDS.PREFACE;
export const TOC_VIRTUAL_ID = VIRTUAL_IDS.TOC;

// 从配置文件导出目录相关常量（保持向后兼容）
export const TOC_ITEMS_PER_PAGE = TOC_CONFIG.ITEMS_PER_PAGE;
export const ARTICLE_START_PAGE_STORAGE_KEY = STORAGE_KEYS.ARTICLE_START_PAGES;

// 从 sessionStorage 读取文章起始页映射（如不存在则返回 null）
export function loadArticleStartPageMap(): ArticleStartPageMap | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(ARTICLE_START_PAGE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ArticleStartPageMap;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

// 将文章起始页映射写入 sessionStorage，便于跨次打开时快速恢复目录信息
export function saveArticleStartPageMap(map: ArticleStartPageMap) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      ARTICLE_START_PAGE_STORAGE_KEY,
      JSON.stringify(map)
    );
  } catch {
    // 存储失败不影响主流程（例如浏览器禁止存储）
  }
}

// 目录条目类型
type TocEntry = { id: string; title: string };

// 目录页组件 Props
interface TocPageProps {
  pageIndex: number;
  totalPages: number;
  entries: TocEntry[];
  articleStartPages: ArticleStartPageMap;
  startIndex: number;
  endIndex: number;
  contentStartOffset: number; // 内容页起始偏移量（用于将逻辑页码转换为显示页码）
}

// 单个目录页组件
function TocPage({
  pageIndex,
  totalPages,
  entries,
  articleStartPages,
  startIndex,
  endIndex,
  contentStartOffset,
}: TocPageProps) {
  return (
    <div className="book-toc-page__inner">
      <div className="book-toc-page__content">
        <div className="book-toc-page__title">目录</div>
        <div className="book-toc-page__page-index">
          {pageIndex + 1}/{totalPages}
        </div>
        <ul className="book-toc-page__list">
          {entries.slice(startIndex, endIndex).map((entry, i) => {
            const globalIndex = startIndex + i;
            const startPage = articleStartPages[entry.id];
            const hasValidStartPage =
              typeof startPage === "number" && !Number.isNaN(startPage);
            
            // 将逻辑页码转换为显示页码（从 1 开始）
            // 逻辑页码与显示页码的关系：
            // 在 attachPages 中：
            //   logicalPage = ACTUAL_CONTENT_START + contentIndex
            //   displayPageNumber = contentIndex
            // => displayPageNumber = logicalPage - ACTUAL_CONTENT_START
            const displayPage = hasValidStartPage
              ? startPage - contentStartOffset
              : null;

            return (
              <li
                key={entry.id}
                className={`book-toc-page__item ${
                  hasValidStartPage ? "book-toc-page__item--clickable" : ""
                }`}
                {...(hasValidStartPage && {
                  "data-target-page": String(startPage), // 跳转仍使用逻辑页码
                })}
              >
                <span className="book-toc-page__item-index">
                  {String(globalIndex + 1).padStart(2, "0")}
                </span>
                <span className="book-toc-page__item-title">{entry.title}</span>
                <span className="book-toc-page__item-page">
                  {displayPage !== null ? String(displayPage) : "-"}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

// 根据文章信息与起始页映射，生成目录页 DOM（使用 JSX 构建，提高可读性）
// 目录项顺序：前言（可选）→ 目录本身 → 各文章
export async function buildTocPages(
  articles: ArticleMeta[],
  articleStartPages: ArticleStartPageMap,
  {
    baseWidth,
    baseHeight,
    itemsPerPage,
    contentStartOffset,
  }: {
    baseWidth: number;
    baseHeight: number;
    itemsPerPage: number;
    contentStartOffset: number; // 内容页起始偏移量（用于将逻辑页码转换为显示页码）
  }
): Promise<HTMLElement[]> {
  // 构造目录条目列表：前言（若存在）、目录本身、所有文章
  const entries: TocEntry[] = [];

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

  if (!entries.length) return [];

  const pages: HTMLElement[] = [];
  const totalPages = Math.ceil(entries.length / itemsPerPage);
  const renderPromises: Promise<void>[] = [];

  for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
    const start = pageIndex * itemsPerPage;
    const end = Math.min(start + itemsPerPage, entries.length);

    // 使用 JSX 构建目录页内容
    const jsxElement = (
      <TocPage
        pageIndex={pageIndex}
        totalPages={totalPages}
        entries={entries}
        articleStartPages={articleStartPages}
        startIndex={start}
        endIndex={end}
        contentStartOffset={contentStartOffset}
      />
    );

    // 将 JSX 渲染到页面容器中，并获取渲染完成的 Promise
    const { element: page, renderPromise } = renderJsxToPage(jsxElement, baseWidth, baseHeight);
    page.classList.add("book-toc-page");
    pages.push(page);
    renderPromises.push(renderPromise);
  }

  // 等待所有页面渲染完成
  await Promise.all(renderPromises);

  return pages;
}

