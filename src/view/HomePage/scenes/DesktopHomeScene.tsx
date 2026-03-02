import React, { useEffect, useMemo, useState } from 'react';
import dayBackground from '../../../assets/img/1-tuya.webp';
import nightBackground from '../../../assets/img/2-tuya.webp';
import whiteBook from '../../../assets/img/WhitePaper-tuya.webp';
import blackBook from '../../../assets/img/BlackBook-tuya.webp';
import whiteLampBtn from '../../../assets/img/WhiteBtn.png';
import blackLampBtn from '../../../assets/img/BlackBtn.png';
import { useBackgroundHotspots } from '../hooks/useBackgroundHotspots';
import type { HomeSceneProps } from './types';

type DesktopHotspotKey = 'book' | 'lamp';

function DesktopHomeScene({ isDark, showHints, onBookClick, onThemeToggle }: HomeSceneProps) {
  const [loaded, setLoaded] = useState({ day: false, night: false });
  const [displayDark, setDisplayDark] = useState(isDark);
  const [isInteractionReady, setIsInteractionReady] = useState(false);

  const hotspotConfig = useMemo(
    () => ({
      book: { x: 0.489, y: 0.67 },
      lamp: { x: 0.273, y: 0.355 },
    }),
    [],
  );

  const hotspots = useBackgroundHotspots<DesktopHotspotKey>(dayBackground, hotspotConfig, {
    defaultPositions: {
      book: { left: 50, top: 67 },
      lamp: { left: 28, top: 35.5 },
    },
    minUiScale: 0.2,
    maxUiScale: 2.5,
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
          alt="白天书桌"
          onLoad={() => setLoaded((prev) => ({ ...prev, day: true }))}
        />
        <img
          className={`HomePage__image HomePage__image--night ${shouldShowNight ? 'is-visible' : 'is-hidden'}`}
          src={loaded.night || isDark ? nightBackground : undefined}
          alt="夜晚书桌"
          onLoad={() => setLoaded((prev) => ({ ...prev, night: true }))}
        />
      </div>

      <div className="HomePage__design-layer">
        <div className={`HomePage__design-canvas ${isInteractionReady ? 'is-ready' : 'is-loading'}`}>
          <button
            type="button"
            className="HomePage__book-wrapper HomePage__book-wrapper--desktop"
            style={{
              left: `${hotspots.book.left}%`,
              top: `${hotspots.book.top}%`,
            }}
            onClick={onBookClick}
            aria-label="打开书本开始阅读"
          >
            <img className="HomePage__book-image" src={isDark ? blackBook : whiteBook} alt="可交互的书本" />
            {showHints && (
              <span className="HomePage__hint HomePage__hint--book">点击书本开始阅读</span>
            )}
          </button>

          <button
            type="button"
            className="HomePage__lamp-wrapper"
            style={{
              left: `${hotspots.lamp.left}%`,
              top: `${hotspots.lamp.top}%`,
            }}
            onClick={onThemeToggle}
            aria-label="切换白天 / 夜晚主题"
          >
            <img
              className="HomePage__lamp-image"
              src={isDark ? blackLampBtn : whiteLampBtn}
              alt="切换主题按钮"
            />
            {showHints && (
              <span className="HomePage__hint HomePage__hint--lamp">点亮台灯切换昼夜</span>
            )}
          </button>
        </div>
      </div>
    </>
  );
}

export default DesktopHomeScene;

