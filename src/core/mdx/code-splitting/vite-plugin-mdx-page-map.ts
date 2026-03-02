import { type Plugin } from 'vite'
import fs from 'fs-extra'
import path from 'path'
import matter from 'gray-matter'
import glob from 'fast-glob'

/**
 * 插件选项
 *
 * 已经简化为只负责扫描文章并输出元数据，不再计算或输出页数相关信息。
 */
export interface MdxPageMapOptions {
  /**
   * MDX/MD 文件的 glob 表达式，默认 'docs/**\/*.{md,mdx}'
   */
  articlesGlob?: string
  /**
   * 基础目录（用于生成相对路径），默认 'docs'
   */
  baseDir?: string
  /**
   * 输出文件路径（相对于项目根），默认 'public/page-map.json'
   */
  outputFile?: string
}

/**
 * 单篇文章在 page-map 中的基础信息
 * 只保留路由、标题和 frontmatter 元数据，不包含任何页数或分页信息。
 */
interface ArticleInfo {
  id: string                // 相对于 docs 的路径（不含扩展名），如 "guide/getting-started"
  path: string              // 路由路径，如 "/guide/getting-started"
  title: string
  meta: Record<string, any>
}

export function mdxPageMap(options: MdxPageMapOptions = {}): Plugin {
  const {
    articlesGlob = 'docs/**/*.{md,mdx}',
    baseDir = 'docs',
    outputFile = 'public/page-map.json',
  } = options

  return {
    name: 'vite-plugin-mdx-page-map',
    enforce: 'pre', // 尽早执行，确保在打包前生成映射文件

    async buildStart() {
      // 1. 扫描所有 MDX/MD 文件
      const files = await glob(articlesGlob, { cwd: process.cwd() })
      if (files.length === 0) {
        console.warn(`[mdx-page-map] 未找到任何匹配 ${articlesGlob} 的文件`)
        return
      }

      const articles: ArticleInfo[] = []

      for (const file of files) {
        const fullPath = path.resolve(process.cwd(), file)
        const content = await fs.readFile(fullPath, 'utf-8')
        const { data, content: mdxContent } = matter(content)

        // ----- 生成相对于 baseDir 的路径（用于 id 和路由）-----
        const relativePath = path.relative(baseDir, file)
        // 移除文件扩展名（.md 或 .mdx）
        const parsed = path.parse(relativePath)
        const idPath = path.join(parsed.dir, parsed.name) // 如 "guide/getting-started"
        const routePath = '/' + idPath.replace(/\\/g, '/') // 转换为 URL 路径，如 "/guide/getting-started"

        // ----- 提取标题 -----
        let title = data.title
        if (!title) {
          const titleMatch = mdxContent.match(/^#\s+(.+)/m)
          title = titleMatch ? titleMatch[1] : parsed.name
        }

        articles.push({
          id: idPath,            // 例如 "guide/getting-started"
          path: routePath,       // 例如 "/guide/getting-started"
          title,
          meta: data,
        })
      }

      // ----- 为已知文档设定稳定的排序规则 -----
      // 优先顺序：
      // 1. 项目总览（ProjectOverview）
      // 2. 开发指南（DevelopmentGuide）
      // 3. 架构与目录结构（Architecture）
      // 4. 分页算法设计（PaginationAlgorithm）
      // 其他文档按 id 的字母顺序排在后面，保证扩展性。
      const ORDER: string[] = [
        'ProjectOverview',
        'DevelopmentGuide',
        'Architecture',
        'PaginationAlgorithm',
      ]

      articles.sort((a, b) => {
        const aIndex = ORDER.indexOf(a.id)
        const bIndex = ORDER.indexOf(b.id)

        const aRank = aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex
        const bRank = bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex

        if (aRank !== bRank) {
          return aRank - bRank
        }

        // 对于同一优先级（或未在 ORDER 中的文章），使用 id 作为次级排序键
        return a.id.localeCompare(b.id, 'zh-CN')
      })

      // ----- 输出映射文件 -----
      const outputPath = path.resolve(process.cwd(), outputFile)
      await fs.ensureDir(path.dirname(outputPath))
      await fs.writeJSON(outputPath, articles, { spaces: 2 })
    },
  }
}