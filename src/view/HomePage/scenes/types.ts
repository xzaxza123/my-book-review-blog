import type React from 'react';

export interface HomeSceneProps {
  isDark: boolean;
  showHints: boolean;
  onBookClick: (event?: React.MouseEvent<HTMLButtonElement>) => void;
  onThemeToggle: () => void;
}

