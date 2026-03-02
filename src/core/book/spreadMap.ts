export type PageKind = 'cover-front' | 'cover-back' | 'content';

export interface ContentPageRef {
  kind: 'content';
  /**
   * 全书级「内容页」页码，从 1 开始，不含封面/封底等物理页
   */
  contentPageNumber: number;
  /**
   * 对应的文章 ID（来自 page-map.json 里的 id）
   */
  articleId: string;
  /**
   * 文章内的内容级页号（从 1 开始）
   */
  articlePageNumber: number;
}

export interface CoverPageRef {
  kind: 'cover-front' | 'cover-back';
}

export type BookPageRef = ContentPageRef | CoverPageRef;

/**
 * 一摊（spread）对应 turn.js 里的一个展示面（可能包含左/右两页）
 */
export interface BookSpread {
  /** 展开序号，从 1 开始 */
  spreadIndex: number;
  /**
   * turn.js 的物理页码（page index），注意：与内容级页号并不相同
   * left / right 分别为这一摊的左右两页
   */
  left?: {
    turnPage: number;
    ref: BookPageRef;
  };
  right?: {
    turnPage: number;
    ref: BookPageRef;
  };
}

/**
 * 用于运行时查询的整本书分页/展开映射
 */
export interface BookSpreadMap {
  /** 所有展开列表（含封面/封底） */
  spreads: BookSpread[];
  /** 总内容级页数（不含封面等物理页） */
  totalContentPages: number;
  /**
   * 全局内容级页号 → 文章 + 文章内页号
   */
  byContentPage: Map<number, ContentPageRef>;
}

export interface ArticlePageSummary {
  id: string;
  startPage: number;
  estimatedPages: number;
}

/**
 * 简单规则：1 摊封面（右页）、若干内容摊、1 摊封底（左页）。
 * 内容摊按「每摊最多两页内容」排布。
 *
 * - cover-front: spread 1 / right
 * - 第 1 个内容页: spread 2 / left（与封底对齐时更自然）
 * - 最后一个内容页后，再补一个 spread，用于封底（left）
 */
export function buildBookSpreadMap(
  articles: ArticlePageSummary[]
): BookSpreadMap {
  // 1. 先根据 articles 计算全书级「内容页」范围
  const byContentPage = new Map<number, ContentPageRef>();

  let maxContentPage = 0;
  for (const article of articles) {
    const { id, startPage, estimatedPages } = article;
    const end = startPage + estimatedPages - 1;
    for (let p = startPage; p <= end; p++) {
      const articlePageNumber = p - startPage + 1;
      byContentPage.set(p, {
        kind: 'content',
        contentPageNumber: p,
        articleId: id,
        articlePageNumber,
      });
      if (p > maxContentPage) {
        maxContentPage = p;
      }
    }
  }

  const spreads: BookSpread[] = [];
  let turnPageCounter = 1;
  let spreadIndex = 1;

  // 2. 封面摊：只有右页
  spreads.push({
    spreadIndex,
    right: {
      turnPage: turnPageCounter,
      ref: { kind: 'cover-front' },
    },
  });
  spreadIndex += 1;
  turnPageCounter += 1;

  // 3. 内容摊：每摊最多两页内容
  let currentContentPage = 1;
  while (currentContentPage <= maxContentPage) {
    const leftRef = byContentPage.get(currentContentPage);
    const left =
      leftRef && {
        turnPage: turnPageCounter,
        ref: leftRef,
      };
    turnPageCounter += 1;

    const nextContentPage = currentContentPage + 1;
    const rightRef = byContentPage.get(nextContentPage);
    const right =
      rightRef && {
        turnPage: turnPageCounter,
        ref: rightRef,
      };
    if (right) {
      turnPageCounter += 1;
    }

    spreads.push({
      spreadIndex,
      left: left as any,
      right: right as any,
    });

    spreadIndex += 1;
    currentContentPage += 2;
  }

  // 4. 封底摊：只有左页
  spreads.push({
    spreadIndex,
    left: {
      turnPage: turnPageCounter,
      ref: { kind: 'cover-back' },
    },
  });

  return {
    spreads,
    totalContentPages: maxContentPage,
    byContentPage,
  };
}


