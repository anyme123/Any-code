import React from "react";
import { User, Bot, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTimestamp } from "@/lib/messageUtils";

interface MessageHeaderProps {
  /** 消息类型 */
  variant: "user" | "assistant";
  /** 时间戳 */
  timestamp?: string;
  /** 是否显示头像 */
  showAvatar?: boolean;
  /** 自定义类名 */
  className?: string;
}

/**
 * 消息头部组件
 * 显示发送者信息和时间戳
 */
export const MessageHeader: React.FC<MessageHeaderProps> = ({
  variant,
  timestamp,
  showAvatar = true,
  className
}) => {
  const isUser = variant === "user";
  const Icon = isUser ? User : Bot;
  const label = isUser ? "You" : "Claude";
  const formattedTime = formatTimestamp(timestamp);

  return (
    <div
      className={cn(
        "flex items-center gap-2 text-xs text-muted-foreground mb-2",
        isUser && "justify-end",
        className
      )}
    >
      {showAvatar && (
        <div
          className={cn(
            "flex items-center justify-center w-6 h-6 rounded-full",
            isUser ? "bg-primary/10" : "bg-[var(--surface-panel)] border border-[var(--surface-hairline-soft)]"
          )}
        >
          <Icon className={cn(
            "w-4 h-4",
            isUser ? "text-primary" : "text-info"
          )} />
        </div>
      )}
      <span className="font-medium">{label}</span>
      {formattedTime && (
        <>
          <span className="text-muted-foreground/50">•</span>
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formattedTime}
          </span>
        </>
      )}
    </div>
  );
};
