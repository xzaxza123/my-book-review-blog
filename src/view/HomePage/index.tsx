import React, { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router';
import { useTheme } from '../../features/themes/ThemeContext';
import { useResponsiveBookLayout } from '../../hooks/useResponsiveBookLayout';
import DesktopHomeScene from './scenes/DesktopHomeScene';
import MobileHomeScene from './scenes/MobileHomeScene';
import { SinglePageModeNotice } from '../../components/SinglePageModeNotice';
import './index.scss';
import pageMap from '../../../public/page-map.json';
import { routes } from 'virtual:react-press-routes';
import { STORAGE_KEYS, ROUTES, BOOK_PAGE_CONFIG } from '../../config';

// 从配置文件导入常量
const HINT_STORAGE_KEY = STORAGE_KEYS.HOME_INTERACTION_HINTS;
const BOOK_ROUTE = ROUTES.BOOK;

// 避免在路由切换时重复触发预分页任务
let hasStartedPrePagination = false;

function HomePage() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { deviceInfo } = useResponsiveBookLayout();
  const isDark = theme === 'dark';
  const isDoubleMode = deviceInfo.suggestedBookMode === 'double';

  const [showHints, setShowHints] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(HINT_STORAGE_KEY) !== 'seen';
  });

  const [showSinglePageNotice, setShowSinglePageNotice] = useState(false);

  useEffect(() => {
    if (!showHints) return;

    const timer = window.setTimeout(() => {
      setShowHints(false);
      window.localStorage.setItem(HINT_STORAGE_KEY, 'seen');
    }, 15000);

    return () => window.clearTimeout(timer);
  }, [showHints]);

  const hideHintsIfNeeded = () => {
    if (!showHints) return;
    setShowHints(false);
    window.localStorage.setItem(HINT_STORAGE_KEY, 'seen');
  };

  const handleBookClick = () => {
    hideHintsIfNeeded();
    
    // 单页模式检查：如果当前是单页模式，显示提示而不是导航
    if (!isDoubleMode) {
      setShowSinglePageNotice(true);
      return;
    }
    
    // 双页模式：正常跳转到书本路由
    navigate(BOOK_ROUTE);
  };

  const handleThemeToggle = () => {
    toggleTheme();
    hideHintsIfNeeded();
  };

  // 在首页渲染完成后，后台启动一次全局文章预分页
  // 只负责触发代码分割与分页计算，不向书本 DOM 注入任何页面
  useEffect(() => {
    if (hasStartedPrePagination) return;
    hasStartedPrePagination = true;

    let cancelled = false;

    const run = async () => {
      try {
        const { paginateArticle } = await import('../../core/pagination/articlePaginator');
        const articles = (pageMap as any[]).filter((a) => !!a.id);

        for (const article of articles) {
          if (cancelled) break;

          const route = routes.find((r) => r.id === article.id);
          const loader = route?.loader;
          if (!loader) continue;

          // 使用与书本相同的基础尺寸进行分页，以便结果可复用
          await paginateArticle(article.id, loader, {
            baseWidth: BOOK_PAGE_CONFIG.BASE_WIDTH,
            baseHeight: BOOK_PAGE_CONFIG.BASE_HEIGHT,
          });
        }
      } catch (err) {
        // 预分页失败不影响首页正常渲染
        console.warn('[HomePage] 预分页任务失败', err);
      }
    };

    // 轻微延迟，确保首屏渲染优先
    const timer = window.setTimeout(() => {
      run();
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <div className={`HomePage HomePage--${theme}`}>
      {isDoubleMode ? (
        <DesktopHomeScene
          isDark={isDark}
          showHints={showHints}
          onBookClick={handleBookClick}
          onThemeToggle={handleThemeToggle}
        />
      ) : (
        <MobileHomeScene
          isDark={isDark}
          showHints={showHints}
          onBookClick={handleBookClick}
          onThemeToggle={handleThemeToggle}
        />
      )}

      <div className="HomePage__route-content">
        <Outlet />
      </div>

      {/* 单页模式提示 */}
      <SinglePageModeNotice
        visible={showSinglePageNotice}
        onClose={() => setShowSinglePageNotice(false)}
      />

      {/* 目录区域暂时移除，后续重新规划信息架构后再启用 */}
    </div>
  );
}

export default HomePage;
