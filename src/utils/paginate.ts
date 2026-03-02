// src/utils/paginate.ts

import { PAGINATION_CONFIG } from "../config";

/**
 * 核心分页工具：负责把已经渲染好的 MDX/文章 DOM 按「页面宽高」拆分成多页。
 *
 * 设计要点概要（更多细节见 docs/PaginationAlgorithm.mdx）：
 * - **输入**：隐藏容器中的完整文章 DOM、期望的单页宽度/高度（像素）
 * - **输出**：若干个 page `<div>`，每个都被限制在给定宽高内，供 turn.js 作为物理页使用
 * - **内容识别**：通过 `getElementType` 识别段落、图片、代码块、表格、列表、引用、自定义 HTML、网格等类型
 * - **高度测量**：统一走 `withMeasureContainer` / `getPageContentHeightAndMargin`，尽量模拟真实排版（含 margin 折叠）
 * - **拆分策略**：
 *   - 对于高度超过整页的元素，按类型分发到 `splitParagraph` / `splitCodeBlock` / `splitTable` / `splitList` 等函数
 *   - 对于接近页底的元素，优先尝试调用 `splitElementToFillRemaining` 做「当前页剩余高度填充」，减少大块空白
 * - **稳健性**：
 *   - 图片加载：`waitForImages` 在分页前尽量等待图片就绪，并为懒加载图片设置 `loading="eager"`
 *   - 超时兜底：所有等待与测量都有超时，避免极端情况下分页流程被卡死
 */

/**
 * 等待图片加载完成
 */
export function waitForImages(
  container: HTMLElement,
  options?: {
    /** 超时兜底（毫秒）。到时后直接 resolve，避免分页流程卡死 */
    timeoutMs?: number;
    /** 强制把 img.loading 设为 eager（对懒加载图片很关键） */
    forceEager?: boolean;
  }
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 15000;
  const forceEager = options?.forceEager ?? false;

  const images = Array.from(container.getElementsByTagName("img"));
  if (images.length === 0) return Promise.resolve();

  const perImagePromises = images.map((img) => {
    if (forceEager) {
      // 测量容器通常 offscreen/hidden，lazy 图片可能永远不触发加载
      try {
        img.loading = "eager";
      } catch {
        // ignore
      }
      try {
        img.decoding = "async";
      } catch {
        // ignore
      }
      try {
        (img as unknown as { fetchPriority?: string }).fetchPriority = "high";
      } catch {
        // ignore
      }
    }

    // 已可用：complete + naturalWidth>0
    if (img.complete && img.naturalWidth > 0) return Promise.resolve();

    const loadOrError = new Promise<void>((resolve) => {
      const done = () => resolve();
      img.addEventListener("load", done, { once: true });
      img.addEventListener("error", done, { once: true });
    });

    const decodePromise =
      typeof img.decode === "function"
        ? img
            .decode()
            .then(() => {})
            .catch(() => {})
        : Promise.resolve();

    const timeoutPromise = new Promise<void>((resolve) => {
      window.setTimeout(resolve, timeoutMs);
    });

    // 任一条件满足就继续（load/error/decode/timeout）
    return Promise.race([loadOrError, decodePromise, timeoutPromise]);
  });

  // 整体兜底超时，避免极端情况下 hang
  return Promise.race([
    Promise.all(perImagePromises).then(() => {}),
    new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs)),
  ]);
}

/**
 * 创建一个空白页 DOM
 */
export function createPageDiv(width: number, height: number): HTMLDivElement {
  const div = document.createElement("div");
  div.style.width = width + "px";
  div.style.height = height + "px";
  div.style.overflow = "hidden";
  div.style.position = "relative";
  div.style.boxSizing = "border-box";
  return div;
}

// ========== 辅助函数 ==========

/**
 * 创建测量容器
 */
function createMeasureContainer(
  width: number,
  element: HTMLElement
): HTMLDivElement {
  const container = document.createElement("div");
  const style = window.getComputedStyle(element);
  container.style.width = width + "px";
  container.style.visibility = "hidden";
  container.style.position = "absolute";
  container.style.top = "-9999px";
  container.style.left = "-9999px";
  container.style.font = style.font;
  container.style.lineHeight = style.lineHeight;
  container.style.whiteSpace = "pre-wrap";
  container.style.wordBreak = "break-word";
  container.style.boxSizing = "border-box";
  document.body.appendChild(container);
  return container;
}

/**
 * 在单次调用中创建并复用测量容器，执行测量逻辑后自动清理
 */
function withMeasureContainer<T>(
  element: HTMLElement,
  width: number,
  cb: (container: HTMLDivElement) => T
): T {
  const measureContainer = createMeasureContainer(width, element);
  try {
    return cb(measureContainer);
  } finally {
    document.body.removeChild(measureContainer);
  }
}

/**
 * 获取元素的实际高度（包含边距和边框）
 */
function getElementHeight(element: HTMLElement): number {
  const style = window.getComputedStyle(element);
  const marginTop = parseFloat(style.marginTop) || 0;
  const marginBottom = parseFloat(style.marginBottom) || 0;
  
  return (
    element.offsetHeight + marginTop + marginBottom
  );
}

/**
 * 专门用于表格行的高度测量：在独立 table + tbody 环境中测量单行高度
 */
function measureTableRowHeight(row: HTMLElement, pageWidth: number): number {
  return withMeasureContainer(row, pageWidth, (container) => {
    const table = document.createElement("table");
    const tbody = document.createElement("tbody");
    tbody.appendChild(row.cloneNode(true));
    table.appendChild(tbody);
    container.appendChild(table);
    return container.offsetHeight;
  });
}

/**
 * 当前页剩余空间至少达到此高度（px）才尝试对元素做"部分填充"拆分，避免无意义断行
 *
 * 说明：
 * - 之前这个阈值偏高，导致即便剩余空间还比较可观，也直接整块换页 → 留下大块空白；
 * - 现在仍然允许从配置中读取一个“建议值”，但在主流程里会做更保守的处理：
 *   只要还有正的剩余高度，就会尝试拆分；各类型的 splitXXXToFillRemaining 内部
 *   再基于自身逻辑决定是否真的要拆（例如段落最小占比、图片最小缩放比等）。
 */
const MIN_REMAINING_TO_SPLIT = PAGINATION_CONFIG.MIN_REMAINING_TO_SPLIT;

/**
 * 计算一页内已有内容的高度及最后一个元素的下外边距（用于外边距折叠）
 */
function getPageContentHeightAndMargin(
  page: HTMLElement
): { height: number; lastMarginBottom: number } {

  let height = 0;
  let lastMarginBottom = 0;

  const children = Array.from(page.children) as HTMLElement[];

  for (const child of children) {
    const style = window.getComputedStyle(child);
    const marginTop = parseFloat(style.marginTop) || 0;
    const marginBottom = parseFloat(style.marginBottom) || 0;
    const base = child.offsetHeight;
    const extraTop = Math.max(0, marginTop - lastMarginBottom);
    height += extraTop + base + marginBottom;
    lastMarginBottom = marginBottom;

  }
  return { height, lastMarginBottom };
}

/**
 * 判断元素是否可按内容拆分（段落、列表、表格等可拆；图片、标题、代码块等通常整体处理）
 */
function isElementSplittable(element: HTMLElement): boolean {
  const t = getElementType(element);
  
  return (
    t === "paragraph" ||
    t === "image" ||
    // 代码块：在“整页拆分”时仍优先整体移动/缩放；
    // 但在“页尾剩余高度填充”场景下，允许被拆分到前后两页
    t === "code" ||
    t === "list" ||
    t === "table" ||
    t === "blockquote" ||
    t === "custom-html" ||
    t === "grid"
  );
}

/**
 * 检查并修复元素的横向溢出
 * 如果元素宽度超过页面宽度，进行缩放或调整
 */
function fixHorizontalOverflow(
  element: HTMLElement,
  pageWidth: number
): void {
  const style = window.getComputedStyle(element);
  const elementWidth = element.offsetWidth;
  const paddingLeft = parseFloat(style.paddingLeft) || 0;
  const paddingRight = parseFloat(style.paddingRight) || 0;
  const marginLeft = parseFloat(style.marginLeft) || 0;
  const marginRight = parseFloat(style.marginRight) || 0;
  const totalWidth = elementWidth + paddingLeft + paddingRight + marginLeft + marginRight;

  if (totalWidth > pageWidth) {
    // 计算缩放比例，预留 5% 的安全边距
    const safeWidth = pageWidth * 0.95;
    const scale = safeWidth / totalWidth;
    
    if (scale < 1) {
      // 使用 transform 缩放，保持布局结构
      element.style.transformOrigin = "top left";
      element.style.transform = `scale(${scale})`;
      // 调整容器高度以容纳缩放后的内容
      const originalHeight = element.offsetHeight;
      element.style.height = (originalHeight / scale) + "px";
    } else {
      // 如果只是稍微超出，直接设置最大宽度
      element.style.maxWidth = safeWidth + "px";
      element.style.overflowX = "auto";
      element.style.wordBreak = "break-word";
    }
  }
}

// ========== 元素拆分函数 ==========

/**
 * 检查元素是否使用网格布局
 */
function isGridLayout(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  return style.display === "grid" || style.display === "inline-grid";
}

/**
 * 根据元素类名 / 结构判断元素类型
 *
 * 这里要特别处理“包装容器”的情况：
 * 比如图片会是：mdx-paragraph > image-container > img
 * 如果只看最外层 class（mdx-paragraph），会被误判成 paragraph，导致图片走错分页逻辑。
 */
