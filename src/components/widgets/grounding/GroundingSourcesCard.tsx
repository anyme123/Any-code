/**
 * 🌐 Gemini Grounding 来源卡片
 *
 * 渲染 Gemini Google Search 的检索来源（标题 + favicon + 摘要）。
 * 数据由 geminiConverter 通过 message.groundingSources 注入，
 * 由 StreamMessageV2 在文本下方追加渲染。
 */

import React, { memo } from "react";
import { Globe2, ExternalLink } from "lucide-react";

export interface GroundingSource {
  /** 来源标题 */
  title: string;
  /** 来源 URL */
  uri: string;
  /** 关联文本片段，可选 */
  snippet?: string;
}

interface GroundingSourcesCardProps {
  /** 来源列表 */
  sources: GroundingSource[];
  /** 自定义 className */
  className?: string;
}

/**
 * 安全提取域名，失败返回 uri 本身
 */
function safeHost(uri: string): string {
  try {
    return new URL(uri).hostname;
  } catch {
    return uri;
  }
}

/**
 * 在系统浏览器中打开 URL
 *
 * 优先使用 Tauri 的 shell.open；失败兜底 window.open。
 * 动态 import 避免在非 Tauri 环境（测试 / Web）下报错。
 */
async function openExternal(url: string): Promise<void> {
  try {
    const mod = await import("@tauri-apps/plugin-shell");
    await mod.open(url);
  } catch {
    // 兜底：浏览器环境
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

const GroundingSourcesCardComponent: React.FC<GroundingSourcesCardProps> = ({
  sources,
  className,
}) => {
  if (!sources || sources.length === 0) return null;

  return (
    <div
      className={
        "mt-2 rounded-md border border-blue-500/20 bg-blue-500/5 p-2 " +
        (className || "")
      }
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 px-1 pb-1.5 text-[11px] font-medium text-blue-700 dark:text-blue-300 select-none">
        <Globe2 className="w-3.5 h-3.5 opacity-70" />
        <span>Google 搜索来源</span>
        <span className="text-[10px] opacity-60">· 共 {sources.length} 条</span>
      </div>

      {/* List */}
      <ul className="flex flex-col gap-1">
        {sources.map((s, idx) => {
          const host = safeHost(s.uri);
          const favicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(
            host
          )}&sz=32`;
          return (
            <li key={idx}>
              <button
                type="button"
                onClick={() => openExternal(s.uri)}
                className="group w-full flex items-start gap-2 rounded px-1.5 py-1 text-left hover:bg-blue-500/10 transition-colors"
                title={s.uri}
              >
                {/* favicon */}
                <img
                  src={favicon}
                  alt=""
                  width={16}
                  height={16}
                  className="mt-0.5 rounded-sm shrink-0 opacity-90"
                  onError={(e) => {
                    // favicon 加载失败时隐藏，避免破图
                    (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                  }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1 text-xs text-foreground/90 truncate">
                    <span className="truncate font-medium">{s.title}</span>
                    <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-60 shrink-0" />
                  </div>
                  <div className="text-[10px] text-muted-foreground/70 truncate">
                    {host}
                  </div>
                  {s.snippet && (
                    <div className="mt-0.5 text-[11px] text-muted-foreground/80 line-clamp-2">
                      {s.snippet}
                    </div>
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export const GroundingSourcesCard = memo(GroundingSourcesCardComponent);

export default GroundingSourcesCard;
