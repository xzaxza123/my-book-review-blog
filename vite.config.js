import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { reactPress } from './src/core/mdx/vite-plugin'
import { reactPressQueryHandler } from './src/core/mdx/vite-plugin/query-handler'
import { mdxPageMap } from './src/core/mdx/code-splitting/vite-plugin-mdx-page-map'
import inject from '@rollup/plugin-inject'

export default defineConfig({
  base: '/my-book-review-blog/',
  plugins: [
    react(),
    reactPressQueryHandler(),
    reactPress(),
    mdxPageMap(),
    inject({ 
      $: "jquery",
      jQuery: "jquery",
      "window.jQuery": "jquery"
    }),
    
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    }
  },
  css: {
    preprocessorOptions: {
      scss: {
        sourceMap: true,
        outputStyle: 'expanded'
      },
    },
  }
})