import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import "./assets/shimmer.css";
import "./styles.css";
import "./i18n"; // ✅ i18n 必须同步加载（App 立即需要使用）
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isSessionWindow } from "./lib/windowManager";

// ⚡ 优化：只异步加载 toolRegistry（可以延迟）
// import { initializeToolRegistry } from "./lib/toolRegistryInit"; // ❌ 改为异步

// 🆕 懒加载 SessionWindow 组件（仅在需要时加载）
const SessionWindow = React.lazy(() => import('./pages/SessionWindow'));

// 防止窗口闪烁的React包装组件
const AppWrapper: React.FC = () => {
  // 🆕 检测是否为独立会话窗口
  const isDetachedWindow = isSessionWindow();

  React.useEffect(() => {
    // ⚡ 性能优化：异步加载 toolRegistry（可以延迟，不阻塞 UI）
    const initializeToolRegistry = async () => {
      try {
        const { initializeToolRegistry: init } = await import('./lib/toolRegistryInit');
        init();
      } catch (error) {
        console.error('[AppWrapper] ToolRegistry initialization failed:', error);
      }
    };

    // 在React应用完全挂载后显示窗口
    const showWindow = async () => {
      try {
        const window = getCurrentWindow();
        await window.show();
        await window.setFocus();
      } catch (error) {
        console.error('Failed to show window:', error);
      }
    };

    // 后台异步初始化 toolRegistry（不阻塞）
    initializeToolRegistry();

    // 初始化桌面通知权限
    import('./lib/notificationService').then(({ initNotification }) => {
      initNotification();
    }).catch(() => {});

    // 立即显示窗口（生产模式已优化，不需要长延迟）
    const timer = setTimeout(showWindow, 50);
    return () => clearTimeout(timer);
  }, []);

  // 🆕 根据窗口类型渲染不同的组件
  if (isDetachedWindow) {
    return (
      <ErrorBoundary>
        <ThemeProvider>
          <React.Suspense
            fallback={
              <div className="h-screen w-screen flex items-center justify-center bg-background">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            }
          >
            <SessionWindow />
          </React.Suspense>
        </ThemeProvider>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </ErrorBoundary>
  );
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppWrapper />
  </React.StrictMode>,
);
