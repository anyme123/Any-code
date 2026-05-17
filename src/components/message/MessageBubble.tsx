import React, { memo } from "react";
import { cn } from "@/lib/utils";

interface MessageBubbleProps {
  variant: "user" | "assistant";
  children: React.ReactNode;
  className?: string;
  bubbleClassName?: string;
  sideContent?: React.ReactNode;
}

/**
 * 消息气泡容器组件
 *
 * 用户消息：右对齐圆角气泡
 * AI消息：左对齐卡片样式，带微妙背景和边框
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
    <div
      className={cn(
        "flex w-full mb-1.5",
        isUser ? "justify-end" : "justify-start",
        className
      )}
    >
      {isUser ? (
        <div className="flex flex-col items-end max-w-[85%] sm:max-w-[72%]">
          <div className="flex items-center gap-1.5 justify-end w-full">
            {sideContent}
            <div
              className={cn(
                "rounded-2xl px-4 py-2",
                "bg-secondary text-secondary-foreground",
                "border border-border/40",
                "break-words text-[14.5px] leading-relaxed overflow-hidden",
                bubbleClassName
              )}
              style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
            >
              {children}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col w-full max-w-full overflow-hidden">
          <div
            className={cn(
              "w-full overflow-hidden px-1",
              bubbleClassName
            )}
            style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
          >
            {children}
          </div>
        </div>
      )}
    </div>
  );
};

MessageBubbleComponent.displayName = "MessageBubble";

export const MessageBubble = memo(MessageBubbleComponent);
