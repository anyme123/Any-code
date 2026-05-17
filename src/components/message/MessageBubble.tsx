import React, { memo } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface MessageBubbleProps {
  /** 消息类型：用户或AI */
  variant: "user" | "assistant";
  /** 子内容 */
  children: React.ReactNode;
  /** 自定义容器类名 */
  className?: string;
  /** 自定义气泡类名 */
  bubbleClassName?: string;
  /** 气泡侧边内容 (显示在气泡外侧，用户消息在左侧，AI消息在右侧) */
  sideContent?: React.ReactNode;
}

/**
 * 消息气泡容器组件
 * 
 * 用户消息：右对齐气泡样式
 * AI消息：左对齐卡片样式
 */
const MessageBubbleComponent: React.FC<MessageBubbleProps> = ({
  variant,
  children,
  className,
  bubbleClassName,
  sideContent
}) => {
  const isUser = variant === "user";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.995 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        duration: 0.18,
        ease: [0.2, 0, 0, 1] // Emphasized easing
      }}
      className={cn(
        "flex w-full mb-3",
        isUser ? "justify-end" : "justify-start",
        className
      )}
    >
      {isUser ? (
        // User Message: Modern Bubble
        <div className="flex flex-col items-end max-w-[88%] sm:max-w-[72%]">
          <div className="flex items-center gap-1.5 justify-end w-full">
            {sideContent}
            <div
              className={cn(
                "user-message-surface px-4 py-2.5 shadow-sm",
                "break-words text-[15px] leading-relaxed overflow-hidden",
                bubbleClassName
              )}
              style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
            >
              {children}
            </div>
          </div>
        </div>
      ) : (
        // AI Message: readable workbench card
        <div className="flex flex-col w-full max-w-full overflow-hidden">
          <div
            className={cn(
              "assistant-message-surface w-full overflow-hidden px-4 py-3",
              bubbleClassName
            )}
            style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
          >
             {children}
          </div>
        </div>
      )}
    </motion.div>
  );
};

MessageBubbleComponent.displayName = "MessageBubble";

export const MessageBubble = memo(MessageBubbleComponent);
