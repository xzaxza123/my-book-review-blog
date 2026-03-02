import matter from 'gray-matter'

/**
 * Frontmatter 解析结果接口
 * @property frontmatter - 解析出的 Frontmatter 数据对象
 * @property content - 去除 Frontmatter 后的内容主体
 * @property excerpt - 文章摘要（可选）
 */
export interface ParseResult {
  frontmatter: Record<string, any>
  content: string
  excerpt?: string
}

/**
 * 解析字符串中的 Frontmatter
 * @param content - 包含 Frontmatter 的字符串内容（通常是 Markdown 文件内容）
 * @returns 包含 Frontmatter 数据和内容主体的解析结果对象
 * @example
 * const result = parseFrontMatter(`---
 * title: Hello World
 * date: 2023-01-01
 * ---
 * 
 * This is the content.`)
 * // result.frontmatter: { title: 'Hello World', date: '2023-01-01' }
 * // result.content: 'This is the content.'
 */
export function parseFrontMatter(content: string): ParseResult {
  try {
    const result = matter(content)
    return {
      frontmatter: result.data,
      content: result.content,
      excerpt: result.excerpt
    }
  } catch (error) {
    console.error('Failed to parse frontmatter:', error)
    return {
      frontmatter: {},
      content
    }
  }
}