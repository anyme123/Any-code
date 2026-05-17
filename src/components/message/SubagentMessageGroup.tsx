/**
 * 子代理消息组组件
 *
 * 将子代理的完整操作链路（从 Task 调用到执行完成）作为一个整体进行渲染
 * 提供视觉分隔和折叠/展开功能
 */

import React, { memo, useState } from "react";
import { Bot, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { AIMessage } from "./AIMessage";
import { UserMessage } from "./UserMessage";
import type { SubagentGroup } from "@/lib/subagentGrouping";
import { getSubagentMessageRole } from "@/lib/subagentGrouping";
import { useTranslation } from "@/hooks/useTranslation";

/**
 * 获取子代理类型的显示名称
 */
function getSubagentTypeLabel(type?: string, t?: (key: string) => string): string {
  if (!type || !t) return t ? t('subagent.subagent') : '子代理';
  const labelMap: Record<string, string> = {
    'general-purpose': t('subagent.generalPurpose'),
    'Explore': t('subagent.explore'),
    'Plan': t('subagent.plan'),
    'statusline-setup': t('subagent.statuslineSetup'),
    'code-reviewer': t('subagent.codeReviewer'),
    'analyst': t('subagent.analyst'),
    'executor': t('subagent.executor'),
  };
  return labelMap[type] || type;
}

interface SubagentMessageGroupProps {
  /** 子代理消息组 */
  group: SubagentGroup;
  /** 自定义类名 */
  className?: string;
  /** 链接检测回调 */
  onLinkDetected?: (url: string) => void;
  /** 是否正在流式输出（子代理仍在执行中） */
  isStreaming?: boolean;
}

/**
 * 子代理消息组
 *
 * 将 Task 工具调用和相关的子代理消息打包展示
 * 使用独立的视觉样式（边框、背景色、缩进）进行区分
 */
const SubagentMessageGroupComponent: React.FC<SubagentMessageGroupProps> = ({
  group,
  className,
  onLinkDetected,
  isStreaming = false,
}) => {
  const { t } = useTranslation();
  // 🔄 默认折叠子代理执行过程，减少视觉干扰
  const [isExpanded, setIsExpanded] = useState(false);

  // 🛡️ 防御性编程：验证 subagentMessages 数组
  const subagentMessages = Array.isArray(group.subagentMessages) ? group.subagentMessages : [];

  // 统计子代理消息数量
  const messageCount = subagentMessages.length;

  // 🛡️ 如果没有 taskMessage，返回 null 防止崩溃
  if (!group.taskMessage) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[SubagentMessageGroup] Missing taskMessage in group:', group);
    }
    return null;
  }

  return (
    <div className={cn("relative", className)}>
      {/* 子代理组容器 - Modern Clean Style */}
      <div className="rounded-lg border border-border/50 bg-muted/10 overflow-hidden">

        {/* Task 工具调用（固定显示） */}
        <div className="border-b border-border/30 px-2 py-1">
          <AIMessage
            message={group.taskMessage}
            isStreaming={false}
            onLinkDetected={onLinkDetected}
            className="m-0"
          />
        </div>

        {/* 折叠控制按钮 - Compact Header */}
        <div
          className="px-2.5 py-1.5 bg-muted/30 hover:bg-muted/50 border-b border-border/30 cursor-pointer transition-colors select-none flex items-center justify-between group/header"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex items-center justify-center w-5 h-5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <Bot className="h-3.5 w-3.5" />
            </div>
            <span className="text-sm font-medium text-foreground/80 truncate">
              {group.subagentType ? getSubagentTypeLabel(group.subagentType, t) : t('subagent.subagent')}
            </span>
            <div className="h-3 w-px bg-border/50 mx-1" />
            <span className="text-xs text-muted-foreground truncate">
              {t('subagent.executionProcess')}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground/60">
              {t('subagent.messageCount', { count: messageCount })}
            </span>
            <div className="text-muted-foreground group-hover/header:text-foreground transition-colors">
              {isExpanded ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </div>
          </div>
        </div>

        {/* 子代理消息列表（可折叠）
            ⚡ 性能优化：移除 height: 0 → auto 动画，避免动画期间 ResizeObserver
            连续触发 measureElement，导致虚拟列表 totalSize 抖动、滚动抽搐 */}
        {isExpanded && (
          <div className="overflow-hidden animate-in fade-in duration-150">
            <div className="p-2 space-y-2 bg-background/30">
                {/* 渲染子代理消息 */}
                {subagentMessages.length > 0 ? (
                  subagentMessages.map((message, index) => {
                    // 🛡️ 跳过 null/undefined 消息
                    if (!message) return null;

                    const role = getSubagentMessageRole(message);

                    // 根据修正后的角色渲染消息
                    if (role === 'assistant' || message.type === 'assistant') {
                      return (
                        <div key={`msg-${index}-${message.timestamp || index}`} className="pl-2 pr-1">
                          <AIMessage
                            message={message}
                            isStreaming={false}
                            onLinkDetected={onLinkDetected}
                            className="shadow-none"
                          />
                        </div>
                      );
                    } else if (role === 'user' || message.type === 'user') {
                      // 如果是主代理发给子代理的提示词，添加特殊标识
                      const isPromptToSubagent = message.type === 'user' &&
                        Array.isArray(message.message?.content) &&
                        message.message.content.some((item: any) => item?.type === 'text');

                      return (
                        <div key={`msg-${index}-${message.timestamp || index}`} className="pl-2 pr-1">
                          {isPromptToSubagent && (
                            <div className="text-[10px] text-muted-foreground mb-1 px-2 flex items-center gap-1 opacity-60">
                              <span className="uppercase tracking-wider font-medium">Task Input</span>
                            </div>
                          )}
                          <UserMessage
                            message={message}
                            className="shadow-none"
                          />
                        </div>
                      );
                    }

                    return null;
                  })
                ) : (
                  <div className="text-xs text-muted-foreground px-2 py-4 text-center italic">
                    {t('subagent.noSubagentMessages')}
                  </div>
                )}
            </div>
          </div>
        )}

        {/* 流式活跃指示器 - 子代理仍在执行中 */}
        {isStreaming && (
          <div className="px-3 py-2 border-t border-border/30 bg-muted/20 flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
            <span className="text-xs text-muted-foreground">
              {t('subagent.executing', '子代理执行中...')}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

SubagentMessageGroupComponent.displayName = "SubagentMessageGroup";

export const SubagentMessageGroup = memo(SubagentMessageGroupComponent);
