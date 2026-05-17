/**
 * ✅ Write Widget - 文件写入展示
 *
 * 迁移并拆分自 ToolWidgets.tsx (原 788-1037 行)
 * 主组件 (~120行) + CodePreview (~90行) + FullScreenPreview (~140行)
 */

import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { FilePlus, ExternalLink, ChevronUp, ChevronDown, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { getLanguage } from "../common/languageDetector";
import { CodePreview } from "./components/CodePreview";
import { FullScreenPreview } from "./components/FullScreenPreview";

export interface WriteWidgetProps {
  /** 文件路径 */
  filePath: string;
  /** 文件内容 */
  content: string;
  /** 工具结果 */
  result?: any;
  /** 是否正在流式输出 */
  isStreaming?: boolean;
}

/**
 * 文件写入 Widget
 *
 * Features:
 * - 代码预览（可折叠）
 * - 全屏查看模式
 * - 文件大小显示
 * - 系统打开文件
 * - Markdown 特殊渲染
 */
export const WriteWidget: React.FC<WriteWidgetProps> = ({
  filePath,
  content,
  result: _result,
  isStreaming = false,
}) => {
  const { t } = useTranslation();
  const [isMaximized, setIsMaximized] = useState(false);
  // 流式输出时默认展开，否则默认收起
  const [isExpanded, setIsExpanded] = useState(isStreaming);
  // 跟踪前一个 isStreaming 状态，用于检测状态变化
  const prevIsStreamingRef = useRef(isStreaming);

  // 当流式输出状态变化时自动展开/折叠
  useEffect(() => {
    const wasStreaming = prevIsStreamingRef.current;
    prevIsStreamingRef.current = isStreaming;

    if (isStreaming && !wasStreaming) {
      // 流式输出开始时自动展开
      setIsExpanded(true);
    } else if (!isStreaming && wasStreaming) {
      // 流式输出结束时自动折叠
      setIsExpanded(false);
    }
  }, [isStreaming]);

  const language = getLanguage(filePath);

  // Markdown 文件和小文件不截断，其他大文件截断到 5000 字符
  const isMarkdown = filePath.toLowerCase().endsWith('.md');
  const truncateLimit = isMarkdown ? 10000 : 5000;  // .md 文件限制更高
  const isLargeContent = content.length > truncateLimit;
  const displayContent = isLargeContent ? content.substring(0, truncateLimit) + "\n..." : content;

  /**
   * 在系统中打开文件
   */
  const handleOpenInSystem = async () => {
    try {
      const editor = (typeof localStorage !== 'undefined' && localStorage.getItem('preferred_editor')) || 'auto';
      await api.openPathInEditor(filePath, undefined, undefined, editor);
    } catch (error) {
      console.error('Failed to open file in editor:', error);
      try {
        await api.openFileWithDefaultApp(filePath);
      } catch (fallbackError) {
        console.error('Failed to open file with system default:', fallbackError);
      }
    }
  };

  // 判断是否有结果（文件是否已成功写入）
  const hasResult = _result !== undefined;
  const isSuccess = hasResult && !_result?.is_error;

  return (
    <>
      <div className="space-y-2 w-full">
        <div className="ml-1 space-y-2">
          {/* 文件路径和展开按钮 - 可点击区域扩展到整行 */}
          <div
            className="flex items-center justify-between bg-muted/30 p-2.5 rounded-md border border-border/50 cursor-pointer hover:bg-muted/50 transition-colors group/header select-none"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <FilePlus className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                <span className="text-sm font-medium text-muted-foreground">Write</span>
                <span className="text-muted-foreground/30">|</span>
                <code className="text-sm font-mono text-foreground/90 truncate font-medium" title={filePath}>
                  {filePath.split(/[/\\]/).pop()}
                </code>
                <span className="text-xs text-muted-foreground truncate hidden sm:inline-block max-w-[200px] opacity-70">
                  {filePath}
                </span>
              </div>

              {/* File Size & Status */}
              <div className="flex items-center gap-3 text-xs font-mono font-medium">
                <span className="text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                  {(content.length / 1024).toFixed(1)} KB
                </span>

                {/* Status Badge */}
                <div className="flex items-center gap-1">
                  {hasResult ? (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                      <span className={cn("font-medium hidden sm:inline", isSuccess ? "text-green-500" : "text-red-500")}>
                        {isSuccess ? t('widget.success') : t('widget.failed')}
                      </span>
                    </>
                  ) : (
                    <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />
                  )}
                </div>
              </div>
            </div>

            {/* 展开/收起按钮 & 打开按钮 */}
            <div className="flex items-center gap-2 ml-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenInSystem();
                }}
                title={t('widget.openWithDefault')}
              >
                <ExternalLink className="h-3 w-3 mr-1" />
                {t('widget.open')}
              </Button>
              <div className="h-6 px-2 text-muted-foreground group-hover/header:text-foreground flex items-center gap-1 transition-colors">
                {isExpanded ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </div>
            </div>
          </div>

          {/* 代码预览（流式时展开） */}
          {isExpanded && (
            <CodePreview
              codeContent={displayContent}
              language={language}
              truncated={isLargeContent}
              truncateLimit={truncateLimit}
              onMaximize={() => setIsMaximized(true)}
              isStreaming={isStreaming}
            />
          )}
        </div>
      </div>

      {/* 全屏预览 */}
      <FullScreenPreview
        isOpen={isMaximized}
        onClose={() => setIsMaximized(false)}
        filePath={filePath}
        content={content}
        language={language}
        isMarkdown={isMarkdown}
        onOpenInSystem={handleOpenInSystem}
      />
    </>
  );
};
