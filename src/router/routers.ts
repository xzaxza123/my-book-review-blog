import { createBrowserRouter } from "react-router";
import React from "react";
import HomePage from "../view/HomePage/index";
import BookPage from "../view/BookPage/index";

// 使用 Vite 注入的 BASE_URL 作为 basename：
// - 开发环境为 "/"，本地访问正常
// - 生产环境（GitHub Pages）为 "/my-book-review-blog/"，与 vite.config.js 中的 base 对齐
export const router = createBrowserRouter(
  [
    {
      path: "/",
      element: React.createElement(HomePage),
      children: [
        // 书本入口：只保留一个书本路由，不再承载页码信息
        {
          path: "MyBookReview",
          element: React.createElement(BookPage),
        },
      ],
    },
  ],
  {
    basename: import.meta.env.BASE_URL,
  }
);
