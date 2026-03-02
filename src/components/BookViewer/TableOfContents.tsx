import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { ROUTES } from "../../config";

interface ArticlePageInfo {
  id: string;
  path: string;
  title: string;
  startPage: number;
  estimatedPages: number;
  meta?: Record<string, any>;
}

// 从配置文件导入路由常量
const BOOK_ROUTE = ROUTES.BOOK;

/**
 * 简单目录组件：基于构建时生成的 page-map.json 展示文章列表
 * 暂时只负责：
 * - 展示标题与「约 N 页」提示（estimatedPages 仅作提示）
 * - 点击后导航到书本视图的入口路由（统一落在第 1 页）
 *
 * 后续你可以在 `/MyBookReview` 里读取 `article` 查询参数，
 * 再结合 `useArticlePages` 做真正的文章级分页与跳转。
 */
export const TableOfContents: React.FC = () => {
  const navigate = useNavigate();
  const [articles, setArticles] = useState<ArticlePageInfo[]>([]);

  useEffect(() => {
    let cancelled = false;

    fetch("/page-map.json")
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to load page-map.json: ${res.status}`);
        }
        return res.json();
      })
      .then((data: ArticlePageInfo[]) => {
        if (cancelled) return;
        if (Array.isArray(data)) {
          setArticles(data);
        }
      })
      .catch((err) => {
        console.error("[TableOfContents] 加载 page-map.json 失败", err);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!articles.length) {
    return null;
  }

  const handleOpenArticle = (article: ArticlePageInfo) => {
    // 直接跳到该文章的预估起始逻辑页
    navigate(`${BOOK_ROUTE}/${article.startPage}`);
  };

  return (
    <aside className="BookToc">
      <h2 className="BookToc__title">目录</h2>
      <ul className="BookToc__list">
        {articles.map((article) => (
          <li key={article.id} className="BookToc__item">
            <div className="BookToc__item-main">
              <span className="BookToc__item-title">{article.title}</span>
              <span className="BookToc__item-meta">
                约 {article.estimatedPages} 页
              </span>
            </div>
            <button
              type="button"
              className="BookToc__item-button"
              onClick={() => handleOpenArticle(article)}
            >
              进入阅读
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
};


