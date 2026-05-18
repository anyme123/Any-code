import React, { memo, useMemo } from "react";
import { ClaudeIcon } from "@/components/icons/ClaudeIcon";
import { CodexIcon } from "@/components/icons/CodexIcon";
import { GeminiIcon } from "@/components/icons/GeminiIcon";
import { MessageBubble } from "./MessageBubble";
import { MessageContent } from "./MessageContent";
import { ToolCallsGroup } from "./ToolCallsGroup";
import { ThinkingBlock } from "./ThinkingBlock";
import { MessageActions } from "./MessageActions";
import { cn } from "@/lib/utils";
import { tokenExtractor } from "@/lib/tokenExtractor";
import { formatTimestamp } from "@/lib/messageUtils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { ClaudeStreamMessage } from '@/types/claude';

interface AIMessageProps {
  message: ClaudeStreamMessage;
  isStreaming?: boolean;
  className?: string;
  onLinkDetected?: (url: string) => void;
}

type ContentSegment =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tools'; tools: any[] };

/**
 * 按 content 数组原始顺序构建段落，合并连续同类型块。
 * 实现 Anthropic Interleaved Thinking 语义：思考可与文本、工具调用交错出现。
 */
const buildSegments = (content: any): ContentSegment[] => {
  if (typeof content === 'string') {
    return content.trim() ? [{ kind: 'text', text: content }] : [];
  }
  if (!Array.isArray(content)) return [];

  const segments: ContentSegment[] = [];
  for (const item of content) {
    if (!item) continue;
    const last = segments[segments.length - 1];

    if (item.type === 'text') {
      const t = item.text || '';
      if (!t.trim()) continue;
      if (last?.kind === 'text') {
        last.text = `${last.text}\n\n${t}`;
      } else {
        segments.push({ kind: 'text', text: t });
      }
    } else if (item.type === 'thinking') {
      const t = item.thinking || '';
      if (!t.trim()) continue;
      if (last?.kind === 'thinking') {
        last.text = `${last.text}\n\n---divider---\n\n${t}`;
      } else {
        segments.push({ kind: 'thinking', text: t });
      }
    } else if (item.type === 'tool_use') {
      if (last?.kind === 'tools') {
        last.tools.push(item);
      } else {
        segments.push({ kind: 'tools', tools: [item] });
      }
    }
  }
  return segments;
};

const collectText = (segments: ContentSegment[]): string =>
  segments
    .filter((s): s is { kind: 'text'; text: string } => s.kind === 'text')
    .map(s => s.text)
    .join('\n\n');

const AIMessageComponent: React.FC<AIMessageProps> = ({
  message,
  isStreaming = false,
  className,
  onLinkDetected
}) => {
  const segments = useMemo(
    () => buildSegments(message.message?.content),
    [message.message?.content]
  );
  const allText = useMemo(() => collectText(segments), [segments]);

  const isCodexMessage = (message as any).engine === 'codex';
  const isGeminiMessage =
    (message as any).geminiMetadata?.provider === 'gemini' ||
    (message as any).engine === 'gemini';

  if (segments.length === 0) return null;

  const lastIdx = segments.length - 1;
  const enableTypewriter = isStreaming;

  const tokenStats = message.message?.usage
    ? (() => {
        const extractedTokens = tokenExtractor.extract({
          type: 'assistant',
          message: { usage: message.message.usage }
        });
        const parts = [`${extractedTokens.input_tokens}/${extractedTokens.output_tokens}`];
        if (extractedTokens.cache_creation_tokens > 0) {
          parts.push(`创建${extractedTokens.cache_creation_tokens}`);
        }
        if (extractedTokens.cache_read_tokens > 0) {
          parts.push(`缓存${extractedTokens.cache_read_tokens}`);
        }
        return parts.join(' | ');
      })()
    : null;

  const assistantName = isGeminiMessage ? 'Gemini' : isCodexMessage ? 'Codex' : 'Claude';
  const Icon = isGeminiMessage ? GeminiIcon : isCodexMessage ? CodexIcon : ClaudeIcon;

  const formattedTime = formatTimestamp((message as any).receivedAt ?? (message as any).timestamp);
  const tooltipParts: string[] = [];
  if (formattedTime) tooltipParts.push(formattedTime);
  if (tokenStats) tooltipParts.push(tokenStats);

  return (
    <div className={cn("relative group", className)}>
      <MessageBubble variant="assistant">
        <div className="flex gap-2.5 items-start">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex-shrink-0 mt-0.5 select-none cursor-default">
                  <div className="flex items-center justify-center w-6 h-6 rounded-md hover:bg-muted/50 transition-colors">
                    <Icon className={cn(isGeminiMessage || isCodexMessage ? "w-3.5 h-3.5" : "w-4 h-4")} />
                  </div>
                </div>
              </TooltipTrigger>
              {tooltipParts.length > 0 && (
                <TooltipContent side="right" className="text-[11px]">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">{assistantName}</span>
                    {formattedTime && <span className="text-muted-foreground">{formattedTime}</span>}
                    {tokenStats && <span className="font-mono text-muted-foreground">{tokenStats}</span>}
                  </div>
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>

          <div className="flex-1 min-w-0 relative">
            <div className="absolute -top-2 right-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
              <MessageActions content={allText} />
            </div>

            <div className="space-y-1.5">
              {segments.map((segment, idx) => {
                const segmentStreaming = enableTypewriter && idx === lastIdx;

                if (segment.kind === 'text') {
                  return (
                    <div
                      key={`text-${idx}`}
                      className="prose prose-neutral dark:prose-invert max-w-none leading-relaxed text-[14.5px] break-words"
                      style={{ overflowWrap: 'anywhere' }}
                    >
                      <MessageContent
                        content={segment.text}
                        isStreaming={segmentStreaming}
                        enableTypewriter={segmentStreaming}
                      />
                    </div>
                  );
                }

                if (segment.kind === 'thinking') {
                  return (
                    <ThinkingBlock
                      key={`thinking-${idx}`}
                      content={segment.text}
                      isStreaming={segmentStreaming}
                      autoCollapseDelay={2500}
                    />
                  );
                }

                if (segment.kind === 'tools') {
                  const synthetic: ClaudeStreamMessage = {
                    ...message,
                    message: {
                      ...message.message,
                      content: segment.tools,
                    },
                  };
                  return (
                    <ToolCallsGroup
                      key={`tools-${idx}`}
                      message={synthetic}
                      onLinkDetected={onLinkDetected}
                    />
                  );
                }
                return null;
              })}
            </div>
          </div>
        </div>
      </MessageBubble>
    </div>
  );
};

AIMessageComponent.displayName = "AIMessage";

export const AIMessage = memo(AIMessageComponent, (prev, next) => {
  return (
    prev.message === next.message &&
    prev.isStreaming === next.isStreaming &&
    prev.className === next.className &&
    prev.onLinkDetected === next.onLinkDetected
  );
});