function getElementType(element: HTMLElement): string {
  const classList = element.classList;

  // 1. 优先处理“段落包装了单一特殊块”的场景
  if (classList.contains("mdx-paragraph")) {
    // 如果这个段落本身没有有效文本，只是一个包装容器，
    // 尝试根据内部的主要子元素类型来识别真正类型。
    const hasText =
      Array.from(element.childNodes).some(
        (node) =>
          node.nodeType === Node.TEXT_NODE && node.textContent?.trim().length
      );

    if (!hasText) {
      // 注意：这里按“更具体”的类型优先级来判断
      if (element.querySelector(".image-container, img")) return "image";
      if (element.querySelector(".table-container")) return "table";
      if (element.querySelector(".mdx-code-block, pre")) return "code";
      if (element.querySelector(".mdx-list, .mdx-ordered-list")) return "list";
      if (element.querySelector(".mdx-heading")) return "heading";
      if (element.querySelector(".mdx-blockquote")) return "blockquote";
      if (element.querySelector(".custom-html")) return "custom-html";
      const gridChild = Array.from(
        element.children
      ) as unknown as HTMLElement[];
      if (gridChild.some((child) => isGridLayout(child))) return "grid";
    }

    // 否则就当作正常段落处理（可被拆分成文本块）
    return "paragraph";
  }

  // 2. 非“包装段落”的常规类型判断（仍然只看自身）
  if (classList.contains("table-container")) return "table";
  if (classList.contains("image-container")) return "image";
  if (classList.contains("mdx-blockquote")) return "blockquote";
  if (classList.contains("mdx-list") || classList.contains("mdx-ordered-list"))
    return "list";
  if (classList.contains("mdx-heading")) return "heading";
  if (element.tagName === "PRE" || classList.contains("mdx-code-block"))
    return "code";
  if (element.tagName === "IMG") return "image";
  if (classList.contains("custom-html")) return "custom-html";
  if (isGridLayout(element)) return "grid";

  return "unknown";
}

/**
 * 给定文本和最大高度，使用二分查找找到在该高度内可容纳的最大字符数
 */
function findMaxCharsForHeight(
  text: string,
  maxHeight: number,
  measureTextHeight: (substr: string) => number
): { count: number; height: number } {
  if (!text.length || maxHeight <= 0) {
    return { count: 0, height: 0 };
  }

  let low = 1;
  let high = text.length;
  let bestCount = 0;
  let bestHeight = 0;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const slice = text.slice(0, mid);
    const h = measureTextHeight(slice);
    if (h <= maxHeight) {
      bestCount = mid;
      bestHeight = h;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (bestCount === 0) {
    // 理论上极少出现单字符都放不下的情况，这里兜底返回首字符
    const h = measureTextHeight(text.slice(0, 1));
    return { count: 1, height: h };
  }

  return { count: bestCount, height: bestHeight };
}

/**
 * 通用容器拆分：按子元素递归分页（用于未知/复杂 MDX 容器的兜底拆分）
 * - 保留容器本身（className、样式）
 * - 尽量让子元素落在不同页面上，避免整块内容溢出
 */
async function splitGenericContainer(
  element: HTMLElement,
  pageWidth: number,
  pageHeight: number
): Promise<HTMLElement[]> {
  const pages: HTMLElement[] = [];
  const children = Array.from(element.children) as HTMLElement[];

  if (children.length === 0) {
    const page = createPageDiv(pageWidth, pageHeight);
    const cloned = element.cloneNode(true) as HTMLElement;
    fixHorizontalOverflow(cloned, pageWidth);
    page.appendChild(cloned);
    return [page];
  }

  let currentPage = createPageDiv(pageWidth, pageHeight);
  let currentWrapper = element.cloneNode(false) as HTMLElement;
  // 复制原始样式，但确保不溢出
  const originalStyle = window.getComputedStyle(element);
  currentWrapper.style.cssText = originalStyle.cssText;
  fixHorizontalOverflow(currentWrapper, pageWidth);
  currentPage.appendChild(currentWrapper);

  let { height: currentHeight, lastMarginBottom } =
    getPageContentHeightAndMargin(currentWrapper);

  for (const child of children) {
    const style = window.getComputedStyle(child);
    const marginTop = parseFloat(style.marginTop) || 0;
    const marginBottom = parseFloat(style.marginBottom) || 0;

    const baseHeight = child.offsetHeight;
    const singleElementHeight = baseHeight + marginTop + marginBottom;

    // 子元素本身就高于整页：尝试按类型进一步拆分，实在不行则让它单独一页
    if (singleElementHeight > pageHeight) {
      if (currentWrapper.children.length > 0) {
        pages.push(currentPage);
        currentPage = createPageDiv(pageWidth, pageHeight);
        currentWrapper = element.cloneNode(false) as HTMLElement;
        currentPage.appendChild(currentWrapper);
        currentHeight = 0;
        lastMarginBottom = 0;
      }

      const splitPages = await splitElementByType(child, pageWidth, pageHeight);
      pages.push(...splitPages);
      currentPage = createPageDiv(pageWidth, pageHeight);
      currentWrapper = element.cloneNode(false) as HTMLElement;
      currentPage.appendChild(currentWrapper);
      currentHeight = 0;
      lastMarginBottom = 0;
      continue;
    }

    // 先尝试直接放入 wrapper 再测量
    const clonedChild = child.cloneNode(true) as HTMLElement;
    // 处理子元素的横向溢出
    fixHorizontalOverflow(clonedChild, pageWidth);
    currentWrapper.appendChild(clonedChild);
    const measure = getPageContentHeightAndMargin(currentWrapper);

    if (measure.height <= pageHeight) {
      currentHeight = measure.height;
      lastMarginBottom = measure.lastMarginBottom;
      continue;
    }

    // 放不下：结束当前页，新起一页
    currentWrapper.removeChild(clonedChild);
    pages.push(currentPage);
    currentPage = createPageDiv(pageWidth, pageHeight);
    currentWrapper = element.cloneNode(false) as HTMLElement;
    currentPage.appendChild(currentWrapper);

    const clonedForNext = child.cloneNode(true) as HTMLElement;
    fixHorizontalOverflow(clonedForNext, pageWidth);
    currentWrapper.appendChild(clonedForNext);
    const nextMeasure = getPageContentHeightAndMargin(currentWrapper);
    currentHeight = nextMeasure.height;
    lastMarginBottom = nextMeasure.lastMarginBottom;
  }

  if (currentWrapper.children.length > 0) {
    pages.push(currentPage);
  }

  return pages;
}

/**
 * 拆分段落（按行），处理行内代码等特殊元素
 */
async function splitParagraph(
  element: HTMLElement,
  pageWidth: number,
  pageHeight: number
): Promise<HTMLElement[]> {
  // 如果段落包含复杂的HTML结构（如行内代码），需要特殊处理
  const hasInlineCode = element.querySelector("code.mdx-inline-code, code.inline-code");
  
  if (hasInlineCode || element.innerHTML !== element.textContent) {
    // 包含HTML结构，使用克隆和拆分的方式
    return splitGenericContainer(element, pageWidth, pageHeight);
  }

  const textContent = element.textContent || "";
  if (!textContent) {
    const emptyPage = createPageDiv(pageWidth, pageHeight);
    return [emptyPage];
  }

  const pages = withMeasureContainer(element, pageWidth, (measureContainer) => {
    const result: HTMLElement[] = [];
    let remainingText = textContent;

    // 设置换行和断词，确保行内代码可以换行
    measureContainer.style.wordBreak = "break-word";
    measureContainer.style.overflowWrap = "break-word";
    measureContainer.style.whiteSpace = "pre-wrap";

    const measureTextHeight = (substr: string) => {
      measureContainer.textContent = substr || " ";
      return measureContainer.offsetHeight;
    };

    while (remainingText.length > 0) {
      const { count, height: _height } = findMaxCharsForHeight(
        remainingText,
        pageHeight,
        measureTextHeight
      );
      const chunkText = remainingText.slice(0, count);
      remainingText = remainingText.slice(count);

      const pageDiv = createPageDiv(pageWidth, pageHeight);
      const p = element.cloneNode(false) as HTMLElement;
      p.style.margin = window.getComputedStyle(element).margin;
      p.style.padding = window.getComputedStyle(element).padding;
      p.style.wordBreak = "break-word";
      p.style.overflowWrap = "break-word";
      p.style.whiteSpace = "pre-wrap";
      p.textContent = chunkText;
      pageDiv.appendChild(p);
      result.push(pageDiv);
    }

    return result;
  });

  return pages;
}

/** 部分填充拆分结果：首块（放入当前页）、剩余页、首块占高及下外边距 */
export type SplitToFillResult = {
  firstChunk: HTMLElement | null;
  restPages: HTMLElement[];
  firstChunkHeight: number;
  firstChunkMarginBottom: number;
};

/**
 * 在不破坏内部标签结构（如粗体、斜体、行内代码）的前提下，
 * 按“已使用字符数”将元素的 DOM 拆成前后两部分。
 *
 * - 通过递归遍历节点树（Element / Text），根据全局 consumedChars 控制拆分位置；
 * - Text 节点在拆分点被切成两段，两侧分别挂载到前半段、后半段 DOM 上；
 * - Element 节点只 clone 外壳（cloneNode(false) 保留标签名、属性、class），
 *   再递归拆分其子节点并分别挂到前/后外壳上。
 */
function splitElementByTextCountPreserveStructure(
  element: HTMLElement,
  usedCharCount: number
): { first: HTMLElement | null; rest: HTMLElement | null } {
  let consumed = 0;

  const splitNode = (node: Node): { first: Node | null; rest: Node | null } => {
    // 文本节点：根据剩余字符数决定落到前半段 / 后半段，或被一分为二
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || "";
      if (!text.length) {
        return { first: null, rest: null };
      }

      const remaining = usedCharCount - consumed;
      if (remaining <= 0) {
        // 拆分点已过，全部进入后半段
        return { first: null, rest: node.cloneNode(true) };
      }
      if (remaining >= text.length) {
        // 整段文本全部进入前半段
        consumed += text.length;
        return { first: node.cloneNode(true), rest: null };
      }

      // 文本需要在此节点内拆分
      const firstText = text.slice(0, remaining);
      const restText = text.slice(remaining);
      consumed += remaining;
      const firstNode = document.createTextNode(firstText);
      const restNode = document.createTextNode(restText);
      return { first: firstNode, rest: restNode };
    }

    // 元素节点：clone 外壳，再对子节点递归拆分
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const firstEl = el.cloneNode(false) as HTMLElement;
      const restEl = el.cloneNode(false) as HTMLElement;
      let hasFirstChild = false;
      let hasRestChild = false;

      const childNodes = Array.from(el.childNodes);
      for (const child of childNodes) {
        const { first, rest } = splitNode(child);
        if (first) {
          firstEl.appendChild(first);
          hasFirstChild = true;
        }
        if (rest) {
          restEl.appendChild(rest);
          hasRestChild = true;
        }
      }

      return {
        first: hasFirstChild ? firstEl : null,
        rest: hasRestChild ? restEl : null,
      };
    }

    // 其他节点类型（如注释、空白等），按“拆分点之前 → 前半段，之后 → 后半段”简单归类
    const remaining = usedCharCount - consumed;
    if (remaining > 0) {
      return { first: node.cloneNode(true), rest: null };
    }
    return { first: null, rest: node.cloneNode(true) };
  };

  const { first, rest } = splitNode(element);
  return {
    first: first as HTMLElement | null,
    rest: rest as HTMLElement | null,
  };
}

