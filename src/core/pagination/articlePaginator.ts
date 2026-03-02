// 该模块负责：
// 1. 把一篇文章对应的 React 组件渲染到一个"隐藏容器"里；
// 2. 调用通用的 paginateDOM 工具函数，对 DOM 内容进行分页；
// 3. 对分页结果做多级缓存（内存 + sessionStorage），避免重复分页，提升性能。

import { createRoot, type Root } from "react-dom/client";
import React from "react";
import { paginateDOM } from "../../utils/paginate";
import { STORAGE_KEYS, getPaginationStorageKey } from "../../config";

// 单篇文章分页后的缓存结构
export interface CachedArticlePages {
  // 已经切分好的每一页根 DOM 节点
  pages: HTMLElement[];
  // 分页时使用的基准宽度（像素）
  baseWidth: number;
  // 分页时使用的基准高度（像素）
  baseHeight: number;
}

// 内存级缓存：当前标签页进程内共享，速度最快，但关闭标签就会全部丢失
// key：articleId；value：该文章的分页结果
// 注意：这里只缓存"最后一次分页"的结果，不做多版本管理
// 内存级缓存：当前标签页进程内共享，速度最快
const memoryPageCache = new Map<string, CachedArticlePages>();

// 从配置文件导入存储键前缀
const STORAGE_PREFIX = STORAGE_KEYS.PAGINATION_PREFIX;

// 存入 sessionStorage 时使用的“可序列化结构”
interface StoredArticlePages {
  baseWidth: number;
  baseHeight: number;
  // 每一页的 outerHTML，用字符串形式进行持久化
  pages: string[]; // 每一页的 outerHTML
}

// 生成带前缀的存储 key，保证命名空间隔离
// 使用配置文件中的便捷函数
const getStorageKey = getPaginationStorageKey;

// 尝试从 sessionStorage 中还原某篇文章的分页结果
// 可选传入期望的 baseWidth/baseHeight，用于在分页尺寸变更时自动忽略旧缓存
function revivePagesFromStorage(
  articleId: string,
  expectedBaseWidth?: number,
  expectedBaseHeight?: number
): CachedArticlePages | null {
  if (typeof window === "undefined" || !window.sessionStorage) return null;

  try {
    const raw = window.sessionStorage.getItem(getStorageKey(articleId));
    if (!raw) return null;

    const stored = JSON.parse(raw) as StoredArticlePages;

    // 如果调用方提供了期望的分页尺寸，但与缓存记录不一致，则认为缓存失效
    if (
      typeof expectedBaseWidth === "number" &&
      typeof expectedBaseHeight === "number" &&
      (stored.baseWidth !== expectedBaseWidth ||
        stored.baseHeight !== expectedBaseHeight)
    ) {
      return null;
    }
    const pages: HTMLElement[] = [];

    // 将字符串形式的 outerHTML 重新解析为真实 DOM 元素
    stored.pages.forEach((html) => {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = html;
      const el = wrapper.firstElementChild as HTMLElement | null;
      if (el) {
        pages.push(el);
      }
    });

    const revived: CachedArticlePages = {
      pages,
      baseWidth: stored.baseWidth,
      baseHeight: stored.baseHeight,
    };
    // 反序列化成功后顺便写回内存缓存，后续访问会更快
    memoryPageCache.set(articleId, revived);
    return revived;
  } catch (err) {
    console.error("[articlePaginator] 反序列化缓存失败", err);
    return null;
  }
}

// 将分页结果持久化到 sessionStorage（跨刷新复用）
function persistPagesToStorage(articleId: string, data: CachedArticlePages) {
  if (typeof window === "undefined" || !window.sessionStorage) return;

  try {
    const stored: StoredArticlePages = {
      baseWidth: data.baseWidth,
      baseHeight: data.baseHeight,
      // DOM 无法直接序列化，使用 outerHTML 字符串来保存
      pages: data.pages.map((el) => el.outerHTML),
    };
    window.sessionStorage.setItem(
      getStorageKey(articleId),
      JSON.stringify(stored)
    );
  } catch (err) {
    // 存不进去不影响主流程，最多丢失跨刷新的缓存
    console.warn("[articlePaginator] 持久化缓存失败", err);
  }
}

// 防止同一篇文章被重复分页
// key：articleId；value：正在进行中的分页 Promise
const inFlightTasks = new Map<string, Promise<CachedArticlePages>>();

