// ==================== Vite 插件主入口文件 ====================
// 这个文件是 React Press 的核心插件，负责：
// 1. 扫描文档目录
// 2. 生成虚拟模块 virtual:react-press-routes（提供路由 loader）

import type { Plugin } from "vite";
import path from "path";
import fs from "fs/promises";
import type { PageMeta } from "../../types/index";

// React Press 主插件函数
export function reactPress(): Plugin {
  let pages: PageMeta[] = []; // 存储扫描到的页面元数据

  return {
    name: "vite-plugin-react-press",
    enforce: "pre",

    async configResolved() {
      try {
        pages = await scanDocs("docs");
        console.log(`✓ Found ${pages.length} pages`);
      } catch (error) {
        console.error("Failed to scan docs:", error);
      }
    },

    resolveId(id: string) {
      // 只保留 routes 虚拟模块
      if (id === "virtual:react-press-routes") {
        return `\0${id}`;
      }
    },

    async load(id: string) {
      if (id === "\0virtual:react-press-routes") {
        return generateRoutesCode(pages);
      }
    },
  };
}

// ==================== 辅助函数定义 ====================

// 扫描文档文件
async function scanDocs(dir: string): Promise<PageMeta[]> {
  const pages: PageMeta[] = [];

  try {
    const files = await getFiles(dir);

    for (const file of files) {
      if (file.endsWith(".mdx") || file.endsWith(".md")) {
        const content = await fs.readFile(file, "utf-8");
        const { parseFrontMatter } = await import("./frontmatter");
        const { frontmatter, content: markdown } = parseFrontMatter(content);

        const relativePath = path.relative(process.cwd(), file);
        const routePath = getRoutePath(relativePath);
        // 生成 id：相对于 docs 的路径（不带扩展名）
        const id = getArticleId(relativePath);

        pages.push({
          id,
          title: frontmatter.title || path.basename(file, path.extname(file)),
          path: routePath,
          filePath: relativePath,
          frontmatter,
          content: markdown,
          lastUpdated: (await fs.stat(file)).mtimeMs,
        });
      }
    }
  } catch (error) {
    console.error("Error scanning docs:", error);
  }

  return pages;
}

// 递归获取所有文件
async function getFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(async (entry) => {
        const res = path.resolve(dir, entry.name);
        return entry.isDirectory() ? await getFiles(res) : res;
      })
    );
    return files.flat();
  } catch (error) {
    console.error(`Error reading directory ${dir}:`, error);
    return [];
  }
}

// 计算路由路径
function getRoutePath(filePath: string): string {
  let route = filePath.replace(/^docs[\\/]/, "").replace(/\.(mdx|md)$/, "");
  route = route.replace(/\\/g, "/");
  if (route.endsWith("/index")) {
    route = route.slice(0, -6);
  }
  if (!route.startsWith("/")) {
    route = "/" + route;
  }
  return route || "/";
}

// 生成文章 ID（相对于 docs 的路径，不带扩展名）
function getArticleId(filePath: string): string {
  let id = filePath.replace(/^docs[\\/]/, "").replace(/\.(mdx|md)$/, "");
  id = id.replace(/\\/g, "/");
  return id;
}

// 生成路由代码：导出 routes 数组，每个路由包含 id, path, meta, loader
function generateRoutesCode(pages: PageMeta[]): string {
  if (pages.length === 0) {
    return `export const routes = [];`;
  }

  // 为每个页面生成 loader 函数声明
  // 这里显式使用以项目根为基准的绝对路径，避免被 Vite 重写成 `"/@id/..."` 形式
  const loaderDeclarations = pages
    .map((page, index) => {
      let importPath = page.filePath;

      // 统一为 POSIX 风格
      importPath = importPath.replace(/\\/g, "/");

      // 确保以 `/` 开头，例如 `/docs/TestDemo.mdx`
      if (!importPath.startsWith("/")) {
        importPath = "/" + importPath;
      }

      // 生成：() => import("/docs/TestDemo.mdx?react-press")
      return `const loader_${index} = () => import('${importPath}?react-press');`;
    })
    .join("\n");

  // 生成 routes 数组，每个路由包含 id, path, meta, loader
  const routesArray = pages
    .map(
      (page, index) => `{
  id: ${JSON.stringify(page.id)},
  path: ${JSON.stringify(page.path)},
  meta: ${JSON.stringify(page.frontmatter)},
  loader: loader_${index}
}`
    )
    .join(",\n  ");

  return `
// 自动生成的路由模块
${loaderDeclarations}

export const routes = [
  ${routesArray}
];
`;
}