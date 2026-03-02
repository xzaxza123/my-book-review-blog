import React from "react";
import "./index.scss";
import { renderJsxToPage } from "../../../utils/jsxToDom";

// 前言页组件 Props
interface PrefacePageProps {
  pageIndex: number;
}

// 单个前言页组件
function PrefacePage({ pageIndex }: PrefacePageProps) {
  if (pageIndex === 0) {
    return (
      <div className="preface-page">
        <div className="preface-page__inner">
          <div className="preface-page__content">
            <h1 className="preface-page__title">前言</h1>
            <p className="preface-page__subtitle">
              写给每一位热爱阅读与记录的人
            </p>
            <p className="preface-page__paragraph">
              书本的形式在这个项目中只是一个载体，真正被翻动的，其实是你与文字之间反复往来的心情。每一次写下读后感，都是在和过去的自己进行一场安静的对话。
            </p>
            <p className="preface-page__paragraph">
              我希望这里呈现的，不只是对某一本书的简单评价，而是阅读在生活中留下的纹理：那些被触动的瞬间、被启发的想法，以及在时间推移中慢慢发酵的改变。
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (pageIndex === 1) {
    return (
      <div className="preface-page">
        <div className="preface-page__inner">
          <div className="preface-page__content">
            <h2 className="preface-page__section-title">
              关于这本"书"的结构
            </h2>
            <p className="preface-page__paragraph">
              你现在看到的是一本文集式的阅读笔记，它被拆解成一篇篇独立的文章，却又因为同一种表达方式、同一套排版风格，被重新编织成一本完整的书。
            </p>
            <p className="preface-page__paragraph">
              在接下来的阅读中，你可以像翻阅纸质书一样，自然地从前言翻到目录，再从目录走向任意一篇文章；也可以在某一页停留更久，只为反复咀嚼一段话带来的余味。
            </p>
            <p className="preface-page__paragraph preface-page__paragraph--emphasis">
              愿这本虚拟的书，能在你真实的生活中留下一点点温和的光。
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="preface-page">
      <div className="preface-page__inner">
        <div className="preface-page__content">
          <p className="preface-page__paragraph">
            （预留的前言扩展页，可以在将来根据需要补充更多内容。）
          </p>
        </div>
      </div>
    </div>
  );
}

// 构建前言页内容 DOM：固定为若干逻辑页，页脚由 wrapPageWithFooter 在外层统一处理
// 使用 JSX 构建，提高可读性
export async function buildPrefacePages(
  baseWidth: number,
  baseHeight: number,
  totalPages: number
): Promise<HTMLElement[]> {
  if (totalPages <= 0) return [];

  const pages: HTMLElement[] = [];
  const renderPromises: Promise<void>[] = [];

  for (let i = 0; i < totalPages; i += 1) {
    // 使用 JSX 构建前言页内容
    const jsxElement = <PrefacePage pageIndex={i} />;

    // 将 JSX 渲染到页面容器中，并获取渲染完成的 Promise
    const { element: page, renderPromise } = renderJsxToPage(jsxElement, baseWidth, baseHeight);
    pages.push(page);
    renderPromises.push(renderPromise);
  }

  // 等待所有页面渲染完成
  await Promise.all(renderPromises);

  return pages;
}