/**
 * 段落按剩余高度拆分：能放进当前页的部分作为 firstChunk，其余按页拆分到 restPages
 *
 * 未来如果需要对富文本段落也做“结构保留”的部分拆分，可以考虑：
 * - 使用 TreeWalker / Range 遍历内部 Text 节点，累积字符数直到达到 usedCharCount；
 * - 在精确的文本边界上切割节点树，克隆出“前半段 DOM”和“后半段 DOM”，分别挂到 firstChunk 与后续页面；
 * - 这样既能保持 inline code / 加粗 / 斜体 等标签结构，又能做到按高度精细填充，但实现成本较高。
 */
async function splitParagraphToFillRemaining(
  element: HTMLElement,
  pageWidth: number,
  pageHeight: number,
  remainingHeight: number,
  lastMarginBottom: number
): Promise<SplitToFillResult> {
  const style = window.getComputedStyle(element);
  const marginTop = parseFloat(style.marginTop) || 0;
  const marginBottom = parseFloat(style.marginBottom) || 0;
  const effectiveTop = Math.max(0, marginTop - lastMarginBottom);
  const maxContentHeight = remainingHeight - effectiveTop - marginBottom;

  if (maxContentHeight <= 0) {
    return {
      firstChunk: null,
      restPages: [],
      firstChunkHeight: 0,
      firstChunkMarginBottom: marginBottom,
    };
  }

  const textContent = element.textContent || "";

  if (!textContent) {
    return {
      firstChunk: null,
      restPages: [],
      firstChunkHeight: 0,
      firstChunkMarginBottom: marginBottom,
    };
  }

  const { count: usedCharCount, height: contentHeight } = withMeasureContainer(
    element,
    pageWidth,
    (measureContainer) => {
      const measureTextHeight = (substr: string) => {
        measureContainer.textContent = substr || " ";
        return measureContainer.offsetHeight;
      };
      return findMaxCharsForHeight(textContent, maxContentHeight, measureTextHeight);
    }
  );

  if (usedCharCount <= 0) {
    return {
      firstChunk: null,
      restPages: [],
      firstChunkHeight: 0,
      firstChunkMarginBottom: marginBottom,
    };
  }

  // 如果当前页只能容纳极少一部分（例如只容纳 1 个字符），与其强行拆分，不如把整段移动到下一页，
  // 避免出现“当前页只剩一个字，剩余内容全部到下一页”的极端视觉效果。
  const totalLength = textContent.length;
  if (totalLength > 0) {
    const ratio = usedCharCount / totalLength;
    const MIN_FIRST_CHUNK_RATIO = 0.1; // 首块至少占整段 10% 文本，否则放弃拆分
    const MIN_FIRST_CHUNK_CHARS = 8; // 或者至少 8 个字符

    if (ratio < MIN_FIRST_CHUNK_RATIO && usedCharCount < MIN_FIRST_CHUNK_CHARS) {
      return {
        firstChunk: null,
        restPages: [],
        firstChunkHeight: 0,
        firstChunkMarginBottom: marginBottom,
      };
    }
  }

  // 检测是否为富文本段落（包含行内代码或其他内联标签）
  const hasInlineCode = element.querySelector(
    "code.mdx-inline-code, code.inline-code"
  );
  const hasRichHtml = hasInlineCode || element.innerHTML !== element.textContent;

  // 富文本段落：使用“结构保留”的 DOM 拆分方式，保证前后页样式一致
  if (hasRichHtml) {
    const { first, rest } = splitElementByTextCountPreserveStructure(
      element,
      usedCharCount
    );

    if (!first) {
      return {
        firstChunk: null,
        restPages: [],
        firstChunkHeight: 0,
        firstChunkMarginBottom: marginBottom,
      };
    }

    const firstChunk = first;
    // 为首块根元素补齐与原节点一致的 display / margin 等内联样式（cloneNode(false) 已保留大部分属性，这里再兜底一次）
    const computed = window.getComputedStyle(element);
    firstChunk.style.cssText = computed.cssText;

    let restPages: HTMLElement[] = [];
    if (rest && (rest.textContent || "").trim()) {
      const restParagraph = rest;
      // 保持与原段落相同的 class 与样式，便于后续走 splitParagraph 的富文本分页逻辑
      restParagraph.className = element.className;
      restParagraph.style.cssText = computed.cssText;
      restPages = await splitParagraph(restParagraph, pageWidth, pageHeight);
    }

    const firstChunkHeight = effectiveTop + contentHeight + marginBottom;
    return {
      firstChunk,
      restPages,
      firstChunkHeight,
      firstChunkMarginBottom: marginBottom,
    };
  }

  // 纯文本段落：仍按原先逻辑，用简化的 <p> 容器承载文本
  const firstText = textContent.slice(0, usedCharCount);
  const restText = textContent.slice(usedCharCount);

  const firstChunk = document.createElement("div");
  firstChunk.className = element.className;
  firstChunk.style.cssText = window.getComputedStyle(element).cssText;
  const p = document.createElement("p");
  p.style.margin = "0";
  p.style.padding = "0";
  p.textContent = firstText;
  firstChunk.appendChild(p);

  let restPages: HTMLElement[] = [];
  if (restText.trim()) {
    const restParagraph = document.createElement("div");
    restParagraph.className = element.className;
    restParagraph.style.cssText = window.getComputedStyle(element).cssText;
    const restP = document.createElement("p");
    restP.style.margin = "0";
    restP.style.padding = "0";
    restP.textContent = restText;
    restParagraph.appendChild(restP);
    restPages = await splitParagraph(restParagraph, pageWidth, pageHeight);
  }

  const firstChunkHeight = effectiveTop + contentHeight + marginBottom;
  return {
    firstChunk,
    restPages,
    firstChunkHeight,
    firstChunkMarginBottom: marginBottom,
  };
}

/**
 * 代码块分页策略（新版）：
 * - 不再强行按“行”拆分，避免破坏语法高亮等内部结构
 * - 对于高度不超过一页的代码块：整体移动到新页，完整保留结构和样式
 * - 对于高度超过一页的代码块：整体克隆后按比例缩放，尽量在一页内完整展示
 */
async function splitCodeBlock(
  element: HTMLElement,
  pageWidth: number,
  pageHeight: number
): Promise<HTMLElement[]> {
  const pages: HTMLElement[] = [];

  // 使用测量容器精确测量代码块实际高度（包含 margin）
  const rawHeight = withMeasureContainer(element, pageWidth, (container) => {
    const clone = element.cloneNode(true) as HTMLElement;
    container.appendChild(clone);
    return getElementHeight(clone);
  });

  const page = createPageDiv(pageWidth, pageHeight);

  // 使用测量容器检查横向溢出
  const rawWidth = withMeasureContainer(element, pageWidth, (container) => {
    const clone = element.cloneNode(true) as HTMLElement;
    container.appendChild(clone);
    return clone.offsetWidth;
  });

  // 高度在一页内：整体克隆即可
  if (rawHeight <= pageHeight) {
    const wrapperClone = element.cloneNode(true) as HTMLElement;
    // 检查并修复横向溢出
    fixHorizontalOverflow(wrapperClone, pageWidth);
    page.appendChild(wrapperClone);
    pages.push(page);
    return pages;
  }

  // 超过一页：按比例整体缩放，优先保证完整可见和样式一致
  page.style.display = "flex";
  page.style.alignItems = "flex-start";
  page.style.justifyContent = "center";
  page.style.overflow = "hidden";

  const wrapperClone = element.cloneNode(true) as HTMLElement;

  // 预留 10% 垂直空间给页脚 / 内边距等，避免再次溢出
  const safeHeight = pageHeight * 0.9;
  const heightScale = safeHeight / rawHeight;
  
  // 同时考虑横向溢出
  const safeWidth = pageWidth * 0.95;
  const widthScale = rawWidth > safeWidth ? safeWidth / rawWidth : 1;
  
  // 取较小的缩放比例，确保不溢出
  const scaleFactor = Math.min(heightScale, widthScale, 1);

  if (scaleFactor < 1) {
    wrapperClone.style.transformOrigin = "top left";
    wrapperClone.style.transform = `scale(${scaleFactor})`;
    // 调整容器尺寸以容纳缩放后的内容
    wrapperClone.style.width = (rawWidth / scaleFactor) + "px";
    wrapperClone.style.height = (rawHeight / scaleFactor) + "px";
  } else {
    // 即使不需要缩放，也要检查横向溢出
    fixHorizontalOverflow(wrapperClone, pageWidth);
  }

  page.appendChild(wrapperClone);
  pages.push(page);
  return pages;
}

