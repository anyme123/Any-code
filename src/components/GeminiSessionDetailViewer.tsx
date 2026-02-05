/**
 * GeminiSessionDetailViewer Component
 *
 * Displays complete details of a Gemini CLI session including:
 * - All messages (user and assistant)
 * - Tool calls and results
 * - Timestamps and metadata
 */

import React, { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import type { GeminiSessionDetail } from '@/types/gemini';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible';
import { X, User, Bot, Wrench, Clock, CheckCircle, XCircle, RefreshCw, ChevronDown, ChevronRight, Cpu } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface GeminiSessionDetailViewerProps {
  projectPath: string;
  sessionId: string;
  onClose?: () => void;
  onResume?: (sessionId: string) => void;
  className?: string;
}

export const GeminiSessionDetailViewer: React.FC<GeminiSessionDetailViewerProps> = ({
  projectPath,
  sessionId,
  onClose,
  onResume,
  className = '',
}) => {
  const [session, setSession] = useState<GeminiSessionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const autoScrolledSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (projectPath && sessionId) {
      loadSession();
    }
  }, [projectPath, sessionId]);

  // 进入历史会话详情时，默认滚动到最底部以显示最新消息
  useEffect(() => {
    if (!session) return;

    // 获取滚动容器
    const el = messagesScrollRef.current;
    if (!el) return;

    // 如果已经为这个会话自动滚动过，跳过
    if (autoScrolledSessionIdRef.current === sessionId) {
      return;
    }

    // 标记是否需要保持在底部
    let shouldStick = true;
    let scrollCount = 0;
    const MAX_SCROLL_ATTEMPTS = 3; // 限制滚动次数，避免过度滚动

    const scrollToBottom = () => {
      if (shouldStick && el && scrollCount < MAX_SCROLL_ATTEMPTS) {
        el.scrollTop = el.scrollHeight;
        scrollCount++;
      }
    };

    // 立即尝试滚动
    scrollToBottom();

    // 使用防抖的 ResizeObserver，减少滚动频率
    let resizeTimer: number | null = null;
    const observer = new ResizeObserver(() => {
      if (resizeTimer !== null) {
        cancelAnimationFrame(resizeTimer);
      }
      resizeTimer = requestAnimationFrame(() => {
        scrollToBottom();
      });
    });

    // 监听内容区域（ScrollArea 的直接子元素）
    if (el.firstElementChild) {
      observer.observe(el.firstElementChild);
    } else {
      observer.observe(el);
    }

    // 300ms后停止强制滚动，允许用户自由滚动（从1000ms减少到300ms）
    const timer = setTimeout(() => {
      shouldStick = false;
      observer.disconnect();
      autoScrolledSessionIdRef.current = sessionId;
      if (resizeTimer !== null) {
        cancelAnimationFrame(resizeTimer);
      }
    }, 300);

    return () => {
      shouldStick = false;
      observer.disconnect();
      clearTimeout(timer);
      if (resizeTimer !== null) {
        cancelAnimationFrame(resizeTimer);
      }
    };
  }, [session?.sessionId, sessionId]);

  const loadSession = async () => {
    if (!projectPath || !sessionId) return;

    setLoading(true);
    setError(null);

    try {
      const detail = await api.getGeminiSessionDetail(projectPath, sessionId);
      setSession(detail);
    } catch (err) {
      console.error('Failed to load session detail:', err);
      setError(err instanceof Error ? err.message : 'Failed to load session detail');
    } finally {
      setLoading(false);
    }
  };

  const formatTimestamp = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return timestamp;
    }
  };

  // Check if a tool is a subagent (e.g., codebase_investigator, code_executor)
  const isSubagentTool = (toolName: string) => {
    const subagentTools = [
      'codebase_investigator',
      'code_executor',
      'task',
      'subagent',
      'analyst',
      'planner'
    ];
    return subagentTools.some(name =>
      toolName.toLowerCase().includes(name.toLowerCase())
    );
  };

  // Component for a single tool call with collapsible support
  const ToolCallItem: React.FC<{ toolCall: any; index: number }> = ({ toolCall }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [argsOpen, setArgsOpen] = useState(false);

    const isSubagent = isSubagentTool(toolCall.name);
    const hasLongResult = toolCall.resultDisplay && toolCall.resultDisplay.length > 500;

    return (
      <div
        className={`rounded-md border p-3 mt-2 ${
          isSubagent
            ? 'bg-purple-500/5 border-purple-500/30'
            : 'bg-muted/30'
        }`}
      >
        {/* Tool Header */}
        <div className="flex items-center gap-2 mb-2">
          {isSubagent ? (
            <Cpu className="h-4 w-4 text-purple-500" />
          ) : (
            <Wrench className="h-4 w-4 text-blue-500" />
          )}
          <span className="text-sm font-medium">
            {toolCall.displayName || toolCall.name}
          </span>
          {isSubagent && (
            <Badge variant="outline" className="text-xs bg-purple-500/10 text-purple-600 border-purple-500/30">
              子代理
            </Badge>
          )}
          {toolCall.status === 'success' && (
            <CheckCircle className="h-3 w-3 text-green-500" />
          )}
          {toolCall.status === 'error' && (
            <XCircle className="h-3 w-3 text-destructive" />
          )}
        </div>

        {/* Tool Description */}
        {toolCall.description && (
          <p className="text-xs text-muted-foreground mb-2 line-clamp-2">
            {toolCall.description}
          </p>
        )}

        {/* Tool Arguments - Collapsible */}
        {toolCall.args && Object.keys(toolCall.args).length > 0 && (
          <Collapsible open={argsOpen} onOpenChange={setArgsOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs mb-1">
                {argsOpen ? (
                  <ChevronDown className="h-3 w-3 mr-1" />
                ) : (
                  <ChevronRight className="h-3 w-3 mr-1" />
                )}
                参数 ({Object.keys(toolCall.args).length})
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="text-xs bg-background p-2 rounded overflow-x-auto max-h-40 overflow-y-auto">
                {JSON.stringify(toolCall.args, null, 2)}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Tool Result - Collapsible for long results */}
        {toolCall.resultDisplay && (
          <div className="mt-2">
            {hasLongResult ? (
              <Collapsible open={isOpen} onOpenChange={setIsOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
                    {isOpen ? (
                      <ChevronDown className="h-3 w-3 mr-1" />
                    ) : (
                      <ChevronRight className="h-3 w-3 mr-1" />
                    )}
                    结果 {!isOpen && `(${toolCall.resultDisplay.length} 字符)`}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-1 max-h-96 overflow-y-auto">
                    {toolCall.renderOutputAsMarkdown ? (
                      <div className="text-xs prose prose-sm dark:prose-invert max-w-none bg-background p-2 rounded">
                        <ReactMarkdown>{toolCall.resultDisplay}</ReactMarkdown>
                      </div>
                    ) : (
                      <pre className="text-xs bg-background p-2 rounded whitespace-pre-wrap break-words">
                        {toolCall.resultDisplay}
                      </pre>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ) : (
              <div>
                <p className="text-xs font-medium mb-1">结果:</p>
                {toolCall.renderOutputAsMarkdown ? (
                  <div className="text-xs prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown>{toolCall.resultDisplay}</ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-xs bg-background p-2 rounded whitespace-pre-wrap">
                    {toolCall.resultDisplay}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderToolCall = (toolCall: any, index: number) => {
    return <ToolCallItem key={toolCall.id || index} toolCall={toolCall} index={index} />;
  };

  const renderMessage = (message: any, index: number) => {
    const isUser = message.type === 'user';

    return (
      <div
        key={message.id || index}
        className={`flex gap-3 p-4 ${isUser ? 'bg-background' : 'bg-muted/30'}`}
      >
        {/* Avatar */}
        <div className={`flex-shrink-0 mt-1 ${isUser ? 'text-blue-500' : 'text-purple-500'}`}>
          {isUser ? <User className="h-5 w-5" /> : <Bot className="h-5 w-5" />}
        </div>

        {/* Message Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium">{isUser ? '用户' : 'Gemini'}</span>
            <span className="text-xs text-muted-foreground">
              {formatTimestamp(message.timestamp)}
            </span>
            {message.model && (
              <Badge variant="outline" className="text-xs">
                {message.model}
              </Badge>
            )}
          </div>

          {/* Message Text */}
          {message.content && (
            <div className="text-sm whitespace-pre-wrap break-words">
              {message.content}
            </div>
          )}

          {/* Tool Calls */}
          {message.toolCalls && message.toolCalls.length > 0 && (
            <div className="mt-3 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                工具调用 ({message.toolCalls.length})
              </p>
              {message.toolCalls.map((tc: any, idx: number) => renderToolCall(tc, idx))}
            </div>
          )}

          {/* Thoughts (if any) */}
          {message.thoughts && message.thoughts.length > 0 && (
            <div className="mt-2 text-xs text-muted-foreground italic">
              💭 {JSON.stringify(message.thoughts)}
            </div>
          )}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className={`flex items-center justify-center p-8 ${className}`}>
        <div className="flex items-center gap-2 text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" />
          <span>加载会话详情...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`p-4 ${className}`}>
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4">
          <p className="text-sm text-destructive mb-2">{error}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={loadSession}>
              <RefreshCw className="mr-2 h-3 w-3" />
              重试
            </Button>
            {onClose && (
              <Button variant="outline" size="sm" onClick={onClose}>
                关闭
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div>
          <h3 className="text-sm font-medium">会话详情</h3>
          <div className="flex items-center gap-2 mt-1">
            <Clock className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              开始: {formatTimestamp(session.startTime)}
            </span>
            {session.lastUpdated && (
              <>
                <span className="text-muted-foreground">•</span>
                <span className="text-xs text-muted-foreground">
                  最后更新: {formatTimestamp(session.lastUpdated)}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onResume && (
            <Button
              variant="default"
              size="sm"
              onClick={() => onResume(sessionId)}
            >
              恢复会话
            </Button>
          )}
          {onClose && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Messages */}
      <ScrollArea ref={messagesScrollRef} className="flex-1">
        <div className="divide-y">
          {session.messages.length === 0 ? (
            <div className="flex items-center justify-center p-8 text-center">
              <p className="text-sm text-muted-foreground">此会话没有消息</p>
            </div>
          ) : (
            session.messages.map(renderMessage)
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="border-t p-3 bg-muted/30">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Session ID: {session.sessionId}</span>
          <span>{session.messages.length} 条消息</span>
        </div>
      </div>
    </div>
  );
};

export default GeminiSessionDetailViewer;
