// src/hooks/useArticlePages.ts
import { useEffect, useState } from "react";
import React from "react";
import {
  paginateArticle,
  getCachedArticlePages,
} from "../core/pagination/articlePaginator";

interface UseArticlePagesOptions {
  baseWidth: number;
  baseHeight: number;
  reservedPages: number;
}

/**
 * 自定义 Hook：加载文章、分页、填充空白页，返回分页后的 DOM 数组
 * @param articleId 文章 ID（用于缓存和标识）
 * @param componentLoader 动态导入文章组件的函数（可能为 null）
 * @param options 选项
 */
export function useArticlePages(
  articleId: string,
  componentLoader:
    | (() => Promise<{ default: React.ComponentType<any> }>)
    | null
    | undefined,
  { baseWidth, baseHeight, reservedPages }: UseArticlePagesOptions
) {
  const [pages, setPages] = useState<HTMLElement[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!articleId || !componentLoader) return;

    // 1. 检查缓存
    const cached = getCachedArticlePages(articleId);
    if (cached) {
      setPages(cached.pages);
      return;
    }

    // 2. 未命中缓存 → 懒加载分页（次分割）
    setIsLoading(true);

    paginateArticle(articleId, componentLoader, {
      baseWidth,
      baseHeight,
    })
      .then((result) => {
        setPages(result.pages);
      })
      .catch((err) => {
        console.error("分页失败", err);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [articleId, componentLoader, baseWidth, baseHeight, reservedPages]);

  return { pages, isLoading };
}
