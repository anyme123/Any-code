/**
 * ✅ Thinking Widget - AI 思考过程展示
 *
 * 迁移自 ToolWidgets.tsx (原 2766-2860 行)
 * 用于展示 AI 的思考过程和 Token 使用情况
 */

import React from "react";
import { Brain, Bot, Sparkles } from "lucide-react";
import { useToolTranslation } from "../common/useToolTranslation";

export interface ThinkingWidgetProps {
  /** 思考内容 */
  thinking: string;
  /** 签名（未使用） */
  signature?: string;
  /** Token 使用统计 */
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_tokens?: number;
    cache_read_tokens?: number;
  };
}

/**
 * AI 思考过程 Widget
 *
 * 展示 AI 的思考内容和 Token 使用，支持翻译
 */
export const ThinkingWidget: React.FC<ThinkingWidgetProps> = ({
  thinking,
  usage,
}) => {
  const { translateContent } = useToolTranslation();
  const [translatedThinking, setTranslatedThinking] = React.useState<string>('');

  // 去除空白
  const trimmedThinking = thinking.trim();

  // 判断是否有内容
  const hasContent = trimmedThinking.length > 0;

  // 🆕 #171: 思考输出翻译开关（默认关闭以节省 tokens 与延迟）
  const translateThinkingEnabled = React.useMemo(() => {
    try {
      return localStorage.getItem('translate_thinking_output') === 'true';
    } catch {
      return false;
    }
  }, []);

  // 翻译思考内容（仅在开关启用时）
  React.useEffect(() => {
    if (!translateThinkingEnabled) {
      setTranslatedThinking(trimmedThinking);
      return;
    }
    const translateThinking = async () => {
      if (hasContent) {
        const cacheKey = `thinking-${trimmedThinking.substring(0, 100)}`;
        const translated = await translateContent(trimmedThinking, cacheKey);
        setTranslatedThinking(translated);
      }
    };

    translateThinking();
  }, [trimmedThinking, hasContent, translateContent, translateThinkingEnabled]);

  // 格式化 Token 使用情况
  const formatThinkingTokens = (usage: any) => {
    if (!usage) return null;

    const { input_tokens = 0, output_tokens = 0, cache_creation_tokens = 0, cache_read_tokens = 0 } = usage;
    const parts = [
      { label: "in", value: input_tokens },
      { label: "out", value: output_tokens },
      { label: "creation", value: cache_creation_tokens },
      { label: "read", value: cache_read_tokens },
    ];

    const breakdown = parts
      .map(({ label, value }) => `${value} ${label}`)
      .join(", ");

    return `Tokens: ${breakdown}`;
  };

  // 思考中状态
  if (!hasContent) {
    return (
      <div className="rounded-lg border border-muted-foreground/20 bg-muted/30 overflow-hidden">
        <div className="px-4 py-3 flex items-center gap-2">
          <div className="relative">
            <Bot className="h-4 w-4 text-muted-foreground" />
            <Sparkles className="h-2.5 w-2.5 text-muted-foreground/70 absolute -top-1 -right-1 animate-pulse" />
          </div>
          <span className="text-sm font-medium italic text-muted-foreground">
            思考中...
          </span>
        </div>
      </div>
    );
  }

  // 有内容时展示思考结果
  const displayContent = translatedThinking || trimmedThinking;

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <span className="text-sm font-medium text-amber-700 dark:text-amber-300">思考过程</span>
          </div>

          {/* Token 使用展示 */}
          {usage && (
            <div className="text-xs text-amber-600/80 dark:text-amber-400/80">
              {formatThinkingTokens(usage)}
            </div>
          )}
        </div>

        <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap bg-muted/30 p-3 rounded-lg italic leading-relaxed">
          {displayContent}
        </pre>
      </div>
    </div>
  );
};
