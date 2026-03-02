import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { router } from './router/routers.js';
import { ThemeProvider } from './features/themes/ThemeContext';
import './index.css';

createRoot(document.getElementById('root')).render(
  // <StrictMode>
  // </StrictMode>
  <ThemeProvider>
    <RouterProvider router={router} />
  </ThemeProvider>
);