/**
 * 代码块按“当前页剩余高度”拆分：
 * - 使用“结构保留”的 DOM 拆分方式，保证语法高亮等内部标签不丢失；
 * - 首块填充当前页剩余高度，剩余部分作为一个新的完整代码块，继续走 splitCodeBlock 分页策略。
 */
async function splitCodeBlockToFillRemaining(
  element: HTMLElement,
  pageWidth: number,
  pageHeight: number,
  remainingHeight: number,
  lastMarginBottom: number
): Promise<SplitToFillResult> {
  const style = window.getComputedStyle(element);
  const marginTop = parseFloat(style.marginTop) || 0;
  const marginBottom = parseFloat(style.marginBottom) || 0;
  const effectiveTop = Math.max(0, marginTop - lastMarginBottom);
  const maxContentHeight = remainingHeight - effectiveTop - marginBottom;

  if (maxContentHeight <= 0) {
    return {
      firstChunk: null,
      restPages: [],
      firstChunkHeight: 0,
      firstChunkMarginBottom: marginBottom,
    };
  }

  // 使用元素整体的文本内容来计算可容纳字符数，但实际拆分时保留内部结构（语法高亮 span 等）
  const codeText = element.textContent || "";
  if (!codeText) {
    return {
      firstChunk: null,
      restPages: [],
      firstChunkHeight: 0,
      firstChunkMarginBottom: marginBottom,
    };
  }

  // 在测量容器中，通过“按字符截断 + 二分查找”的方式找到在 maxContentHeight 内可容纳的最大字符数
  const { count: usedCharCount, height: contentHeight } = withMeasureContainer(
    element,
    pageWidth,
    (measureContainer) => {
      const measured = element.cloneNode(true) as HTMLElement;
      const computed = window.getComputedStyle(element);
      measured.style.cssText = computed.cssText;
      // 外边距在外层统一处理，这里去掉自身 margin 影响测量
      measured.style.marginTop = "0";
      measured.style.marginBottom = "0";
      measureContainer.appendChild(measured);

      const measureTextHeight = (substr: string) => {
        measured.textContent = substr || " ";
        return measureContainer.offsetHeight;
      };

      return findMaxCharsForHeight(
        codeText,
        maxContentHeight,
        measureTextHeight
      );
    }
  );

  if (usedCharCount <= 0) {
    return {
      firstChunk: null,
      restPages: [],
      firstChunkHeight: 0,
      firstChunkMarginBottom: marginBottom,
    };
  }

  // 使用“结构保留”的 DOM 拆分方法，在 usedCharCount 处切分代码块 DOM，
  // 保证语法高亮的 span/token 等内部结构在前后两部分中都被保留。
  const { first, rest } = splitElementByTextCountPreserveStructure(
    element,
    usedCharCount
  );

  if (!first) {
    return {
      firstChunk: null,
      restPages: [],
      firstChunkHeight: 0,
      firstChunkMarginBottom: marginBottom,
    };
  }

  const firstChunk = first as HTMLElement;
  const computedFirst = window.getComputedStyle(element);
  firstChunk.style.cssText = computedFirst.cssText;

  let restPages: HTMLElement[] = [];
  if (rest && (rest.textContent || "").trim()) {
    const restWrapper = rest as HTMLElement;
    // 保持与原根节点相同的类名和样式，便于沿用现有代码块分页策略
    restWrapper.className = element.className;
    const computedRest = window.getComputedStyle(element);
    restWrapper.style.cssText = computedRest.cssText;

    // 剩余部分交给现有的代码块分页策略处理（整体一页或缩放），
    // 由于内部结构已被保留，语法高亮等样式也会继续生效。
    restPages = await splitCodeBlock(restWrapper, pageWidth, pageHeight);
  }

  const firstChunkHeight = effectiveTop + contentHeight + marginBottom;
  return {
    firstChunk,
    restPages,
    firstChunkHeight,
    firstChunkMarginBottom: marginBottom,
  };
}

/**
 * 拆分表格
 */
async function splitTable(
  element: HTMLTableElement | HTMLElement,
  pageWidth: number,
  pageHeight: number
): Promise<HTMLElement[]> {
  const pages: HTMLElement[] = [];

  // 统一找到真正的 table 节点，支持外层有 .table-container 包裹的情况
  const wrapper =
    element.tagName === "TABLE"
      ? (element as HTMLTableElement)
      : ((element as HTMLElement).querySelector("table") as HTMLTableElement | null);

  if (!wrapper) {
    return [];
  }

  const originalWrapper =
    element.tagName === "TABLE" ? null : (element as HTMLElement);

  const baseTable = wrapper.cloneNode(true) as HTMLTableElement;
  // 设置表格宽度，并处理横向溢出
  const safeTableWidth = pageWidth * 0.95; // 预留 5% 安全边距
  baseTable.style.width = safeTableWidth + "px";
  baseTable.style.tableLayout = "auto";
  baseTable.style.wordBreak = "break-word";
  baseTable.style.overflowWrap = "break-word";
  
  // 确保表格单元格内容可以换行
  const cells = baseTable.querySelectorAll("td, th");
  cells.forEach((cell) => {
    (cell as HTMLElement).style.wordBreak = "break-word";
    (cell as HTMLElement).style.overflowWrap = "break-word";
    (cell as HTMLElement).style.whiteSpace = "normal";
  });

  // 测量表头高度
  let headerHeight = 0;
  const thead = baseTable.querySelector("thead");
  if (thead) {
    const tempContainer = createMeasureContainer(pageWidth, thead as HTMLElement);
    tempContainer.appendChild(thead.cloneNode(true));
    headerHeight = tempContainer.offsetHeight;
    document.body.removeChild(tempContainer);
  }

  const tbody = baseTable.querySelector("tbody") || baseTable;
  const rows = Array.from(tbody.querySelectorAll("tr"));

  // 为表格整体预留约 10% 的安全空间，避免被页脚 / padding 挤出视口
  const usablePageHeight = pageHeight * 0.9;

  let currentPageDiv = createPageDiv(pageWidth, pageHeight);
  let currentHeight = headerHeight;
  let bufferRows: HTMLElement[] = [];

  for (const row of rows) {
    const rowElement = row as HTMLElement;
    const rowHeight = measureTableRowHeight(rowElement, pageWidth);

    if (currentHeight + rowHeight > usablePageHeight) {
      // 保存当前页
      if (bufferRows.length > 0) {
        const tableClone = baseTable.cloneNode(false) as HTMLTableElement;
        if (thead) {
          tableClone.appendChild(thead.cloneNode(true));
        }
        const tbodyClone = document.createElement("tbody");
        bufferRows.forEach((r) => tbodyClone.appendChild(r.cloneNode(true)));
        tableClone.appendChild(tbodyClone);
        if (originalWrapper) {
          const wrapperClone = originalWrapper.cloneNode(false) as HTMLElement;
          wrapperClone.appendChild(tableClone);
          currentPageDiv.appendChild(wrapperClone);
        } else {
          currentPageDiv.appendChild(tableClone);
        }

        // 添加续表标记
        const note = document.createElement("div");
        note.style.textAlign = "right";
        note.style.fontSize = "12px";
        note.style.color = "#999";
        note.style.marginTop = "8px";
        note.style.fontStyle = "italic";
        note.textContent = "（续表）";
        currentPageDiv.appendChild(note);
      }
      pages.push(currentPageDiv);

      // 创建新页并重新添加表头
      currentPageDiv = createPageDiv(pageWidth, pageHeight);
      currentHeight = headerHeight;
      bufferRows = [row];
      currentHeight += rowHeight;
    } else {
      bufferRows.push(row);
      currentHeight += rowHeight;
    }
  }

  // 添加最后一页
  if (bufferRows.length > 0) {
    const tableClone = baseTable.cloneNode(false) as HTMLTableElement;
    if (thead) {
      tableClone.appendChild(thead.cloneNode(true));
    }
    const tbodyClone = document.createElement("tbody");
    bufferRows.forEach((r) => tbodyClone.appendChild(r.cloneNode(true)));
    tableClone.appendChild(tbodyClone);
    if (originalWrapper) {
      const wrapperClone = originalWrapper.cloneNode(false) as HTMLElement;
      wrapperClone.appendChild(tableClone);
      currentPageDiv.appendChild(wrapperClone);
    } else {
      currentPageDiv.appendChild(tableClone);
    }
    pages.push(currentPageDiv);
  }

  return pages;
}

/**
 * 表格按剩余高度拆分：当前页放表头+能放下的行，其余为续表
 */
