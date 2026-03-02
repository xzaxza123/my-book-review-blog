import { useEffect, useState } from 'react';

export interface HotspotPoint {
  x: number;
  y: number;
}

export interface HotspotPosition {
  left: number;
  top: number;
}

export interface UseBackgroundHotspotsOptions<T extends string> {
  defaultPositions?: Record<T, HotspotPosition>;
  minUiScale?: number;
  maxUiScale?: number;
}

function computeHotspotPositions<T extends string>(
  viewportWidth: number,
  viewportHeight: number,
  imageWidth: number,
  imageHeight: number,
  config: Record<T, HotspotPoint>,
): Record<T, HotspotPosition> {
  const scale = Math.max(viewportWidth / imageWidth, viewportHeight / imageHeight);
  const renderedWidth = imageWidth * scale;
  const renderedHeight = imageHeight * scale;
  const offsetX = (viewportWidth - renderedWidth) / 2;
  const offsetY = (viewportHeight - renderedHeight) / 2;

  const result = {} as Record<T, HotspotPosition>;

  (Object.keys(config) as T[]).forEach((key) => {
    const { x, y } = config[key];
    const screenX = offsetX + x * imageWidth * scale;
    const screenY = offsetY + y * imageHeight * scale;

    result[key] = {
      left: (screenX / viewportWidth) * 100,
      top: (screenY / viewportHeight) * 100,
    };
  });

  return result;
}

function createDefaultPositions<T extends string>(
  config: Record<T, HotspotPoint>,
  fallback?: Record<T, HotspotPosition>,
): Record<T, HotspotPosition> {
  if (fallback) return fallback;

  const result = {} as Record<T, HotspotPosition>;
  (Object.keys(config) as T[]).forEach((key) => {
    result[key] = { left: 50, top: 50 };
  });
  return result;
}

export function useBackgroundHotspots<T extends string>(
  backgroundSrc: string,
  config: Record<T, HotspotPoint>,
  options?: UseBackgroundHotspotsOptions<T>,
): Record<T, HotspotPosition> {
  const [positions, setPositions] = useState<Record<T, HotspotPosition>>(() =>
    createDefaultPositions(config, options?.defaultPositions),
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let cancelled = false;
    const image = new Image();
    image.src = backgroundSrc;

    const minUiScale = options?.minUiScale ?? 0.2;
    const maxUiScale = options?.maxUiScale ?? 2.5;

    const update = (imageWidth: number, imageHeight: number) => {
      if (cancelled) return;

      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      if (!viewportWidth || !viewportHeight) return;

      const bgScale = Math.max(viewportWidth / imageWidth, viewportHeight / imageHeight);
      document.documentElement.style.setProperty('--home-bg-scale', String(bgScale));

      const uiScaleRaw = (viewportWidth / imageWidth + viewportHeight / imageHeight) / 2;
      const uiScale = Math.max(minUiScale, Math.min(uiScaleRaw, maxUiScale));
      document.documentElement.style.setProperty('--home-ui-scale', String(uiScale));

      setPositions(
        computeHotspotPositions(viewportWidth, viewportHeight, imageWidth, imageHeight, config),
      );
    };

    const handleResize = () => {
      if (!image.naturalWidth || !image.naturalHeight) return;
      update(image.naturalWidth, image.naturalHeight);
    };

    const handleLoad = () => {
      update(image.naturalWidth, image.naturalHeight);
      window.addEventListener('resize', handleResize);
    };

    if (image.complete && image.naturalWidth && image.naturalHeight) {
      handleLoad();
    } else {
      image.addEventListener('load', handleLoad);
    }

    return () => {
      cancelled = true;
      window.removeEventListener('resize', handleResize);
      image.removeEventListener('load', handleLoad);
    };
  }, [backgroundSrc, config, options?.maxUiScale, options?.minUiScale]);

  return positions;
}

