import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { isSessionWindow } from "./lib/windowManager";

const SessionWindow = React.lazy(() => import("./pages/SessionWindow"));

function renderBootstrapFallback(error: unknown) {
  const root = document.getElementById("root");
  if (!root) {
    console.error("[bootstrap] Root element is missing:", error);
    return;
  }

  const errorMessage = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <div className="h-screen w-screen bg-background text-foreground p-8 font-mono overflow-auto">
        <h1 className="text-lg font-semibold text-destructive mb-3">Application Startup Error</h1>
        <p className="text-sm text-muted-foreground mb-4">应用初始化失败，请重载后重试。</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="px-4 py-2 rounded-md border bg-muted hover:bg-muted/80 mb-4"
        >
          Reload
        </button>
        <pre className="text-xs whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-destructive">
          {errorMessage}
        </pre>
      </div>
    </React.StrictMode>,
  );
}

function resolveRootElement() {
  const root = document.getElementById("root");
  if (!(root instanceof HTMLElement)) {
    throw new Error("Bootstrap root element #root is missing");
  }
  return root;
}

async function initializeDeferredServices() {
  try {
    const { initializeToolRegistry } = await import("./lib/toolRegistryInit");
    initializeToolRegistry();
  } catch (error) {
    console.error("[bootstrap] ToolRegistry initialization failed:", error);
  }
}

async function showMainWindow() {
  try {
    const currentWindow = getCurrentWindow();
    await currentWindow.show();
    await currentWindow.setFocus();
  } catch (error) {
    console.error("[bootstrap] Failed to show window:", error);
  }
}

function SessionWindowFallback() {
  return (
    <div className="h-screen w-screen flex items-center justify-center bg-background">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  );
}

function AppShell() {
  if (isSessionWindow()) {
    return (
      <ErrorBoundary>
        <ThemeProvider>
          <React.Suspense fallback={<SessionWindowFallback />}>
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
}

async function bootstrap() {
  const root = resolveRootElement();
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <AppShell />
    </React.StrictMode>,
  );

  queueMicrotask(() => {
    void initializeDeferredServices();
  });

  window.setTimeout(() => {
    void showMainWindow();
  }, 50);
}

export async function startApp() {
  try {
    await bootstrap();
  } catch (error) {
    console.error("[bootstrap] Startup failed:", error);
    renderBootstrapFallback(error);
  }
}