async function splitTableToFillRemaining(
  element: HTMLElement,
  pageWidth: number,
  pageHeight: number,
  remainingHeight: number,
  lastMarginBottom: number
): Promise<SplitToFillResult> {
  const tableEl =
    element.tagName === "TABLE"
      ? (element as HTMLTableElement)
      : (element.querySelector("table") as HTMLTableElement | null);
  if (!tableEl) {
    return {
      firstChunk: null,
      restPages: [],
      firstChunkHeight: 0,
      firstChunkMarginBottom: parseFloat(window.getComputedStyle(element).marginBottom) || 0,
    };
  }

  const style = window.getComputedStyle(element);
  const marginTop = parseFloat(style.marginTop) || 0;
  const marginBottom = parseFloat(style.marginBottom) || 0;
  const effectiveTop = Math.max(0, marginTop - lastMarginBottom);
  const maxContentHeight = remainingHeight - effectiveTop - marginBottom;
  if (maxContentHeight <= 0) {
    return {
      firstChunk: null,
      restPages: [],
      firstChunkHeight: 0,
      firstChunkMarginBottom: marginBottom,
    };
  }

  const thead = tableEl.querySelector("thead");
  let headerHeight = 0;
  if (thead) {
    const temp = createMeasureContainer(pageWidth, thead as HTMLElement);
    temp.appendChild(thead.cloneNode(true));
    headerHeight = temp.offsetHeight;
    document.body.removeChild(temp);
  }
  // 同样为内容部分预留 10% 的安全边距
  const availableForRows = (maxContentHeight - headerHeight) * 0.9;
  if (availableForRows <= 0) {
    return {
      firstChunk: null,
      restPages: [],
      firstChunkHeight: 0,
      firstChunkMarginBottom: marginBottom,
    };
  }

  const tbody = tableEl.querySelector("tbody") || tableEl;
  const rows = Array.from(tbody.querySelectorAll("tr"));
  let contentHeight = headerHeight;
  let takeCount = 0;
  for (const row of rows) {
    const rowHeight = measureTableRowHeight(row as HTMLElement, pageWidth);
    if (contentHeight + rowHeight > maxContentHeight) break;
    contentHeight += rowHeight;
    takeCount += 1;
  }

  if (takeCount === 0) {
    return {
      firstChunk: null,
      restPages: [],
      firstChunkHeight: 0,
      firstChunkMarginBottom: marginBottom,
    };
  }

  const wrapper = element.cloneNode(false) as HTMLElement;
  wrapper.innerHTML = "";
  const firstTable = tableEl.cloneNode(false) as HTMLTableElement;
  firstTable.style.width = pageWidth + "px";
  firstTable.style.tableLayout = "auto";
  if (thead) firstTable.appendChild(thead.cloneNode(true));
  const firstBody = document.createElement("tbody");
  rows.slice(0, takeCount).forEach((r) => firstBody.appendChild(r.cloneNode(true)));
  firstTable.appendChild(firstBody);
  wrapper.appendChild(firstTable);

  const restRows = rows.slice(takeCount);
  let restPages: HTMLElement[] = [];
  if (restRows.length > 0) {
    const restTable = tableEl.cloneNode(true) as HTMLTableElement;
    const restTbody = restTable.querySelector("tbody") || restTable;
    restTbody.innerHTML = "";
    restRows.forEach((r) => restTbody.appendChild(r.cloneNode(true)));
    restPages = await splitTable(restTable, pageWidth, pageHeight);
  }

  const firstChunkHeight = effectiveTop + contentHeight + marginBottom;
  return {
    firstChunk: wrapper,
    restPages,
    firstChunkHeight,
    firstChunkMarginBottom: marginBottom,
  };
}

/**
 * 通用容器按剩余高度拆分：
 * - 适用于 blockquote / custom-html / grid 等“内部包含多种子元素组合”的情况
 * - 不关心具体子元素类型，只按“能放下多少个子节点”来决定首块内容
 * - 保持容器本身的 className / 样式不变，前后两页的外观保持一致
 */
async function splitContainerToFillRemaining(
  element: HTMLElement,
  pageWidth: number,
  pageHeight: number,
  remainingHeight: number,
  lastMarginBottom: number
): Promise<SplitToFillResult> {
  const style = window.getComputedStyle(element);
  const marginTop = parseFloat(style.marginTop) || 0;
  const marginBottom = parseFloat(style.marginBottom) || 0;
  const effectiveTop = Math.max(0, marginTop - lastMarginBottom);
  const maxContentHeight = remainingHeight - effectiveTop - marginBottom;

  if (maxContentHeight <= 0) {
    return {
      firstChunk: null,
      restPages: [],
      firstChunkHeight: 0,
      firstChunkMarginBottom: marginBottom,
    };
  }

  const children = Array.from(element.children) as HTMLElement[];
  if (children.length === 0) {
    return {
      firstChunk: null,
      restPages: [],
      firstChunkHeight: 0,
      firstChunkMarginBottom: marginBottom,
    };
  }

  // 在独立测量容器中，按子元素逐个尝试加入，直到达到最大可用高度
  const { takeCount, contentHeight } = withMeasureContainer(
    element,
    pageWidth,
    (measureContainer) => {
      const wrapper = element.cloneNode(false) as HTMLElement;
      const computed = window.getComputedStyle(element);
      wrapper.style.cssText = computed.cssText;
      // 外边距在外层单独处理，这里去掉自身 margin 影响测量
      wrapper.style.marginTop = "0";
      wrapper.style.marginBottom = "0";
      measureContainer.appendChild(wrapper);

      let usedHeight = 0;
      let usedCount = 0;

      for (const child of children) {
        const clonedChild = child.cloneNode(true) as HTMLElement;
        wrapper.appendChild(clonedChild);

        // 使用 wrapper.offsetHeight 获取当前容器内部真实高度
        const h = wrapper.offsetHeight;
        if (h > maxContentHeight) {
          wrapper.removeChild(clonedChild);
          break;
        }

        usedHeight = h;
        usedCount += 1;
      }

      return { takeCount: usedCount, contentHeight: usedHeight };
    }
  );

  if (takeCount <= 0) {
    return {
      firstChunk: null,
      restPages: [],
      firstChunkHeight: 0,
      firstChunkMarginBottom: marginBottom,
    };
  }

  // 构造首块：同一个容器外壳 + 能放下的前若干个子元素
  const firstChunk = element.cloneNode(false) as HTMLElement;
  firstChunk.className = element.className;
  firstChunk.style.cssText = style.cssText;
  children
    .slice(0, takeCount)
    .forEach((child) => firstChunk.appendChild(child.cloneNode(true)));

  // 剩余子元素：重新组成一个同结构容器，然后走通用容器分页逻辑
  const restChildren = children.slice(takeCount);
  let restPages: HTMLElement[] = [];
  if (restChildren.length > 0) {
    const restContainer = element.cloneNode(false) as HTMLElement;
    restContainer.className = element.className;
    restContainer.style.cssText = style.cssText;
    restChildren.forEach((child) =>
      restContainer.appendChild(child.cloneNode(true))
    );
    restPages = await splitGenericContainer(restContainer, pageWidth, pageHeight);
  }

  const firstChunkHeight = effectiveTop + contentHeight + marginBottom;
  return {
    firstChunk,
    restPages,
    firstChunkHeight,
    firstChunkMarginBottom: marginBottom,
  };
}

/**
 * 拆分图片（整页移动 + 自适应缩放 + 标记）
 *
 * 支持以下两种结构：
 * - 直接的 <img>
 * - 外层为 .image-container，内部包含 <img> 与说明文字等
 */
function normalizeImageSizeForPage(
  wrapper: HTMLElement,
  pageWidth: number,
  maxHeight?: number
): void {


  // 若页宽无效（未正确计算或仍为 0），则不进行任何强制缩放，避免把图片压缩为 0 宽/高导致看不见
  if (!pageWidth || pageWidth <= 0 || Number.isNaN(pageWidth)) {
    return;
  }

  const isImgTag = wrapper.tagName === "IMG";
  const img = isImgTag
    ? (wrapper as HTMLImageElement)
    : (wrapper.querySelector("img") as HTMLImageElement | null);

  if (!img) return;

  const safeWidth = pageWidth * 0.90; // 预留 10% 作为左右安全边距

  // 限制图片本身的尺寸，避免横向溢出
  img.style.maxWidth = safeWidth + "px";
  img.style.width = "90%";
  img.style.height = "auto";
  img.style.objectFit = "contain";

  // 如果指定了最大高度（例如整页图片或“填满剩余高度”的场景），再额外限制高度
  if (maxHeight && maxHeight > 0) {
    img.style.maxHeight = maxHeight + "px";
  }

  // 对于带有外层容器（.image-container）包裹的图片，限制容器宽度并居中
  const container = isImgTag ? img : wrapper;
  container.style.maxWidth = safeWidth + "px";
  // 不强行覆盖用户自定义的 margin，只在未设置左右外边距时居中
  const cs = window.getComputedStyle(container);
  if ((cs.marginLeft === "0px" || cs.marginLeft === "") && (cs.marginRight === "0px" || cs.marginRight === "")) {
    container.style.marginLeft = "auto";
    container.style.marginRight = "auto";
  }
}

async function splitImage(
  element: HTMLElement,
  pageWidth: number,
  pageHeight: number,
  previousPage?: HTMLElement // 前一页，用于添加说明标记
): Promise<{ pages: HTMLElement[]; noteAdded: boolean }> {
  const pages: HTMLElement[] = [];

  const wrapper = element;
  const img =
    wrapper.tagName === "IMG"
      ? (wrapper as HTMLImageElement)
      : (wrapper.querySelector("img") as HTMLImageElement | null);

  // 如果没有找到图片节点，当作普通块元素处理（交给上层逻辑）
  if (!img) {
    const page = createPageDiv(pageWidth, pageHeight);
    page.appendChild(wrapper.cloneNode(true));
    pages.push(page);
    return { pages, noteAdded: false };
  }

  // 使用实际渲染后的高度判断是否需要“整页 + 缩放”
  const rawHeight = wrapper.offsetHeight || img.offsetHeight;

  // 图片整体高度 > 页高：必须独占一页，并按页高进行等比缩放，避免被 overflow 裁剪
  if (rawHeight > pageHeight) {
    // 若提供了前一页，在上一页末尾添加标记
    if (previousPage) {
      const note = document.createElement("span");
      note.style.fontStyle = "italic";
      note.style.color = "#666";
      note.innerText = "（图片转下页）";
      previousPage.appendChild(note);
    }

    const page = createPageDiv(pageWidth, pageHeight);
    page.style.display = "flex";
    page.style.alignItems = "center";
    page.style.justifyContent = "center";
    page.style.overflow = "hidden";

    const wrapperClone = wrapper.cloneNode(true) as HTMLElement;
    // 整页图片：在高度上限制为 pageHeight，同时在宽度上也按页宽做自适应缩放，避免横向溢出
    normalizeImageSizeForPage(wrapperClone, pageWidth, pageHeight);

    // 避免重复的外边距把整体又撑出一页，这里压缩 wrapper 的上下 margin
    const wStyle = window.getComputedStyle(wrapperClone);
    const mt = parseFloat(wStyle.marginTop) || 0;
    const mb = parseFloat(wStyle.marginBottom) || 0;
    if (mt > 0) wrapperClone.style.marginTop = Math.min(mt, pageHeight * 0.05) + "px";
    if (mb > 0) wrapperClone.style.marginBottom = Math.min(mb, pageHeight * 0.05) + "px";

    page.appendChild(wrapperClone);
    pages.push(page);

    return { pages, noteAdded: true };
  }

  // 图片高度 ≤ 页高，直接完整移动到新页中，但仍需限制宽度以避免横向溢出
  const page = createPageDiv(pageWidth, pageHeight);
  const normalImageWrapper = wrapper.cloneNode(true) as HTMLElement;
  normalizeImageSizeForPage(normalImageWrapper, pageWidth);
  page.appendChild(normalImageWrapper);
  pages.push(page);
  return { pages, noteAdded: false };
}

