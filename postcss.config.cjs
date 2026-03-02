// postcss.config.cjs
// PostCSS 全局样式处理配置：
// - postcss-preset-env：让你可以使用较新的 CSS 特性，由插件按目标浏览器做降级
// - autoprefixer：为兼容浏览器自动补全供应商前缀（如 -webkit-、-ms- 等）
// - cssnano：仅在生产环境压缩 CSS 体积，开发环境保留可读性
module.exports = {
  plugins: {
    "postcss-preset-env": {},
    autoprefixer: {},
    cssnano: process.env.NODE_ENV === "production" ? {} : false,
  },
};