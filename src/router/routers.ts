import { createBrowserRouter } from "react-router";
import React from "react";
import HomePage from "../view/HomePage/index";
import BookPage from "../view/BookPage/index";

export const router = createBrowserRouter([
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
]);
