import React, { useImperativeHandle, forwardRef, useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { StreamMessageV2 } from "@/components/message";
import type { MessageGroup } from "@/lib/subagentGrouping";
import { useSession } from "@/contexts/SessionContext";
import { CliProcessingIndicator } from "./CliProcessingIndicator";

/**
 * MeasurableItem: 虚拟列表项的高度测量包装
 *
 * 设计参考 VSCode notebook / Linear / Cursor：
 * - 使用 ResizeObserver 监听高度变化
 * - 阈值提高到 8px，过滤亚像素抖动与字体渲染微差
 * - 流式期间 120ms 节流；非流式 16ms（一帧）合并
 * - rAF 合并测量，避免一次交互内多次同步 measureElement → totalSize 跳变
 * - contain: layout style 限制重排范围，防止子内容回流污染父级
 */
const MeasurableItem = ({ virtualItem, measureElement, isStreaming, children, style, className, ...props }: any) => {
  const elRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef(measureElement);
  measureRef.current = measureElement;

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;

    measureRef.current(el);

    let frameId = 0;
    let throttleTimer: ReturnType<typeof setTimeout> | undefined;
    let pending = false;
    let lastHeight = el.getBoundingClientRect().height;

    const flush = () => {
      pending = false;
      throttleTimer = undefined;
      if (frameId) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        frameId = 0;
        if (elRef.current) measureRef.current(elRef.current);
      });
    };

    const observer = new ResizeObserver((entries) => {
      const newHeight = entries[0]?.contentRect.height ?? 0;
      // 阈值 8px：避免字体渲染、滚动条等亚像素抖动触发 totalSize 跳变
      if (Math.abs(newHeight - lastHeight) < 8) return;
      lastHeight = newHeight;

      if (pending) return;
      pending = true;

      // 流式期间使用更长节流；非流式合并到下一帧
      const delay = isStreaming ? 120 : 16;
      throttleTimer = setTimeout(flush, delay);
    });

    observer.observe(el);

    return () => {
      observer.disconnect();
      if (frameId) cancelAnimationFrame(frameId);
      if (throttleTimer) clearTimeout(throttleTimer);
    };
  }, [isStreaming]);

  return (
    <div
      {...props}
      ref={elRef}
      data-index={virtualItem.index}
      className={className}
      style={{
        ...style,
        contain: 'layout style',
      }}
    >
      {children}
    </div>
  );
};

export interface SessionMessagesRef {
  scrollToPrompt: (promptIndex: number) => void;
  /** 滚动到底部（使用虚拟列表的 scrollToIndex，解决消息过多时滚动不到底的问题） */
  scrollToBottom: () => void;
}

/**
 * ✅ 架构优化: 简化 Props 接口，移除可从 SessionContext 获取的数据
 *
 * 优化前: 10+ 个 props，包含配置、回调和会话数据
 * 优化后: 只保留核心渲染相关的 props
 *
 * 从 SessionContext 获取:
 * - claudeSettings → settings
 * - effectiveSession → session, sessionId, projectId, projectPath
 * - handleLinkDetected → onLinkDetected
 * - handleRevert → onRevert
 * - getPromptIndexForMessage → getPromptIndexForMessage
 */
interface SessionMessagesProps {
  messageGroups: MessageGroup[];
  isLoading: boolean;
  error?: string | null;
  parentRef: React.RefObject<HTMLDivElement>;
  /** 取消执行回调 - 用于CLI风格处理指示器 */
  onCancel?: () => void;
}

