import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;
const rootDir = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

function isPackage(id: string, packageName: string) {
  return id.replaceAll("\\", "/").includes(`/node_modules/${packageName}/`);
}

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  // Path resolution
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "./src"),
    },
  },

  worker: {
    format: "es",
  },

  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  // Build configuration for code splitting and optimization
  build: {
    chunkSizeWarningLimit: 2500,
    minify: "esbuild",
    target: "es2020",
    cssMinify: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }
          if (isPackage(id, "@uiw/react-md-editor")) {
            return "editor-vendor";
          }
          if (isPackage(id, "react-syntax-highlighter")) {
            return "syntax-vendor";
          }
          if (isPackage(id, "react-markdown") || isPackage(id, "remark-gfm")) {
            return "markdown-vendor";
          }
          if (isPackage(id, "@anthropic-ai/sdk")) {
            return "ai-sdk-vendor";
          }
          if (isPackage(id, "@dnd-kit/core") || isPackage(id, "@dnd-kit/sortable")) {
            return "dnd-vendor";
          }
          if (isPackage(id, "react") || isPackage(id, "react-dom") || isPackage(id, "scheduler")) {
            return "react-vendor";
          }
          if (
            isPackage(id, "@radix-ui/react-dialog") ||
            isPackage(id, "@radix-ui/react-dropdown-menu") ||
            isPackage(id, "@radix-ui/react-select") ||
            isPackage(id, "@radix-ui/react-tabs") ||
            isPackage(id, "@radix-ui/react-tooltip") ||
            isPackage(id, "@radix-ui/react-switch") ||
            isPackage(id, "@radix-ui/react-popover") ||
            isPackage(id, "lucide-react") ||
            isPackage(id, "framer-motion")
          ) {
            return "ui-vendor";
          }
          if (isPackage(id, "@tauri-apps/api") || id.includes("/node_modules/@tauri-apps/plugin-")) {
            return "tauri-vendor";
          }
          if (isPackage(id, "i18next") || isPackage(id, "react-i18next")) {
            return "i18n-vendor";
          }
          return "vendor";
        },
      },
    },
  },
}));
