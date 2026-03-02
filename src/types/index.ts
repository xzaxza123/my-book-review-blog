// src/types/index.ts
// 页面元数据接口 - 描述每个文档页面的基本信息
export interface PageMeta {
  id: string; // 页面唯一标识符，通常是文件路径的哈希值或其他唯一标识符
  title: string; // 页面标题
  path: string; // 路由路径
  filePath: string; // 文件系统路径
  frontmatter: Record<string, any>; // Frontmatter 元数据
  content: string; // 页面内容（Markdown）
  lastUpdated?: number; // 最后更新时间戳
}