export const SessionMessages = forwardRef<SessionMessagesRef, SessionMessagesProps>(({
  messageGroups,
  isLoading,
  error,
  parentRef,
  onCancel
}, ref) => {
  // ✅ 从 SessionContext 获取配置和回调，避免 Props Drilling
  const { settings, sessionId, projectId, projectPath, onLinkDetected, onRevert, getPromptIndexForMessage } = useSession();
  /**
   * ✅ OPTIMIZED: Virtual list configuration for improved performance
   */
  const rowVirtualizer = useVirtualizer({
    count: messageGroups.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      // ✅ Dynamic height estimation based on message group type
      const messageGroup = messageGroups[index];
      if (!messageGroup) return 200;

      // For subagent groups, estimate larger height
      if (messageGroup.type === 'subagent') {
        return 400; // Subagent groups are typically larger
      }

      // For aggregated groups, estimate height based on content
      if (messageGroup.type === 'aggregated') {
        // Base height for bubble padding etc
        let height = 60;
        messageGroup.messages.forEach(msg => {
            // Add height for thinking blocks
            if (msg.type === 'thinking' || (msg.message?.content && Array.isArray(msg.message.content) && msg.message.content.some((c:any) => c.type === 'thinking'))) {
                height += 100;
            }
            // Add height for tool calls
            if (msg.message?.content && Array.isArray(msg.message.content)) {
                const toolCalls = msg.message.content.filter((c:any) => c.type === 'tool_use');
                height += toolCalls.length * 60;
                
                // Add height for tool results (if visible)
                const toolResults = msg.message.content.filter((c:any) => c.type === 'tool_result');
                height += toolResults.length * 40;
            }
        });
        return Math.max(height, 100);
      }

      // For normal messages, estimate based on message type
      const message = messageGroup.message;
      if (!message) return 200;

      // Estimate different heights for different message types
      if (message.type === 'system') return 80;  // System messages are smaller
      if (message.type === 'user') return 150;   // User prompts are medium
      if (message.type === 'assistant') {
        // Assistant messages with code blocks are larger
        const hasCodeBlock = message.content && typeof message.content === 'string' &&
                            message.content.includes('```');
        return hasCodeBlock ? 300 : 200;
      }
      return 200; // Default fallback
    },
    overscan: 8, // 减少 overscan 降低 DOM 节点数，移除动画后不再需要过多缓冲
    measureElement: (element) => {
      // Ensure element is fully rendered before measurement
      return element?.getBoundingClientRect().height ?? 200;
    },
  });

  useImperativeHandle(ref, () => ({
    scrollToBottom: () => {
      if (messageGroups.length === 0) return;

      rowVirtualizer.scrollToIndex(messageGroups.length - 1, {
        align: 'end',
        behavior: 'auto',
      });

      // 单次 rAF 修正即可，避免多次修正与用户交互冲突
      requestAnimationFrame(() => {
        if (!parentRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = parentRef.current;
        if (scrollHeight - scrollTop - clientHeight > 1) {
          parentRef.current.scrollTop = scrollHeight - clientHeight;
        }
      });
    },
    scrollToPrompt: (promptIndex: number) => {
      // Find the targetGroupIndex for the given promptIndex.
      // Uses getPromptIndexForMessage to ensure counting logic matches backend
      // (excludes warmup/skill/sidechain/tool-result-only non-real user inputs)
      let targetGroupIndex = -1;

      for (let i = 0; i < messageGroups.length; i++) {
        const group = messageGroups[i];

        // Only check normal-type user messages
        if (group.type === 'normal' && group.message.type === 'user') {
          if (getPromptIndexForMessage) {
            const msgPromptIndex = getPromptIndexForMessage(group.index);
            if (msgPromptIndex === promptIndex) {
              targetGroupIndex = i;
              break;
            }
          }
        }
      }

      if (targetGroupIndex === -1) {
        console.warn(`[Prompt Navigation] Prompt #${promptIndex} not found in ${messageGroups.length} groups`);
        return;
      }

      // Step 1: Use 'auto' (instant) behavior so the virtualizer immediately
      // renders items near the target area, instead of 'smooth' which delays
      // rendering until the scroll animation reaches the target viewport
      rowVirtualizer.scrollToIndex(targetGroupIndex, {
        align: 'center',
        behavior: 'auto',
      });

      // Step 2: Robust element finding with rAF + retry mechanism.
      // The virtualizer needs time to measure and render the target row
      // after the scroll position changes.
      let attempts = 0;
      const maxAttempts = 10;
      const pollInterval = 100; // ms between retries, total ~1s max wait

      const tryFindAndHighlight = () => {
        attempts++;
        const element = document.getElementById(`prompt-${promptIndex}`);

        if (element) {
          // Element found - use rAF to schedule scrollIntoView after
          // the virtualizer finishes its current layout pass
          requestAnimationFrame(() => {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Visual feedback: brief highlight flash to help user identify target
            try {
              element.animate(
                [
                  { boxShadow: '0 0 0 3px rgba(59, 130, 246, 0.6)' },
                  { boxShadow: '0 0 0 3px rgba(59, 130, 246, 0)' },
                ],
                { duration: 1500, easing: 'ease-out' }
              );
            } catch {
              // Web Animations API not available - silently ignore
            }
          });
          return;
        }

        if (attempts < maxAttempts) {
          // Re-trigger scrollToIndex every 3 attempts to nudge the virtualizer
          // in case it hasn't rendered the target row yet
          if (attempts % 3 === 0) {
            rowVirtualizer.scrollToIndex(targetGroupIndex, {
              align: 'center',
              behavior: 'auto',
            });
          }
          setTimeout(tryFindAndHighlight, pollInterval);
        } else {
          console.warn(`[Prompt Navigation] Element #prompt-${promptIndex} not found after ${maxAttempts} attempts`);
        }
      };

      // Wait for two animation frames to let the virtualizer process
      // the scroll and render the target area before searching for the element
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          tryFindAndHighlight();
        });
      });
    }
  }));

  return (
    // ✅ 重构布局: 移除固定 paddingBottom，因为输入框不再使用 fixed 定位
    // 消息区域现在是 Flex 容器的一部分，自然与输入区域分离
    <div
      ref={parentRef}
      className="flex-1 overflow-y-auto relative"
      style={{
        paddingTop: '8px',
        paddingBottom: '16px',
        overscrollBehavior: 'contain',
        overflowAnchor: 'none',
        contain: 'strict',
        willChange: 'scroll-position',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      <div
        className="relative w-full max-w-4xl lg:max-w-5xl xl:max-w-6xl mx-auto px-3 pt-2 pb-2"
        style={{
          height: `${Math.max(rowVirtualizer.getTotalSize(), 100)}px`,
          minHeight: '100px',
          contain: 'layout style',
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualItem) => {
            const messageGroup = messageGroups[virtualItem.index];

            if (!messageGroup) {
              return null;
            }

            const message = messageGroup.type === 'normal' ? messageGroup.message : null;
            const originalIndex = messageGroup.type === 'normal' ? messageGroup.index : undefined;
            const promptIndex = message && message.type === 'user' && originalIndex !== undefined && getPromptIndexForMessage
              ? getPromptIndexForMessage(originalIndex)
              : undefined;

            const isStreaming = virtualItem.index === messageGroups.length - 1 && isLoading;

            return (
              <MeasurableItem
                key={virtualItem.key}
                virtualItem={virtualItem}
                measureElement={rowVirtualizer.measureElement}
                isStreaming={isStreaming}
                className="absolute inset-x-0"
                style={{
                  top: virtualItem.start,
                }}
              >
                <StreamMessageV2
                  messageGroup={messageGroup}
                  onLinkDetected={onLinkDetected}
                  claudeSettings={settings}
                  isStreaming={isStreaming}
                  promptIndex={promptIndex}
                  sessionId={sessionId ?? undefined}
                  projectId={projectId ?? undefined}
                  projectPath={projectPath}
                  onRevert={onRevert}
                />
              </MeasurableItem>
            );
          })}
      </div>

      {/* CLI风格的处理状态指示器 - sticky 定位确保滚动时始终可见 */}
      {isLoading && messageGroups.length > 0 && (
        <div className="sticky bottom-0 z-10">
          <CliProcessingIndicator
            isProcessing={true}
            onCancel={onCancel}
          />
        </div>
      )}

      {/* Error indicator */}
      {error && (
        <div
          className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive w-full max-w-5xl mx-auto mb-4"
        >
          {error}
        </div>
      )}
    </div>
  );
});

SessionMessages.displayName = "SessionMessages";
