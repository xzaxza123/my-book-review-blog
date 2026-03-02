## My Book Review Blog · 书页翻转式阅读博客

一个基于 **React + Vite + TypeScript + MDX** 打造的书评 / 长文阅读项目，核心体验是「像翻纸质书一样阅读技术文章与读书笔记」。

项目在前端层面对 **分页算法**、**书本翻页动画** 和 **MDX 文档渲染** 做了较多探索，适合作为简历或开源展示项目。

### 主要特性

- **书本翻页 UI**
  - 基于 `turn.js` 和自定义 `useResponsiveBookLayout` Hook 实现的双页翻书体验
  - 支持桌面 / 移动设备检测与自适应布局（双页模式 / 单页模式切换）

- **精细的分页算法**
  - `src/utils/paginate.ts` 中实现了针对 **段落、图片、代码块、表格、列表、引用、自定义 HTML、网格布局** 等多种元素的分页策略
  - 通过隐藏测量容器、外边距折叠模拟与「剩余高度填充」策略，尽量减少每页底部的大块空白
  - 图片、代码块等不可拆分元素在高度超出一页时会进行整体缩放，而不是简单裁剪

- **MDX 文档系统**
  - 使用自定义 Vite 插件 `reactPress` 与 `mdxPageMap` 扫描 `docs/` 目录生成路由与 `page-map.json`
  - 支持 MDX、代码高亮、数学公式等富文本内容
  - 提供专门的分页测试文档 `docs/PaginateAllCases.mdx`

- **主题与样式**
  - 简单的主题切换（深色 / 浅色），见 `features/themes/ThemeContext.tsx`
  - 全局 MDX 样式集中在 `src/styles/mdx-styles.css`，页面与组件局部样式使用 `index.scss`

### 技术栈

- **前端框架**：React 19、React Router 7
- **构建工具**：Vite（rolldown-vite）、自定义 Vite 插件
- **语言与类型**：TypeScript、类型声明集中在 `src/types`
- **内容与样式**：MDX、SCSS、PostCSS（`postcss-preset-env` + `autoprefixer` + `cssnano`）

### 快速开始

```bash
# 安装依赖
npm install

# 本地开发（默认 http://localhost:5173）
npm run dev

# 生产构建
npm run build

# 预览构建产物
npm run preview
```

### 目录结构概览

- `src/core`：书本分页与 MDX 插件核心逻辑
  - `book/spreadMap.ts`：内容页与物理书页（spread）之间的映射
  - `pagination/articlePaginator.ts`：按文章维度做 DOM 分页与缓存
  - `mdx/vite-plugin`：扫描 docs 目录并生成虚拟路由模块
- `src/utils`：
  - `paginate.ts`：**核心 DOM 分页算法**
  - `deviceDetector.ts`：设备与视口信息检测
  - `turn.js`：本地化的 turn.js 源码（书本翻页效果）
- `src/view`：
  - `HomePage`：首页与封面场景（桌面 / 移动）
  - `BookPage`：书本阅读页（turn.js 容器、前言、目录、正文、书签抽屉等）
- `src/hooks`：`useArticlePages`、`useResponsiveBookLayout` 等自定义 Hook
- `src/styles`：全局 MDX 样式与基础样式
- `docs`：项目文档与分页测试文档

关于核心模块和架构细节，可参考：

- `docs/ProjectOverview.mdx`：项目背景与整体功能
- `docs/Architecture.mdx`：目录结构与数据流说明
- `docs/DevelopmentGuide.mdx`：开发指南与代码规范
- `docs/PaginationAlgorithm.mdx`：分页算法设计与边界情况说明

### 部署说明（概要）

- **GitHub Pages**
  - 在 `vite.config.js` 中将 `base` 配置为 `/my-book-review-blog/`
  - 使用 GitHub Actions 将 `dist/` 部署到 `gh-pages` 分支并开启 Pages

- **Vercel**
  - 直接导入 GitHub 仓库，Framework 选择 `Vite`
  - Build Command：`npm run build`，Output Directory：`dist`
  - Vercel 环境下可以将 `base` 设为 `/`，视需要通过环境变量区分构建配置
