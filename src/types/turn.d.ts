// Type definitions for turn.js v4
// Project: https://github.com/blasten/turn.js

declare namespace Turn {
  interface TurnWhen {
    /** 翻页时的回调函数 */
    turning?: (e: JQuery.Event, page: number, view: string[]) => void;
    /** 翻页结束时的回调函数 */
    turned?: (e: JQuery.Event, page: number, view: string[]) => void;
    /** 缺失页面时的回调函数 */
    missing?: (e: JQuery.Event, pages: number[]) => void;
    /** 缩放时的回调函数 */
    zooming?: (e: JQuery.Event, ratio: number, page: number) => void;
  }

  interface TurnOptions {
    /** 翻页宽度 */
    width?: number;
    /** 翻页高度 */
    height?: number;
    /** 自动居中 */
    autoCenter?: boolean;
    /** 显示模式：single(单页) 或 double(双页) */
    display?: 'single' | 'double';
    /** 启用硬件加速 */
    acceleration?: boolean;
    /** 翻页时的海拔高度 */
    elevation?: number;
    /** 渐变效果持续时间 */
    duration?: number;
    /** 页面方向：ltr(从左到右) 或 rtl(从右到左) */
    direction?: 'ltr' | 'rtl';
    /** 初始页面 */
    page?: number;
    /** 总页数 */
    pages?: number;
    /** 启用鼠标滚轮支持 */
    mousewheel?: boolean;
    /** 启用手势支持 */
    gestures?: boolean;
    /** 启用缩放功能 */
    zoom?: boolean;
    /** CSS transform scale 比例，用于修正坐标计算（当元素被 CSS scale 缩放时） */
    scaleRatio?: number;
    /** 事件回调函数对象 */
    when?: TurnWhen;
  }

  interface TurnMethods {
    /** 初始化turn.js */
    (options: TurnOptions): JQuery;
    /** 初始化turn.js - 处理HTML元素或null */
    (element: HTMLElement | null, options: TurnOptions): JQuery;
    /** 翻到指定页面 */
    (page: number): JQuery;
    /** 调用turn方法 - page */
    (method: 'page', page: number): JQuery;
    /** 调用turn方法 - 字符串方法名和数字参数组合 */
    (method: string, value: number): JQuery;
    /** 获取当前页面 */
    (method: 'page'): number;
    /** 获取总页数 */
    (method: 'pages'): number;
    /** 获取显示模式 */
    (method: 'display'): string;
    /** 获取视图中的页面 */
    (method: 'view'): string[];
    /** 获取缩放比例 */
    (method: 'zoom'): number;
    /** 设置缩放比例 */
    (method: 'zoom', value: number): JQuery;
    /** 禁用翻页 */
    (method: 'disable'): JQuery;
    /** 启用翻页 */
    (method: 'enable'): JQuery;
    /** 销毁turn.js实例 */
    (method: 'destroy'): JQuery;
    /** 添加页面 */
    (method: 'addPage', element: JQuery | HTMLElement, page: number): JQuery;
    /** 移除页面 */
    (method: 'removePage', page: number): JQuery;
    /** 更新页面尺寸 */
    (method: 'size', width: number, height: number): JQuery;
    /** 重新加载页面 */
    (method: 'resize'): JQuery;
    /** 跳转到下一页 */
    (method: 'next'): JQuery;
    /** 跳转到上一页 */
    (method: 'previous'): JQuery;
    /** 检查是否支持硬件加速 */
    (method: 'hasHW'): boolean;
    /** 检查是否支持CSS转换 */
    (method: 'hasTransform'): boolean;
    /** 检查是否支持3D转换 */
    (method: 'has3d'): boolean;
    /** 停止当前动画 */
    (method: 'stop'): JQuery;
    /** 启用/禁用页面卷角效果 */
    (method: 'peel', corner: string, enable?: boolean): JQuery;
    /** 检查实例是否已初始化 */
    (method: 'is'): boolean;
    /** 检查是否存在指定页面 */
    (method: 'hasPage', page: number): boolean;
    /** 获取当前页面范围 */
    (method: 'range', page?: number): number[];
    /** 自动居中 */
    (method: 'center'): JQuery;
    /** 更新显示 */
    (method: 'update'): JQuery;
    /** 更新缩放比例，用于重新计算四个角的交互坐标范围 */
    (method: 'updateScaleRatio', scaleRatio: number): JQuery;
  }
}

interface JQuery {
  /** turn.js方法扩展 */
  turn: Turn.TurnMethods;
}

// 全局变量声明
declare var turn: {
  /** 默认配置选项 */
  defaults: Turn.TurnOptions;
  /** 版本号 */
  version: string;
  /** 浏览器功能检测 */
  features: {
    /** 是否支持硬件加速 */
    hw: boolean;
    /** 是否支持CSS转换 */
    transform: boolean;
    /** 是否支持3D转换 */
    transform3d: boolean;
  };
};