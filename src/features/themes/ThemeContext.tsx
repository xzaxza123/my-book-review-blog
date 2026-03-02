// 主题相关的全局状态管理（浅色 / 深色）
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { STORAGE_KEYS } from '../../config';

// 支持的主题模式枚举
export type ThemeMode = 'light' | 'dark';

// 提供给 Context 使用的值类型
interface ThemeContextValue {
  theme: ThemeMode;
  toggleTheme: () => void;
}

// 全局 Theme 上下文，初始值为 undefined，方便在自定义 Hook 中做使用校验
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

// 从配置文件导入存储键
const THEME_STORAGE_KEY = STORAGE_KEYS.THEME;

// 计算初始主题：
// 1. SSR 环境下默认返回 light
// 2. 优先读取 localStorage 中用户之前选择的主题
// 3. 否则根据系统的深色 / 浅色偏好自动选择
function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
  if (stored === 'light' || stored === 'dark') return stored;
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}

// ThemeProvider：包裹在应用最外层，为子组件提供 theme 和切换方法
export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // 使用惰性初始化函数，首屏时只执行一次 getInitialTheme
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    // 把主题信息写到 <html data-theme="light|dark">，方便 CSS 里通过属性选择器做主题样式
    root.dataset.theme = theme;
    // 同步写入 localStorage，持久化用户选择
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  // useMemo 确保 value 引用稳定，避免无意义的子组件重渲染
  const value = useMemo(
    () => ({
      theme,
      // 简单的二元切换：light <-> dark
      toggleTheme: () => setTheme((prev) => (prev === 'light' ? 'dark' : 'light')),
    }),
    [theme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

// 自定义 Hook，方便在任意子组件中访问 theme 和 toggleTheme
export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // 限制只能在 ThemeProvider 包裹的子树中使用
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}