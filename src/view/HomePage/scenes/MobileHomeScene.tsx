 import React, { useEffect, useMemo, useState } from 'react';
import dayBackground from '../../../assets/img/Yd-4-tuya.webp';
import nightBackground from '../../../assets/img/yd-5-tuya.webp';
import whiteBook from '../../../assets/img/White-Book-Yd-tuya.webp';
import blackBook from '../../../assets/img/Black-Book-Yd-tuya.webp';
import { useBackgroundHotspots } from '../hooks/useBackgroundHotspots';
import type { HomeSceneProps } from './types';

type MobileHotspotKey = 'book';

function MobileHomeScene({ isDark, showHints, onBookClick, onThemeToggle }: HomeSceneProps) {
  const [loaded, setLoaded] = useState({ day: false, night: false });
  const [displayDark, setDisplayDark] = useState(isDark);
  const [isInteractionReady, setIsInteractionReady] = useState(false);

  const hotspotConfig = useMemo(
    () => ({
      book: { x: 0.49, y: 0.59 },
    }),
    [],
  );

  const hotspots = useBackgroundHotspots<MobileHotspotKey>(dayBackground, hotspotConfig, {
    defaultPositions: {
      book: { left: 50, top: 59 },
    },
    minUiScale: 0.35,
    maxUiScale: 1.8,
  });

  const isDisplayReady = displayDark ? loaded.night : loaded.day;
  const shouldShowDay = !displayDark && isDisplayReady;
  const shouldShowNight = displayDark && isDisplayReady;

  useEffect(() => {
    const targetLoaded = isDark ? loaded.night : loaded.day;
    if (targetLoaded) {
      setDisplayDark(isDark);
    }
  }, [isDark, loaded.day, loaded.night]);

  useEffect(() => {
    const hiddenKey = isDark ? 'day' : 'night';
    if (loaded[hiddenKey]) return;

    const preloadImage = new Image();
    preloadImage.src = hiddenKey === 'day' ? dayBackground : nightBackground;

    const markLoaded = () => {
      setLoaded((prev) => ({ ...prev, [hiddenKey]: true }));
    };

    if (preloadImage.complete) {
      markLoaded();
      return;
    }

    preloadImage.onload = markLoaded;
    return () => {
      preloadImage.onload = null;
    };
  }, [isDark, loaded]);

  useEffect(() => {
    if (!isDisplayReady) {
      setIsInteractionReady(false);
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      setIsInteractionReady(true);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [isDisplayReady]);

  return (
    <>
      <div
        className={`HomePage__background ${displayDark ? 'is-dark' : 'is-light'} ${isDisplayReady ? 'is-ready' : 'is-loading'}`}
      >
        <img
          className={`HomePage__image HomePage__image--day ${shouldShowDay ? 'is-visible' : 'is-hidden'}`}
          src={loaded.day || !isDark ? dayBackground : undefined}
          alt="白天书桌（移动端）"
          onLoad={() => setLoaded((prev) => ({ ...prev, day: true }))}
        />
        <img
          className={`HomePage__image HomePage__image--night ${shouldShowNight ? 'is-visible' : 'is-hidden'}`}
          src={loaded.night || isDark ? nightBackground : undefined}
          alt="夜晚书桌（移动端）"
          onLoad={() => setLoaded((prev) => ({ ...prev, night: true }))}
        />
      </div>

      <div className="HomePage__design-layer">
        <div className={`HomePage__design-canvas ${isInteractionReady ? 'is-ready' : 'is-loading'}`}>
          <button
            type="button"
            className={`HomePage__theme-switch ${isDark ? 'is-dark' : 'is-light'}`}
            onClick={onThemeToggle}
            aria-label="切换白天 / 夜晚主题"
          >
            <span className="HomePage__theme-switch-text">{isDark ? '切换白天' : '切换夜晚'}</span>
            {showHints && (
              <span className="HomePage__hint HomePage__hint--theme">点击切换主题</span>
            )}
          </button>

          <button
            type="button"
            className="HomePage__book-wrapper HomePage__book-wrapper--mobile"
            style={{
              left: `${hotspots.book.left}%`,
              top: `${hotspots.book.top}%`,
            }}
            onClick={onBookClick}
            aria-label="打开书本开始阅读"
          >
            <img className="HomePage__book-image" src={isDark ? blackBook : whiteBook} alt="可交互的书本" />
            {showHints && (
              <span className="HomePage__hint HomePage__hint--mobile-book">点击书本开始阅读</span>
            )}
          </button>
        </div>
      </div>
    </>
  );
}

export default MobileHomeScene;

