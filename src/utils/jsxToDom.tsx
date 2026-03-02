import React from "react";
import { createRoot, Root } from "react-dom/client";
import { createPageDiv } from "./paginate";

/**
 * 等待 React 渲染完成
 * React 18 的 createRoot 和 render 是异步的，需要等待渲染完成
 */
function waitForReactRender(container: HTMLElement): Promise<void> {
  return new Promise<void>((resolve) => {
    // 如果容器已经有子节点，说明 React 已经渲染完成
    if (container.children.length > 0) {
      // 使用 requestAnimationFrame 确保浏览器完成渲染
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
      return;
    }

    // 如果还没有子节点，等待一下再检查
    const checkInterval = setInterval(() => {
      if (container.children.length > 0) {
        clearInterval(checkInterval);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }
    }, 10);

    // 设置超时，避免无限等待
    setTimeout(() => {
      clearInterval(checkInterval);
      resolve();
    }, 1000);
  });
}

/**
 * 将 JSX 元素渲染到 DOM 元素中
 * @param jsxElement JSX 元素
 * @param container 容器 DOM 元素（可选，如果不提供则创建新元素）
 * @returns 渲染后的 DOM 元素和 root 实例（用于后续清理）
 */
export function renderJsxToDom(
  jsxElement: React.ReactElement,
  container?: HTMLElement
): { element: HTMLElement; root: Root } {
  const targetContainer = container || document.createElement("div");
  const root = createRoot(targetContainer);
  root.render(jsxElement);
  return { element: targetContainer, root };
}

/**
 * 将 JSX 元素渲染到页面容器中（使用 createPageDiv 创建基础页面结构）
 * @param jsxElement JSX 元素
 * @param baseWidth 页面宽度
 * @param baseHeight 页面高度
 * @returns 渲染后的 DOM 元素和 root 实例，以及一个等待渲染完成的 Promise
 */
export function renderJsxToPage(
  jsxElement: React.ReactElement,
  baseWidth: number,
  baseHeight: number
): { element: HTMLElement; root: Root; renderPromise: Promise<void> } {
  const page = createPageDiv(baseWidth, baseHeight);
  const root = createRoot(page);
  root.render(jsxElement);
  const renderPromise = waitForReactRender(page);
  return { element: page, root, renderPromise };
}