/**
 * 图片按“当前页剩余高度”填充策略：
 * - 不对图片做“截断拆分”，只考虑“是否可以在当前页剩余空间内整体缩放后放下”；
 * - 如果原始高度 <= 剩余可用高度：直接完整放入当前页；
 * - 如果需要缩放，且缩放比例 >= 50%（available / rawHeight >= 0.5）：按比例缩放后放入当前页，图片在块内居中；
 * - 如果缩放到 50% 仍然放不下：返回 firstChunk = null，让主流程将整张图片移到下一页，并走标准图片分页策略。
 */
async function splitImageToFillRemaining(
  element: HTMLElement,
  pageWidth: number,
  pageHeight: number,
  remainingHeight: number,
  lastMarginBottom: number
): Promise<SplitToFillResult> {

  const style = window.getComputedStyle(element);
  const marginTop = parseFloat(style.marginTop) || 0;
  const marginBottom = parseFloat(style.marginBottom) || 0;
  const effectiveTop = Math.max(0, marginTop - lastMarginBottom);
  const maxContentHeight = remainingHeight - effectiveTop - marginBottom;

  if (maxContentHeight <= 0) {
    return {
      firstChunk: null,
      restPages: [],
      firstChunkHeight: 0,
      firstChunkMarginBottom: marginBottom,
    };
  }

  const wrapper = element;
  const img =
    wrapper.tagName === "IMG"
      ? (wrapper as HTMLImageElement)
      : (wrapper.querySelector("img") as HTMLImageElement | null);

  if (!img) {
    // 没有图片节点，当作不可拆分块处理
    return {
      firstChunk: null,
      restPages: [],
      firstChunkHeight: 0,
      firstChunkMarginBottom: marginBottom,
    };
  }

  // 使用当前 DOM 中的高度作为原始高度基准（包含说明文字等整体包装）
  const rawHeight = wrapper.offsetHeight || img.offsetHeight;

  if (rawHeight <= maxContentHeight) {
    // 原尺寸即可完整放入当前页，无需特殊处理
    const firstChunk = wrapper.cloneNode(true) as HTMLElement;
    // 即使不需要按高度缩放，也要限制宽度以避免在当前页内发生横向溢出
    normalizeImageSizeForPage(firstChunk, pageWidth);
    const firstChunkHeight = effectiveTop + rawHeight + marginBottom;
    return {
      firstChunk,
      restPages: [],
      firstChunkHeight,
      firstChunkMarginBottom: marginBottom,
    };
  }

  // 需要缩放：计算在当前剩余高度内允许的最大缩放比例，并限制最小为 50%
  const available = maxContentHeight;
  const scale = available / rawHeight;

  if (scale < 0.5) {
    // 即便缩放到 50% 也放不下：交回主流程整块移至下一页，保持旧有、稳定的行为
    return {
      firstChunk: null,
      restPages: [],
      firstChunkHeight: 0,
      firstChunkMarginBottom: marginBottom,
    };
  }

  const firstChunk = wrapper.cloneNode(true) as HTMLElement;
  // 需要缩放的场景：在高度上限制为 available，同时在宽度上也按页宽自适应，保证整张图缩小到当前页剩余空间内且不横向溢出
  normalizeImageSizeForPage(firstChunk, pageWidth, available);

  // 检查是否存在图片说明（figcaption.image-caption）
  const hasCaption = !!firstChunk.querySelector("figcaption.image-caption");

  if (hasCaption) {
    // 带说明文字的图片：
    // - 不再整体使用 flex 居中，避免 figcaption 被挤到一侧或溢出
    // - 压缩上下外边距，尽量为 caption 腾出空间
    firstChunk.style.display = "";
    firstChunk.style.justifyContent = "";
    firstChunk.style.alignItems = "";

    firstChunk.style.marginTop = "0";
    firstChunk.style.marginBottom = "0";
  } else {
    // 纯图片（无说明文字），依旧在当前页剩余空间内居中显示
    firstChunk.style.display = "flex";
    firstChunk.style.justifyContent = "center";
    firstChunk.style.alignItems = "center";
  }

  const firstChunkHeight = effectiveTop + available + (hasCaption ? 0 : marginBottom);
  return {
    firstChunk,
    restPages: [],
    firstChunkHeight,
    firstChunkMarginBottom: hasCaption ? 0 : marginBottom,
  };
}

// ========== 类型分发器 ==========

/**
 * 根据元素类型调用对应的拆分函数
 */
export async function splitElementByType(
  element: HTMLElement,
  pageWidth: number,
  pageHeight: number,
  previousPage?: HTMLElement
): Promise<HTMLElement[]> {
  const elementType = getElementType(element);
  // const tag = element.tagName.toLowerCase();

  // 优先根据类名判断元素类型
  switch (elementType) {
    case "paragraph":
      // MDX段落使用div.mdx-paragraph包装
      return splitParagraph(element, pageWidth, pageHeight);

    case "code":
      // 代码块（pre元素或带代码类名的元素）
      return splitCodeBlock(element, pageWidth, pageHeight);

    case "table":
      // 表格（table-container包装的表格）
      return splitTable(element as HTMLTableElement, pageWidth, pageHeight);

    case "image": {
      // 图片（img元素或image-container包装的图片）
      const result = await splitImage(element, pageWidth, pageHeight, previousPage);
      return result.pages;
    }

    case "list":
      // 列表（ul/ol带mdx-list类名）
      return splitList(element, pageWidth, pageHeight);

    case "heading":
      // 标题（h1-h6带mdx-heading类名）
      return splitHeading(element, pageWidth, pageHeight);

    case "blockquote":
      // 引用块：内部可能包含多个段落/列表，使用通用容器拆分，避免整块溢出
      return splitGenericContainer(element, pageWidth, pageHeight);

    case "custom-html":
    case "grid":
      // 自定义HTML和网格布局：使用通用容器拆分，并处理横向溢出
      return splitGenericContainer(element, pageWidth, pageHeight);

    default:
      // 其他未知/容器元素：优先做通用容器拆分，尽量按子项分页，避免整块内容溢出
      if (element.offsetHeight > pageHeight || element.children.length > 0) {
        return splitGenericContainer(element, pageWidth, pageHeight);
      }

      const page = createPageDiv(pageWidth, pageHeight);
      const cloned = element.cloneNode(true) as HTMLElement;
      // 检查并修复横向溢出
      fixHorizontalOverflow(cloned, pageWidth);
      page.appendChild(cloned);
      return [page];
  }
}

/**
 * 按类型将元素拆成“填满当前页剩余”的首块 + 剩余页；不可拆分或剩余空间不足时返回 firstChunk=null、restPages 为整元素一页
 */
async function splitElementToFillRemaining(
  element: HTMLElement,
  pageWidth: number,
  pageHeight: number,
  remainingHeight: number,
  lastMarginBottom: number
): Promise<SplitToFillResult> {
  const type = getElementType(element);
  
  switch (type) {
    case "paragraph":
      return splitParagraphToFillRemaining(
        element,
        pageWidth,
        pageHeight,
        remainingHeight,
        lastMarginBottom
      );
    case "code":
      // 代码块在“页尾剩余空间填充”场景下允许拆分，首块填充当前页，其余走标准代码块分页策略
      return splitCodeBlockToFillRemaining(
        element,
        pageWidth,
        pageHeight,
        remainingHeight,
        lastMarginBottom
      );
    case "list":
      return splitListToFillRemaining(
        element,
        pageWidth,
        pageHeight,
        remainingHeight,
        lastMarginBottom
      );
    case "table":
      return splitTableToFillRemaining(
        element,
        pageWidth,
        pageHeight,
        remainingHeight,
        lastMarginBottom
      );
    case "image":
      // 图片不做“截断拆分”，但会尝试在当前页剩余空间内整体缩放后放下；
      // 若缩放比例低于 50% 仍放不下，则交回主流程整块移至下一页。
      return splitImageToFillRemaining(
        element,
        pageWidth,
        pageHeight,
        remainingHeight,
        lastMarginBottom
      );
    case "blockquote":
    case "custom-html":
    case "grid":
      // 对包含多种子元素组合的容器，按子节点拆分首块，剩余部分继续走通用分页
      return splitContainerToFillRemaining(
        element,
        pageWidth,
        pageHeight,
        remainingHeight,
        lastMarginBottom
      );
    default: {
      const marginBottom = parseFloat(window.getComputedStyle(element).marginBottom) || 0;
      return {
        firstChunk: null,
        restPages: [],
        firstChunkHeight: 0,
        firstChunkMarginBottom: marginBottom,
      };
    }
  }
}

// ========== 列表拆分函数 ==========

/**
 * 拆分列表
 */
