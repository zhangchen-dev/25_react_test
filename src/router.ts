import { createBrowserRouter } from 'react-router-dom';
import HomePage from './page/HomePage';
import React from 'react';
import FastHtml from './page/fast-html/FastHtml';
import RecordStepPanel from './page/record-step/RecordStepPanel';

// 定义应用路由
export const router = createBrowserRouter([
  {
    path: '/',
    element: React.createElement(HomePage),
  },
  {
    path:'fast-page',
    element: React.createElement(FastHtml)
  },
  {
    path:'record-step',
    element: React.createElement(RecordStepPanel)
  }
]);