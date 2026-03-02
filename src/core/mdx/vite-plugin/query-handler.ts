import fs from "fs/promises";
import path from "path";
import type { Plugin } from "vite";

// 查询参数处理器 - 专门处理带 ?react-press 参数的MDX文件导入
// 负责将MDX文件编译为React组件，并注入必要的上下文
export function reactPressQueryHandler(): Plugin {
  return {
    name: "react-press-query-handler",
    enforce: "pre",

    async transform(_code: string, id: string) {
      if (id.includes("?react-press")) {
        const cleanId = id.replace(/\?react-press$/, "");

        try {
          const content = await fs.readFile(cleanId, "utf-8");
          const { parseFrontMatter } = await import("./frontmatter");
          const { frontmatter, content: markdown } = parseFrontMatter(content);

          // 提取并处理 import 语句
          const importStatements = extractImportStatements(content);
          const processedContent = removeImportStatements(markdown);
          const importedComponents = parseImports(importStatements);

          // 生成安全的组件名
          const componentName = generateComponentName(cleanId);

          return `
import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import 'katex/dist/katex.min.css'

// 用户自定义的 import 语句
${importStatements}

const content = ${JSON.stringify(processedContent)}

const components = {
  // 代码块高亮
  code({ node, inline, className, children, ...props }) {
    const match = /language-(\\w+)/.exec(className || '')
    const language = match ? match[1] : ''
    
    if (inline) {
      return React.createElement('code', {
        className: \`inline-code \${className || ''}\`,
        ...props
      }, children)
    }
    
    return React.createElement(SyntaxHighlighter, {
      style: vscDarkPlus,
      language: language,
      PreTag: 'div',
      showLineNumbers: language && language !== 'text',
      ...props
    }, String(children).replace(/\\n$/, ''))
  },
  
  // 图片处理
  img({ src, alt, title, ...props }) {
    let imageSrc = src
    if (src && !src.startsWith('http') && !src.startsWith('/')) {
      imageSrc = '/' + src
    }
    
    return React.createElement('figure', { className: 'image-container' },
      React.createElement('img', {
        src: imageSrc,
        alt: alt || '',
        title: title,
        loading: 'lazy',
        className: 'mdx-image',
        ...props
      }),
      title && React.createElement('figcaption', { className: 'image-caption' }, title)
    )
  },
  
  // 表格
  table({ children, ...props }) {
    return React.createElement(React.Fragment, null,
      React.createElement('div', { className: 'table-container' },
        React.createElement('table', { className: 'mdx-table', ...props }, children)
      )
    )
  },
  
  th({ children, ...props }) {
    return React.createElement('th', { className: 'table-header', ...props }, children)
  },
  
  td({ children, ...props }) {
    return React.createElement('td', { className: 'table-cell', ...props }, children)
  },
  
  // 引用块
  blockquote({ children, ...props }) {
    return React.createElement('blockquote', { className: 'mdx-blockquote', ...props }, children)
  },
  
  // 链接
  a({ href, children, ...props }) {
    const isExternal = href && (href.startsWith('http') || href.startsWith('//'))
    
    if (isExternal) {
      return React.createElement('a', {
        href: href,
        target: '_blank',
        rel: 'noopener noreferrer',
        className: 'external-link',
        ...props
      }, [
        children,
        React.createElement('svg', {
          key: 'external-icon',
          className: 'external-icon',
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: '0 0 24 24',
          width: '14',
          height: '14'
        },
          React.createElement('path', { key: 'path1', fill: 'none', d: 'M0 0h24v24H0z' }),
          React.createElement('path', { key: 'path2', d: 'M10 6v2H5v11h11v-5h2v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6zm11-3v8h-2V6.413l-7.793 7.794-1.414-1.414L17.585 5H13V3h8z' })
        )
      ])
    }
    
    return React.createElement('a', { href: href, className: 'internal-link', ...props }, children)
  },
  
  // 标题
  h1({ children, ...props }) {
    return React.createElement('h1', { className: 'mdx-heading mdx-h1', ...props }, children)
  },
  h2({ children, ...props }) {
    return React.createElement('h2', { className: 'mdx-heading mdx-h2', ...props }, children)
  },
  h3({ children, ...props }) {
    return React.createElement('h3', { className: 'mdx-heading mdx-h3', ...props }, children)
  },
  
  // 列表
  ul({ children, ...props }) {
    return React.createElement('ul', { className: 'mdx-list', ...props }, children)
  },
  ol({ children, ...props }) {
    return React.createElement('ol', { className: 'mdx-list mdx-ordered-list', ...props }, children)
  },
  li({ children, ...props }) {
    return React.createElement('li', { className: 'mdx-list-item', ...props }, children)
  },
  
  // 段落
  p({ children, ...props }) {
    return React.createElement('div', { className: 'mdx-paragraph', ...props }, children)
  },
  
  // 分割线
  hr({ ...props }) {
    return React.createElement('hr', { className: 'mdx-hr', ...props })
  },
  
  // 内联代码
  inlineCode({ children, ...props }) {
    return React.createElement('code', { className: 'mdx-inline-code', ...props }, children)
  },
  
  // 强调
  strong({ children, ...props }) {
    return React.createElement('strong', { className: 'mdx-strong', ...props }, children)
  },
  em({ children, ...props }) {
    return React.createElement('em', { className: 'mdx-emphasis', ...props }, children)
  },
  
  // ===== 动态生成的自定义组件 =====
  // 为每个导入的组件创建对应的小写键名，直接使用导入的组件
  ${importedComponents
    .map(({ name }) => {
      const lowerName = name.toLowerCase();
      return `${lowerName}: ${name}`;
    })
    .join(",\n  ")}
}

function ${componentName}() {
  return React.createElement('article', { className: 'mdx-content' }, [
    ${JSON.stringify(frontmatter.title)} && React.createElement('h1', { 
      key: 'title', 
      className: 'mdx-title' 
    }, ${JSON.stringify(frontmatter.title)}),
    ${JSON.stringify(frontmatter.date)} && React.createElement('div', { 
      key: 'meta',
      className: 'mdx-meta' 
    },
      React.createElement('time', { 
        key: 'date',
        className: 'mdx-date' 
      }, 
        new Date(${JSON.stringify(frontmatter.date)}).toLocaleDateString()
      )
    ),
    React.createElement(ReactMarkdown, {
      key: 'content',
      remarkPlugins: [remarkGfm, remarkMath],
      rehypePlugins: [rehypeKatex, rehypeRaw],
      components: components
    }, content)
  ])
}

export default ${componentName}

export const frontmatter = ${JSON.stringify(frontmatter)}
export const metadata = {
  title: ${JSON.stringify(frontmatter.title || "")},
  description: ${JSON.stringify(frontmatter.description || "")},
  date: ${JSON.stringify(frontmatter.date || "")},
  tags: ${JSON.stringify(frontmatter.tags || [])},
  filePath: ${JSON.stringify(cleanId)}
}
`;
        } catch (error) {
          console.error("MDX transform error:", error);
          const errorObj = error instanceof Error ? error : new Error(String(error));
          return createErrorComponent(cleanId, errorObj);
        }
      }
      return null;
    },
  };
}