async function splitList(
  element: HTMLElement,
  pageWidth: number,
  pageHeight: number
): Promise<HTMLElement[]> {
  return withMeasureContainer(element, pageWidth, (measureContainer) => {
    const pages: HTMLElement[] = [];

    // 克隆列表保持原始样式
    const clonedElement = element.cloneNode(true) as HTMLElement;
    measureContainer.style.padding = "0";
    measureContainer.style.margin = "0";

    const listItems = Array.from(
      clonedElement.querySelectorAll("li.mdx-list-item")
    ).map((item) => item as HTMLElement);

    let currentPageDiv = createPageDiv(pageWidth, pageHeight);
    let currentHeight = 0;
    let bufferItems: HTMLElement[] = [];

    const measureItem = (item: HTMLElement) => {
      measureContainer.innerHTML = "";
      measureContainer.appendChild(item.cloneNode(true));
      return measureContainer.offsetHeight;
    };

    for (const item of listItems) {
      const itemHeight = measureItem(item);

      if (currentHeight + itemHeight > pageHeight) {
        // 保存当前页
        if (bufferItems.length > 0) {
          const listClone = clonedElement.cloneNode(false) as HTMLElement;
          bufferItems.forEach((it) =>
            listClone.appendChild(it.cloneNode(true))
          );
          currentPageDiv.appendChild(listClone);
          pages.push(currentPageDiv);
        }

        // 创建新页
        currentPageDiv = createPageDiv(pageWidth, pageHeight);
        bufferItems = [item as HTMLElement];
        currentHeight = itemHeight;
      } else {
        bufferItems.push(item as HTMLElement);
        currentHeight += itemHeight;
      }
    }

    // 添加最后一页
    if (bufferItems.length > 0) {
      const listClone = clonedElement.cloneNode(false) as HTMLElement;
      bufferItems.forEach((it) => listClone.appendChild(it.cloneNode(true)));
      currentPageDiv.appendChild(listClone);
      pages.push(currentPageDiv);
    }

    return pages;
  });
}

/**
 * 列表按剩余高度拆分：首块为能放进当前页的列表项，其余为新页
 */
async function splitListToFillRemaining(
  element: HTMLElement,
  pageWidth: number,
  pageHeight: number,
  remainingHeight: number,
  lastMarginBottom: number
): Promise<SplitToFillResult> {
  const style = window.getComputedStyle(element);
  const marginTop = parseFloat(style.marginTop) || 0;
  const marginBottom = parseFloat(style.marginBottom) || 0;
  const effectiveTop = Math.max(0, marginTop - lastMarginBottom);
  /**
   * 这里特意 **不再减去 marginBottom**，只用剩余高度减去“真实顶部占用”（effectiveTop）
   * 来计算可用内容高度。
   *
   * 原逻辑：remainingHeight - effectiveTop - marginBottom
   * 会在列表处于页尾、但页面底部还有可见空间时，过于保守地认为“放不下任何内容”，
   * 直接返回 firstChunk = null，导致整个列表被移到下一页，留下大块空白。
   *
   * 新逻辑：允许“内容本身”尽量占满当前页，将 marginBottom 作为首块的尾部外边距，
   * 交给下一轮 remainingHeight 计算去处理，从而把能塞进当前页的若干个 li 先放进来。
   */
  const maxContentHeight = remainingHeight - effectiveTop;
  if (maxContentHeight <= 0) {
    return {
      firstChunk: null,
      restPages: [],
      firstChunkHeight: 0,
      firstChunkMarginBottom: marginBottom,
    };
  }

  const clonedElement = element.cloneNode(true) as HTMLElement;
  const listItems = Array.from(
    clonedElement.querySelectorAll("li.mdx-list-item")
  ).map((item) => item as HTMLElement);

  const { takeCount, contentHeight } = withMeasureContainer(
    element,
    pageWidth,
    (measureContainer) => {
      measureContainer.style.padding = "0";
      measureContainer.style.margin = "0";

      let usedHeight = 0;
      let usedCount = 0;

      const measureItem = (item: HTMLElement) => {
        measureContainer.innerHTML = "";
        measureContainer.appendChild(item.cloneNode(true));
        return measureContainer.offsetHeight;
      };

      for (const item of listItems) {
        const itemHeight = measureItem(item);
        if (usedHeight + itemHeight > maxContentHeight) break;
        usedHeight += itemHeight;
        usedCount += 1;
      }

      return { takeCount: usedCount, contentHeight: usedHeight };
    }
  );

  if (takeCount <= 0) {
    return {
      firstChunk: null,
      restPages: [],
      firstChunkHeight: 0,
      firstChunkMarginBottom: marginBottom,
    };
  }

  const firstChunk = clonedElement.cloneNode(false) as HTMLElement;
  listItems.slice(0, takeCount).forEach((item) =>
    firstChunk.appendChild(item.cloneNode(true))
  );
  firstChunk.className = element.className;

  const restItems = listItems.slice(takeCount);
  let restPages: HTMLElement[] = [];
  if (restItems.length > 0) {
    const restList = clonedElement.cloneNode(false) as HTMLElement;
    restItems.forEach((item) => restList.appendChild(item.cloneNode(true)));
    restList.className = element.className;
    restPages = await splitList(restList, pageWidth, pageHeight);
  }

  const firstChunkHeight = effectiveTop + contentHeight + marginBottom;
  return {
    firstChunk,
    restPages,
    firstChunkHeight,
    firstChunkMarginBottom: marginBottom,
  };
}

// ========== 标题拆分函数 ==========

/**
 * 拆分标题
 */
async function splitHeading(
  element: HTMLElement,
  pageWidth: number,
  pageHeight: number
): Promise<HTMLElement[]> {
  // 标题通常不会跨页，直接放入一页
  const page = createPageDiv(pageWidth, pageHeight);
  page.appendChild(element.cloneNode(true));
  return [page];
}

// ========== 引用块拆分函数 ==========

/**
 * 拆分引用块
 */
async function splitBlockquote(
  element: HTMLElement,
  pageWidth: number,
  pageHeight: number
): Promise<HTMLElement[]> {
  // 引用块通常不会跨页，直接放入一页
  const page = createPageDiv(pageWidth, pageHeight);
  page.appendChild(element.cloneNode(true));
  return [page];
}

// ========== 主分页函数 ==========

