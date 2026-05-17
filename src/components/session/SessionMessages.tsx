import React, { useImperativeHandle, forwardRef, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useVirtualizer } from "@tanstack/react-virtual";
import { StreamMessageV2 } from "@/components/message";
import type { MessageGroup } from "@/lib/subagentGrouping";
import { useSession } from "@/contexts/SessionContext";
import { CliProcessingIndicator } from "./CliProcessingIndicator";

/**
 * ✅ MeasurableItem: 自动监听高度变化的虚拟列表项
 * 
 * 使用 ResizeObserver 并在内容变化时自动通知虚拟列表重新测量。
 * 仅对正在流式输出的消息进行防抖，历史消息立即更新以防止滚动抖动。
 */
const MeasurableItem = ({ virtualItem, measureElement, isStreaming, children, ...props }: any) => {
  const elRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef(measureElement);
  
  // 保持 measureElement 引用最新
  useEffect(() => {
    measureRef.current = measureElement;
  }, [measureElement]);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;

    // 初始测量 - 立即执行确保占位准确
    measureRef.current(el);

    let frameId: number;

    // 创建观察者
    const observer = new ResizeObserver(() => {
      if (isStreaming) {
        // ✅ 流式消息：使用防抖，避免每帧重绘导致的性能问题
        cancelAnimationFrame(frameId);
        frameId = requestAnimationFrame(() => {
          if (elRef.current) {
            measureRef.current(elRef.current);
          }
        });
      } else {
        // ✅ 历史消息：立即响应（通过 rAF 避免 Loop 错误），确保向上滚动时高度修正及时，减少抖动
        requestAnimationFrame(() => {
          if (elRef.current) {
            measureRef.current(elRef.current);
          }
        });
      }
    });

    observer.observe(el);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frameId);
    };
  }, [isStreaming]); // 添加 isStreaming 依赖

  return (
    <motion.div
      {...props}
      ref={elRef}
      data-index={virtualItem.index}
    >
      {children}
    </motion.div>
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
    overscan: 12, // ✅ OPTIMIZED: Increased to 12 to prevent blank areas during fast scrolling
    measureElement: (element) => {
      // Ensure element is fully rendered before measurement
      return element?.getBoundingClientRect().height ?? 200;
    },
  });

  useImperativeHandle(ref, () => ({
    scrollToBottom: () => {
      if (messageGroups.length === 0) return;

      // Use virtualizer's scrollToIndex for reliable scrolling to the last item
      rowVirtualizer.scrollToIndex(messageGroups.length - 1, {
        align: 'end',
        behavior: 'auto',
      });

      // Schedule rAF-based follow-up scrolls to handle the virtualizer's
      // progressive height re-measurements. After scrollToIndex renders the
      // target items, the virtualizer measures their actual heights which may
      // differ from estimates, shifting the total scrollHeight.
      // Uses requestAnimationFrame to sync with rendering cycle and checks
      // whether we actually reached the bottom before each follow-up scroll.
      const followUpDelays = [50, 150, 300, 500];
      followUpDelays.forEach((delay) => {
        setTimeout(() => {
          requestAnimationFrame(() => {
            if (parentRef.current) {
              const { scrollTop, scrollHeight, clientHeight } = parentRef.current;
              // Only scroll if we haven't reached the true bottom yet
              if (scrollHeight - scrollTop - clientHeight > 1) {
                parentRef.current.scrollTo({
                  top: scrollHeight,
                  behavior: 'auto',
                });
              }
            }
          });
        }, delay);
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
      className="message-scroll-surface flex-1 overflow-y-auto relative"
      style={{
        paddingTop: '16px',
        paddingBottom: '22px',
      }}
    >
      <div
        className="message-rail relative w-full max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[86%] mx-auto px-4 pl-5 pt-6 pb-4"
        style={{
          height: `${Math.max(rowVirtualizer.getTotalSize(), 100)}px`,
          minHeight: '100px',
        }}
      >
        <AnimatePresence>
          {rowVirtualizer.getVirtualItems().map((virtualItem) => {
            const messageGroup = messageGroups[virtualItem.index];

            // 防御性检查：确保 messageGroup 存在
            if (!messageGroup) {
              console.warn('[SessionMessages] messageGroup is undefined for index:', virtualItem.index);
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
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.16 }}
                className="absolute inset-x-4"
                style={{
                  top: virtualItem.start,
                }}
              >
                {/* ✅ 架构优化: StreamMessageV2 现在从 SessionContext 获取数据 */}
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
        </AnimatePresence>
      </div>

      {/* CLI风格的处理状态指示器 - 显示在消息列表底部 */}
      <CliProcessingIndicator
        isProcessing={isLoading && messageGroups.length > 0}
        onCancel={onCancel}
      />

      {/* Error indicator - 移除固定 marginBottom，因为输入框不再是 fixed 定位 */}
      {error && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive w-full max-w-5xl mx-auto mb-4"
        >
          {error}
        </motion.div>
      )}
    </div>
  );
});

SessionMessages.displayName = "SessionMessages";