// 辅助函数保持不变（generateComponentName, extractImportStatements, removeImportStatements, parseImports, createErrorComponent）
function generateComponentName(filePath: string): string {
  const name = path
    .basename(filePath, path.extname(filePath))
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/^(\d)/, "_$1");
  return `MDX_${name}_${Math.random().toString(36).substr(2, 9)}`;
}

function extractImportStatements(content: string): string {
  const importRegex = /^import\s+(?:\{[^}]*\}|[^\n]+)\s+from\s+['"]([^'"]+)['"]/gm;
  let match;
  const imports: string[] = [];
  while ((match = importRegex.exec(content)) !== null) {
    imports.push(match[0]);
  }
  return imports.join("\n");
}

function removeImportStatements(content: string): string {
  return content.replace(
    /^import\s+(?:\{[^}]*\}|[^\n]+)\s+from\s+['"]([^'"]+)['"]\s*\n?/gm,
    ""
  );
}

function parseImports(importStatements: string): Array<{ name: string; importPath: string }> {
  const importRegex = /import\s+(?:\{(.*?)\}|([^\s]+))\s+from\s+['"]([^'"]+)['"]/g;
  const imports: Array<{ name: string; importPath: string }> = [];
  let match;
  while ((match = importRegex.exec(importStatements)) !== null) {
    const namedImports = match[1];
    const defaultImport = match[2];
    const importPath = match[3];
    if (namedImports) {
      const componentNames = namedImports
        .split(",")
        .map((name) => name.trim())
        .filter((name) => name);
      componentNames.forEach((name) => {
        imports.push({ name, importPath });
      });
    } else if (defaultImport) {
      imports.push({ name: defaultImport, importPath });
    }
  }
  return imports;
}

function createErrorComponent(filePath: string, error: Error): string {
  return `
import React from 'react'

export default function MDXError() {
  return React.createElement('div', { className: "mdx-error" }, [
    React.createElement('h2', { key: 'title' }, 'Failed to load content'),
    React.createElement('p', { key: 'file' }, 'File: ${filePath}'),
    React.createElement('pre', { 
      key: 'error',
      className: "error-details" 
    }, ${JSON.stringify(error.message)})
  ])
}
`;
}