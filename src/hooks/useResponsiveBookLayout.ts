import { useState, useEffect, useCallback } from 'react';
import { getDeviceInfo, onDeviceChange, type DeviceInfo } from '../utils/deviceDetector';
import { syncBookmarkFixedPages } from '../view/BookPage/bookmarkDrawer';

export interface BookDimensions {
  container: { width: number; height: number };
  content: { width: number; height: number };
}

/**
 * Turn.js 内部固定尺寸（像素）
 * 保持这个尺寸不变，通过 CSS transform scale 来实现响应式缩放
 */
const TURN_JS_BASE_WIDTH = 1152;
const TURN_JS_BASE_HEIGHT = 720;

const calculateBookDimensionsFromInfo = (info: DeviceInfo): BookDimensions => {
  const { suggestedBookMode, suggestedBookRatio, width, height } = info;

  if (suggestedBookMode === 'double') {
    // 双页模式计算
    const bookWidth = Math.floor(Math.min(width * suggestedBookRatio, 1200) * 100) / 100;
    const bookHeight = Math.floor(bookWidth * (720 / 1152) * 100) / 100; // 基于示例比例 1152:720
    // 计算封面和内容尺寸（基于示例比例）
    const coverWidth = Math.floor((bookWidth / 2) * 100) / 100; // 双页模式每页宽度为容器一半
    const coverHeight = Math.floor(bookHeight * 100) / 100;

    const contentWidth = Math.floor(coverWidth * (552 / 576) * 100) / 100; // 基于示例比例 576:720 -> 552:698.4
    const contentHeight = Math.floor(coverHeight * (698.4 / 720) * 100) / 100;

    return {
      container: { width: bookWidth, height: bookHeight },
      content: { width: contentWidth, height: contentHeight }
    };
  }

  // 单页模式计算
  const bookWidth = Math.floor(width * 100) / 100;
  const bookHeight = Math.floor(height * 100) / 100;

  return {
    container: { width: bookWidth, height: bookHeight },
    content: { width: bookWidth, height: bookHeight }
  };
};

/**
 * 响应式书本布局钩子
 * 根据设备信息动态调整书本显示模式和尺寸
 */
