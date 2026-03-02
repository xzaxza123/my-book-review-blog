import React, { useEffect, useState } from 'react';
import './index.scss';

interface SinglePageModeNoticeProps {
  /** 是否显示提示 */
  visible: boolean;
  /** 关闭提示的回调 */
  onClose: () => void;
  /** 自动关闭时间（毫秒），默认 1500ms */
  autoCloseDelay?: number;
}

/**
 * 单页模式提示组件
 * 当用户处于单页模式时显示提示信息
 */
export function SinglePageModeNotice({
  visible,
  onClose,
  autoCloseDelay = 1500,
}: SinglePageModeNoticeProps) {
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (visible) {
      setIsAnimating(true);
      const timer = setTimeout(() => {
        setIsAnimating(false);
        onClose();
      }, autoCloseDelay);

      return () => {
        clearTimeout(timer);
      };
    } else {
      setIsAnimating(false);
    }
  }, [visible, autoCloseDelay, onClose]);

  if (!visible && !isAnimating) {
    return null;
  }

  return (
    <div className={`SinglePageModeNotice ${visible ? 'is-visible' : ''}`}>
      <div className="SinglePageModeNotice__content">
        <div className="SinglePageModeNotice__icon">⚠️</div>
        <div className="SinglePageModeNotice__text">
          <div className="SinglePageModeNotice__title">当前内容未开发完成</div>
          <div className="SinglePageModeNotice__message">请稍后，再试</div>
        </div>
      </div>
    </div>
  );
}