export async function paginateDOM(
  container: HTMLElement,
  pageWidth: number,
  pageHeight: number
): Promise<HTMLElement[]> {
  // 为分页测量尽量确保图片资源已就绪；加超时兜底，避免懒加载图片导致卡死
  await waitForImages(container, { timeoutMs: 15000, forceEager: true });

  const pages: HTMLElement[] = []; // 存储所有分页结果的数组

  // 创建一个隐藏的测量根节点，将分页页容器挂载到真实 DOM 中，以便正确计算 offsetHeight
  const measureRoot = document.createElement("div");
  measureRoot.style.position = "absolute";
  measureRoot.style.visibility = "hidden";
  measureRoot.style.top = "-9999px";
  measureRoot.style.left = "-9999px";
  measureRoot.style.width = pageWidth + "px";
  measureRoot.style.boxSizing = "border-box";
  document.body.appendChild(measureRoot);

  const attachPageForMeasure = (page: HTMLElement) => {
    if (!page.parentElement) {
      measureRoot.appendChild(page);
    }
  };

  let currentPage = createPageDiv(pageWidth, pageHeight); // 当前正在构建的页面
  attachPageForMeasure(currentPage);
  let currentHeight = 0; // 当前页面累计高度
  let previousPage: HTMLElement | undefined = undefined; // 前一页引用，用于跨页元素标记
  let lastMarginBottom = 0; // 当前页最后一个元素的下外边距，用于外边距折叠 

  // 确保DOM有内容
  if (container.children.length === 0) {
    await new Promise<void>((resolve) => {
      const observer = new MutationObserver(() => {
        if (container.children.length > 0) {
          observer.disconnect();
          resolve();
        }
      });
      observer.observe(container, { childList: true });
    });
  }

  let children: HTMLElement[] = [];

  /**
   * 获取需要参与分页的“内容根节点”的直接子元素。
   *
   * 兼容多种 DOM 结构：
   * - 标准 MDX 文章：隐藏容器下的第一个子节点是 <article class="mdx-content">；
   * - 其他自定义页面（如前言页、目录页、自定义组件）：可能直接把内容渲染到容器内部，
   *   或通过其他包裹元素承载实际内容。
   */
  const mdxRoot = container.querySelector<HTMLElement>(".mdx-content");

  // 优先使用 .mdx-content 作为内容根；否则回退到容器本身
  const contentRoot: HTMLElement = mdxRoot ?? (container as HTMLElement);

  // 获取内容根下的直接子元素，过滤掉纯空白文本节点
  children = Array.from(contentRoot.childNodes)
    .filter((child) => {
      if (child.nodeType === Node.ELEMENT_NODE) return true;
      if (child.nodeType === Node.TEXT_NODE) {
        return !!child.textContent?.trim();
      }
      return false;
    })
    .map((child) => child as HTMLElement);

  for (const child of children) {
    const el = child as HTMLElement;

    // const style = window.getComputedStyle(el);
    // const marginTop = parseFloat(style.marginTop) || 0;
    // const marginBottom = parseFloat(style.marginBottom) || 0;
    // const baseHeight = el.offsetHeight; // 不包含外边距（在原容器中测量，用于是否“整块超过一页”的粗略判断）

    // 单独一个元素高度估算（不考虑与前后元素外边距折叠）
    // const singleElementHeight = baseHeight + marginTop + marginBottom;

    // // 情况1：单个元素高度 > 页高，必须拆分
    // if (singleElementHeight > pageHeight) {
      
    //   // 先保存当前页（若有内容）
    //   if (currentPage.children.length > 0) {
    //     pages.push(currentPage);
    //     previousPage = currentPage; // 记录前一页，供图片标记使用
    //     currentPage = createPageDiv(pageWidth, pageHeight);
    //     attachPageForMeasure(currentPage);
    //     currentHeight = 0;
    //   }

    //   // 拆分该元素
    //   const splitPages = await splitElementByType(
    //     el,
    //     pageWidth,
    //     pageHeight,
    //     previousPage
    //   );
    //   for (const page of splitPages) {
    //     // 保险：拆分页本身也要控制不超过 pageHeight
    //     attachPageForMeasure(page);
    //     const { height } = getPageContentHeightAndMargin(page);
    //     if (height > pageHeight) {
    //       console.warn("分页后页面仍然超高，可能需要更细粒度拆分检查", {
    //         pageHeight,
    //         actualHeight: height,
    //         page,
    //       });
    //     }
    //     pages.push(page);
    //     previousPage = page; // 更新前一页
    //   }
    //   continue; // 跳出循环，继续下一个元素
    // }

    // === 新策略：先"尝试放入再测量"，用真实 DOM 高度避免溢出 ===
    const cloned = el.cloneNode(true) as HTMLElement;
    // 先处理横向溢出，避免影响高度测量
    fixHorizontalOverflow(cloned, pageWidth);
    currentPage.appendChild(cloned);

    // 注意：不要在 append 之前等待（未挂到 DOM 的 img 往往不会触发加载事件，会导致卡死）
    // 这里用短超时 + 强制 eager，尽量让测量把图片高度算进去，但绝不阻塞分页流程
    await waitForImages(cloned, { timeoutMs: 1200, forceEager: true });
    
    let measure = getPageContentHeightAndMargin(currentPage);

    if (measure.height <= pageHeight) {
      // 情况2：真实高度在允许范围内，直接使用
      currentHeight = measure.height;
      lastMarginBottom = measure.lastMarginBottom;
    } else {

      // 已经溢出，先尝试通过轻微压缩该元素的上下外边距来“挤”进当前页
      const overflow = measure.height - pageHeight;

      let adjusted = false;

      if (overflow > 0) {
        const clonedStyle = window.getComputedStyle(cloned);
        const clonedMarginTop = parseFloat(clonedStyle.marginTop) || 0;
        const clonedMarginBottom = parseFloat(clonedStyle.marginBottom) || 0;
        const totalMargin = clonedMarginTop + clonedMarginBottom;
        // 仅当溢出不大，且足够多的 margin 可以被压缩时才尝试

        const MAX_MARGIN_ADJUST_RATIO = 0.5; // 最多使用 50% 的上下 margin 来消化溢出

        if (totalMargin > 0 && overflow <= totalMargin * MAX_MARGIN_ADJUST_RATIO) {
          const shrinkRatio = overflow / totalMargin;
          const newTop =
            clonedMarginTop > 0
              ? Math.max(0, clonedMarginTop - clonedMarginTop * shrinkRatio)
              : clonedMarginTop;
          const newBottom =
            clonedMarginBottom > 0
              ? Math.max(0, clonedMarginBottom - clonedMarginBottom * shrinkRatio)
              : clonedMarginBottom;

          cloned.style.marginTop = newTop + "px";
          cloned.style.marginBottom = newBottom + "px";

          const afterAdjust = getPageContentHeightAndMargin(currentPage);

          if (afterAdjust.height <= pageHeight) {
            currentHeight = afterAdjust.height;
            lastMarginBottom = afterAdjust.lastMarginBottom;
            adjusted = true;
          } else {
            // 回退 margin 调整
            cloned.style.marginTop = clonedMarginTop + "px";
            cloned.style.marginBottom = clonedMarginBottom + "px";
          }
        }
      }

      if (adjusted) {
        // 通过微调外边距已经把元素塞进当前页，无需拆分
        continue;
      }



      // 无法通过 margin 调整解决溢出：回退这次 append，再按“精细拆分或整块换页”逻辑处理
      currentPage.removeChild(cloned);

      const remainingHeight = pageHeight - currentHeight;

      // 之前这里要求 remainingHeight >= MIN_REMAINING_TO_SPLIT 才会尝试拆分，
      // 导致很多“还能放下一部分”的场景被直接整块换页，从而出现大面积空白。
      // 现在只要元素是可拆分的且仍有剩余高度，就交给各自的 splitXXXToFillRemaining
      // 去做更细颗粒度的判断（例如：段落最小占比、图片最小缩放比等）。
      const tryFill = isElementSplittable(el) && remainingHeight > 0;

      if (tryFill) {

        const filled = await splitElementToFillRemaining(
          el,
          pageWidth,
          pageHeight,
          remainingHeight,
          lastMarginBottom
        );

        if (filled.firstChunk != null) {

          currentPage.appendChild(filled.firstChunk);
          currentHeight += filled.firstChunkHeight;
          lastMarginBottom = filled.firstChunkMarginBottom;
          pages.push(currentPage);
          previousPage = currentPage;

          if (filled.restPages.length > 0) {

            for (let i = 0; i < filled.restPages.length - 1; i++) {
              const restPage = filled.restPages[i];
              // 这些页后续不会再追加内容，但为了保证样式计算统一，仍然挂到测量根节点
              attachPageForMeasure(restPage);
              pages.push(restPage);
            }

            currentPage = filled.restPages[
              filled.restPages.length - 1
            ] as HTMLDivElement;

            // currentPage 后续还会继续参与分页和高度测量，必须先挂到测量根节点中
            attachPageForMeasure(currentPage);

            const {
              height,
              lastMarginBottom: lm,
            } = getPageContentHeightAndMargin(currentPage);
            currentHeight = height;
            lastMarginBottom = lm;

          } else {
            currentPage = createPageDiv(pageWidth, pageHeight);
            attachPageForMeasure(currentPage);
            currentHeight = 0;
            lastMarginBottom = 0;
          }

          continue;

        }

      }

      // 不可拆分或未产出首块：整块移到下一页（我们已确认 singleElementHeight <= pageHeight，不会再溢出）
      pages.push(currentPage);
      previousPage = currentPage;
      currentPage = createPageDiv(pageWidth, pageHeight);
      attachPageForMeasure(currentPage);
      const clonedForNext = el.cloneNode(true) as HTMLElement;
      fixHorizontalOverflow(clonedForNext, pageWidth);
      currentPage.appendChild(clonedForNext);
      const {
        height: newHeight,
        lastMarginBottom: newLastMarginBottom,
      } = getPageContentHeightAndMargin(currentPage);
      currentHeight = newHeight;
      lastMarginBottom = newLastMarginBottom;
    }

  }

  if (currentPage.children.length > 0) {
    pages.push(currentPage);
  }

  // 移除测量根节点，返回已构建好的分页结果
  document.body.removeChild(measureRoot);
  return pages;
}

// ========== 空白页填充 ==========
export function createBlankPage(
  width: number,
  height: number,
  message?: string
): HTMLDivElement {
  const div = createPageDiv(width, height);
  div.style.display = "flex";
  div.style.alignItems = "center";
  div.style.justifyContent = "center";
  div.style.flexDirection = "column";
  div.style.backgroundColor = "#f5f5f5"; // 浅灰色背景，与内容页区分
  div.style.color = "#999";
  div.style.fontSize = "16px";
  div.style.fontFamily = "sans-serif";
  div.style.textAlign = "center";
  div.style.boxSizing = "border-box";

  // 主要提示文字
  const mainMsg = document.createElement("div");
  mainMsg.innerText = message || "—— 正文结束 ——";
  div.appendChild(mainMsg);
  return div;
}

// ========== 页脚与内层容器工具 ==========

/**
 * 创建统一风格的页脚 DOM
 * @param pageNumber 书本中的实际页码（包含封面）
 * @param title 当前页所属文章或内容标题
 */
export function createPageFooter(
  pageNumber: number,
  title: string
): HTMLDivElement {
  const footer = document.createElement("div");
  footer.className = "book-page-footer";

  const titleSpan = document.createElement("span");
  titleSpan.className = "book-page-footer__title";
  titleSpan.textContent = title;

  const pageSpan = document.createElement("span");
  pageSpan.className = "book-page-footer__page-number";
  pageSpan.textContent = String(pageNumber);

  footer.appendChild(titleSpan);
  footer.appendChild(pageSpan);
  return footer;
}

/**
 * 将原有页内容用“内层容器 + 页脚”重新包装：
 * 外层容器仍然交给 turn.js 管理，内层容器承载实际内容与页脚，避免样式/事件冲突
 */
export function wrapPageWithFooter(
  pageElement: HTMLElement,
  pageNumber: number,
  title: string
): HTMLElement {
  // 避免重复包装
  if (pageElement.querySelector(".book-page-inner")) {
    return pageElement;
  }

  const inner = document.createElement("div");
  inner.className = "book-page-inner";

  const contentWrapper = document.createElement("div");
  contentWrapper.className = "book-page-inner__content";

  // 将原有子节点移动到内容容器中
  // 注意：React 18 的 createRoot 会直接渲染内容到容器中，所以 firstChild 应该是 React 渲染的内容
  let movedCount = 0;
  while (pageElement.firstChild) {
    contentWrapper.appendChild(pageElement.firstChild);
    movedCount++;
  }


  // 检测是否为目录页或前言页，如果是则移除内容容器的 padding
  if (
    contentWrapper.querySelector(".book-toc-page__inner") ||
    contentWrapper.querySelector(".preface-page__inner")
  ) {
    contentWrapper.classList.add("book-page-inner__content--no-padding");
  }

  const footer = createPageFooter(pageNumber, title);

  inner.appendChild(contentWrapper);
  inner.appendChild(footer);
  pageElement.appendChild(inner);

  // 调试：验证页脚是否被正确添加
  const footerInDom = pageElement.querySelector(".book-page-footer");
  if (!footerInDom) {
    console.error(`页脚未找到: pageNumber=${pageNumber}, title=${title}`, {
      pageElement,
      innerHTML: pageElement.innerHTML.substring(0, 500),
    });
  }

  return pageElement;
}