export const useResponsiveBookLayout = () => {
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo>(() => getDeviceInfo());
  const [bookDimensions, setBookDimensions] = useState<BookDimensions>(() =>
    calculateBookDimensionsFromInfo(getDeviceInfo())
  );
  
  // 计算缩放比例
  const calculateScaleRatio = useCallback((dimensions: BookDimensions): number => {
    if (dimensions.container.width <= 0 || dimensions.container.height <= 0) {
      return 1;
    }

    // 计算宽度和高度的缩放比例，并在基础比例上提升 20%，保留两位小数
    const scaleX =
      Math.round(((dimensions.container.width / TURN_JS_BASE_WIDTH) * 0.9) * 100) / 100;
    const scaleY =
      Math.round(((dimensions.container.height / TURN_JS_BASE_HEIGHT) * 0.9) * 100) / 100;

    // 取较小的比例值，确保内容不会被裁剪
    return Math.min(scaleX, scaleY);
  }, []);

  const [scaleRatio, setScaleRatio] = useState<number>(() => 
    calculateScaleRatio(calculateBookDimensionsFromInfo(getDeviceInfo()))
  );

  // 计算书本尺寸
  const calculateBookDimensions = useCallback((info: DeviceInfo): BookDimensions => {
    return calculateBookDimensionsFromInfo(info);
  }, []);

  // 这里不限定具体 HTMLElement 类型，以兼容 turn.js 回调中 $(this) 推断出的 JQuery<TurnWhen>
  function updateDepth(book: JQuery, newPage: number) {
    const page = book.turn('page') as number;
    const pages = book.turn('pages') as number;
    let depthWidth = 16 * Math.min(1, (page * 2) / pages);

    newPage = newPage || page;

    if (newPage > 3) {
      $('.sj-book .p2 .depth').css({
        width: depthWidth,
        left: 23 - depthWidth
      });

    } else {
      $('.sj-book .p2 .depth').css({ width: 0 });
    }

    depthWidth = 16 * Math.min(1, ((pages - page) * 2) / pages);

    if (newPage < pages - 3) {
      $('.sj-book .BackCoverTitlePage-1 .depth').css({
        width: depthWidth,
        right: 23 - depthWidth
      });
    } else {
      $('.sj-book .BackCoverTitlePage-1 .depth').css({ width: 0 });
    }
  }

  // 初始化设备信息监听
  useEffect(() => {
    // 监听设备变化
    const cleanup = onDeviceChange((newInfo) => {
      const newDimensions = calculateBookDimensions(newInfo);
      setDeviceInfo(newInfo);
      setBookDimensions(newDimensions);
      setScaleRatio(calculateScaleRatio(newDimensions));
    });
    
    return cleanup;
  }, [calculateBookDimensions, calculateScaleRatio]);

  // 重新初始化turn.js（当布局变化时）
  const reinitializeTurnJS = useCallback(
    (
      element: HTMLDivElement | null,
      dimensions: BookDimensions,
      // 翻页完成后的回调（逻辑页码从 1 开始）
      onTurned?: (logicalPage: number) => void,
      // 翻页过程中的回调（逻辑页码从 1 开始）
      onTurning?: (logicalPage: number) => void,
    ) => {
      if (element && dimensions.container.width > 0 && dimensions.container.height > 0) {

        const $element = $(element);
        
        // 如果已经初始化，先销毁
        if ($element.data('turn')) {
          $element.turn('destroy');
        }
        
        // 根据当前模式设置display参数
        const displayMode: 'single' | 'double' = deviceInfo.suggestedBookMode === 'double' ? 'double' : 'single';
        
        // 计算当前的 scaleRatio
        const currentScaleRatio = calculateScaleRatio(dimensions);
        
        // 重新初始化turn.js
        $element.turn({
          autoCenter: true,
          display: displayMode,
          width: 1152,
          height: 720,
          acceleration: true,
          elevation: 50,
          duration: 1000,
          pages: 2,
          zoom: true,
          scaleRatio: currentScaleRatio, // 传递 scaleRatio 给 turn.js，用于坐标计算修正 
          when: {
            turning: function (e, page, view) {
              var book = $(this),
                currentPage = book.turn('page'),
                pages = book.turn('pages');

              // 处理特殊页面边界情况
              if (currentPage > 3 && currentPage < pages - 3) {
                if (page == 1) {
                  book.turn('page', 2).turn('stop').turn('page', page);
                  e.preventDefault();
                  return;
                } else if (page == pages) {
                  book.turn('page', pages - 1).turn('stop').turn('page', page);
                  e.preventDefault();
                  return;
                }
              } else if (page > 3 && page < pages - 3) {
                if (currentPage == 1) {
                  book.turn('page', 2).turn('stop').turn('page', page);
                  e.preventDefault();
                  return;
                } else if (currentPage == pages) {
                  book.turn('page', pages - 1).turn('stop').turn('page', page);
                  e.preventDefault();
                  return;
                }
              }

              // $(this) 在 turn.js 类型定义中为 JQuery<TurnWhen>，这里通过宽泛的 JQuery 类型来兼容
              updateDepth(book as JQuery, page);

              // 同步第 4 页和倒数第 4 页的 fixed 状态：
              // - 当当前视图窗口即将"滑出"这些锚点页时，为它们加 fixed；
              // - 当它们仍在 turn.js 的 DOM 管理范围内时，移除 fixed。
              syncBookmarkFixedPages(book as JQuery<HTMLElement>);

              // 管理固定页面状态
              if (page >= 2) {
                $('.sj-book .p2').addClass('fixed');
              } else {
                $('.sj-book .p2').removeClass('fixed');
              }

              if (page < book.turn('pages')) {
                $('.sj-book .BackCoverTitlePage-1').addClass('fixed');
              } else {
                $('.sj-book .BackCoverTitlePage-1').removeClass('fixed');
              }

              // 在翻页过程中通知上层逻辑进行阈值判断
              if (typeof onTurning === 'function') {
                onTurning(page);
              }
            },
            turned: function (e, page, view) {
              var book = $(this);
              if (page == 2 || page == 3) {
                book.turn('peel', 'br');
              }
              book.turn('center');

              // 在页面翻转完成后通知上层逻辑进行路由同步
              if (typeof onTurned === 'function') {
                onTurned(page);
              }
            }
          }
        });

       
      }
    },
    [deviceInfo.suggestedBookMode, calculateScaleRatio]
  );

  // 更新已初始化书本的缩放比例，用于重新计算四个角的交互坐标
  // 当浏览器窗口变化导致书本缩放后，调用此方法更新坐标计算
  const updateBookScaleRatio = useCallback(
    (element: HTMLDivElement | null, newScaleRatio: number) => {
      if (element && newScaleRatio > 0) {
        const $element = $(element);
        if ($element.turn('is')) {
          $element.turn('updateScaleRatio', newScaleRatio);
        }
      }
    },
    []
  );

  return {
    deviceInfo,
    bookDimensions,
    scaleRatio,
    reinitializeTurnJS,
    updateBookScaleRatio
  };
};