/**
 * 对单篇文章执行分页。
 *
 * 调用流程：
 * 1. 先查内存缓存（命中率最高，成本最低）；
 * 2. 再尝试从 sessionStorage 恢复（跨刷新复用）；
 * 3. 若都没有，则真正触发分页：
 *    - 创建隐藏容器
 *    - 通过 loader 动态加载文章组件
 *    - 在隐藏容器中渲染组件
 *    - 调用 paginateDOM 对 DOM 内容进行分页
 *    - 结果写入内存缓存和 sessionStorage
 * 注意：不再在单篇文章末尾自动添加"全书完"页，改为在所有文章添加完成后统一处理
 */
export async function paginateArticle(
  articleId: string,
  // loader：按需加载文章组件的函数，一般是 import() 包装
  loader: () => Promise<{ default: React.ComponentType<any> }>,
  {
    baseWidth,
    baseHeight,
  }: {
    // 分页基准宽度（像素）
    baseWidth: number;
    // 分页基准高度（像素）
    baseHeight: number;
  }
): Promise<CachedArticlePages> {
  if (!articleId) {
    throw new Error("[paginateArticle] articleId 不能为空");
  }

  // 1. 先查内存缓存（仅当分页尺寸一致时才复用）
  const memoryHit = memoryPageCache.get(articleId);
  if (
    memoryHit &&
    memoryHit.baseWidth === baseWidth &&
    memoryHit.baseHeight === baseHeight
  ) {
    return memoryHit;
  }

  // 2. 再尝试从 sessionStorage 恢复（仅当分页尺寸一致时才复用）
  const revived = revivePagesFromStorage(
    articleId,
    baseWidth,
    baseHeight
  );
  if (revived) return revived;

  // 3. 若已有进行中的任务，直接等待，避免同一篇文章并发分页
  const inFlight = inFlightTasks.get(articleId);
  if (inFlight) return inFlight;

  const task = (async () => {
    // 3.1 创建隐藏容器：挂在 body 下但放在视口外，用户不可见
    const container = document.createElement("div");
    container.style.width = `${baseWidth}px`;
    container.style.height = `${baseHeight}px`;
    container.style.overflow = "hidden";
    container.style.position = "absolute";
    container.style.top = "-9999px";
    container.style.left = "-9999px";
    container.style.visibility = "hidden";
    document.body.appendChild(container);

    let root: Root | null = null;

    try {
      // 动态加载文章对应的 React 组件
      const module = await loader();
      const Component = module.default;
      root = createRoot(container);
      // 在 .ts 文件中避免使用 JSX，改用 React.createElement
      root.render(React.createElement(Component));

      // 粗略等待一次事件循环，让 React 完成渲染；
      // 若日后有需要，可以在这里扩展为更精细的“图片加载完成”检测
      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 0);
      });

      // 对已经渲染好的 DOM 内容按指定宽高进行分页
      const actualPages = await paginateDOM(
        container,
        baseWidth,
        baseHeight
      );

      // 不再在每篇文章末尾自动添加"全书完"页
      // 改为在所有文章都添加到书本后，根据最后一页的奇偶性统一决定是否添加
      const cached: CachedArticlePages = {
        pages: actualPages,
        baseWidth,
        baseHeight,
      };

      // 写入内存缓存与 sessionStorage，供后续快速复用
      memoryPageCache.set(articleId, cached);
      persistPagesToStorage(articleId, cached);

      return cached;
    } finally {
      // 统一清理隐藏容器和 React Root，避免内存泄漏
      if (root) {
        root.unmount();
      }
      if (container.parentNode) {
        document.body.removeChild(container);
      }
      // 无论成功或失败，该文章的 in-flight 状态都应移除
      inFlightTasks.delete(articleId);
    }
  })();

  // 记录当前文章的分页任务，后续同一篇文章的请求可以直接复用该 Promise
  inFlightTasks.set(articleId, task);
  return task;
}

// 只读地获取缓存中的分页结果，不会触发重新分页：
// - 先查内存缓存
// - 若未命中，再尝试从 sessionStorage 恢复
export function getCachedArticlePages(
  articleId: string
): CachedArticlePages | null {
  const hit = memoryPageCache.get(articleId);
  if (hit) return hit;
  return revivePagesFromStorage(articleId);
}


