/**
 * 设备检测工具函数
 * 用于获取设备类型、方向、窗口尺寸等信息
 */

export interface DeviceInfo {
  // 设备类型
  deviceType: 'desktop' | 'tablet' | 'mobile';
  // 设备方向
  orientation: 'landscape' | 'portrait';
  // 窗口宽度
  width: number;
  // 窗口高度
  height: number;
  // 是否是触摸设备
  isTouchDevice: boolean;
  // 像素比
  pixelRatio: number;
  // 建议的书本显示模式
  suggestedBookMode: 'single' | 'double';
  // 建议的书本尺寸比例 (0-1)
  suggestedBookRatio: number;
}

/**
 * 检测设备类型
 * desktop-PC设备
 * tablet-平板设备
 * mobile-移动设备
 */
const detectDeviceType = (): 'desktop' | 'tablet' | 'mobile' => {
  const width = window.innerWidth;
  const userAgent = navigator.userAgent.toLowerCase();
  
  // 移动设备检测
  const isMobile = /iphone|ipod|android|blackberry|windows phone/g.test(userAgent);
  const isTablet = /ipad|android|tablet|playbook|silk/g.test(userAgent) && !isMobile;
  
  if (isMobile) return 'mobile';
  if (isTablet) return 'tablet';
  
  // 桌面设备，根据宽度进一步区分
  if (width >= 1200) return 'desktop';
  if (width >= 768) return 'tablet';
  return 'mobile';
};

/**
 * 检测设备方向
 */
const detectOrientation = (): 'landscape' | 'portrait' => {
  return window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';
};

/**
 * 检测是否是触摸设备
 */
const detectTouchDevice = (): boolean => {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
};

/**
 * 计算建议的书本显示模式和尺寸比例
 */
const calculateBookSettings = (
  orientation: string,
  width: number,
  height: number
): { mode: 'single' | 'double'; ratio: number } => {
  
  const aspectRatio = width / height;
  
  // 横向的PC端浏览器或平板设备，且宽高比适合双页显示
  if (orientation === 'landscape' && aspectRatio >= 0.9) {
    // 根据窗口大小动态计算比例 (60%-80%)
    const baseRatio = 0.6;
    const maxRatio = 0.8;
    const scaleFactor = Math.min(1, width / 1920); // 基于1920px宽度进行缩放
    const ratio = baseRatio + (maxRatio - baseRatio) * scaleFactor;
    
    return { mode: 'double', ratio };
  }
  
  // 其他情况使用单页模式，占据100%宽度
  return { mode: 'single', ratio: 1 };
};

/**
 * 获取设备信息
 */
export const getDeviceInfo = (): DeviceInfo => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const deviceType = detectDeviceType();
  const orientation = detectOrientation();
  const isTouchDevice = detectTouchDevice();
  
  const { mode, ratio } = calculateBookSettings(orientation, width, height);
  
  return {
    deviceType,
    orientation,
    width,
    height,
    isTouchDevice,
    pixelRatio: window.devicePixelRatio || 1,
    suggestedBookMode: mode,
    suggestedBookRatio: ratio
  };
};

/**
 * 监听设备变化
 */
export const onDeviceChange = (callback: (info: DeviceInfo) => void) => {
  const handleResize = () => {
    callback(getDeviceInfo());
  };
  
  // 监听窗口大小变化
  window.addEventListener('resize', handleResize);
  
  // 监听设备方向变化（移动设备）
  if (window.screen.orientation) {
    window.screen.orientation.addEventListener('change', handleResize);
  } else if ('onorientationchange' in window) {
    window.addEventListener('orientationchange', handleResize);
  }
  
  // 返回清理函数
  return () => {
    window.removeEventListener('resize', handleResize);
    if (window.screen.orientation) {
      window.screen.orientation.removeEventListener('change', handleResize);
    } else if ('onorientationchange' in window) {
      window.removeEventListener('orientationchange', handleResize);
    }
  };
};