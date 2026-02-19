import { createBrowserRouter } from 'react-router-dom';
import HomePage from './page/HomePage';
import React from 'react';
import FastHtml from './page/fast-html/FastHtml';

// 定义应用路由
export const router = createBrowserRouter([
  {
    path: '/',
    element: React.createElement(HomePage),
  },
  {
    path:'fast-page',
    element: React.createElement(FastHtml)
  }
]);