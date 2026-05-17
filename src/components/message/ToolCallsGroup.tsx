/**
 * ToolCallsGroup - 工具调用组组件（重构版）
 *
 * 基于工具注册中心的插件化架构
 * 支持批量管理工具调用，提供折叠/展开功能
 * 当工具数量 >= 3 时默认折叠，显示摘要信息
 */

import React, { memo, useState, useMemo, useRef, useEffect } from 'react';
import { ChevronDown, ChevronRight, Wrench, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toolRegistry } from '@/lib/toolRegistry';
import { useToolResults } from '@/hooks/useToolResults';
import { useTranslation } from '@/hooks/useTranslation';
import { TaskListAggregateWidget } from '@/components/widgets';
import type { TaskToolCall } from '@/components/widgets';
import type { ClaudeStreamMessage } from '@/types/claude';
import type { ToolResultEntry } from '@/contexts/MessagesContext';

interface ToolCall {
  id: string;
  type: 'tool_use';
  name: string;
  input?: Record<string, any>;
}

export interface ToolCallsGroupProps {
  /** 消息数据 */
  message: ClaudeStreamMessage;

  /** 默认折叠状态 */
  defaultCollapsed?: boolean;

  /** 折叠阈值（工具数量 >= 此值时默认折叠） */
  collapseThreshold?: number;

  /** 折叠状态变化回调 */
  onToggle?: (collapsed: boolean) => void;

  /** 链接检测回调 */
  onLinkDetected?: (url: string) => void;

  /** 自定义类名 */
  className?: string;
}

export const ToolCallsGroup: React.FC<ToolCallsGroupProps> = ({
  message,
  defaultCollapsed,
  collapseThreshold = 3,
  onToggle,
  onLinkDetected,
  className,
}) => {
  const { t } = useTranslation();
  // 提取工具调用
  const toolCalls = useMemo((): ToolCall[] => {
    if (!message.message?.content || !Array.isArray(message.message.content)) {
      return [];
    }
    return message.message.content.filter((item: any) => item.type === 'tool_use') as ToolCall[];
  }, [message]);

  const { getResultById, getStatusById } = useToolResults();

  // 自动判断是否应该折叠
  const shouldCollapse = defaultCollapsed ?? toolCalls.length >= collapseThreshold;
  const [isCollapsed, setIsCollapsed] = useState(shouldCollapse);

  // 计算工具执行统计
  const stats = useMemo(() => {
    let successCount = 0;
    let errorCount = 0;
    let pendingCount = 0;

    toolCalls.forEach(tool => {
      const status = getStatusById(tool.id);
      if (status === 'pending') {
        pendingCount++;
      } else if (status === 'error') {
        errorCount++;
      } else {
        successCount++;
      }
    });

    return { successCount, errorCount, pendingCount, total: toolCalls.length };
  }, [toolCalls, getStatusById]);

  // 切换折叠状态
  const toggleCollapse = () => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    onToggle?.(newState);
  };

  // 获取工具类型摘要
  const toolTypesSummary = useMemo(() => {
    const types = new Set(toolCalls.map(t => t.name));
    const typeArray = Array.from(types);
    if (typeArray.length <= 3) {
      return typeArray.join(', ');
    }
    return `${typeArray.slice(0, 3).join(', ')} +${typeArray.length - 3}`;
  }, [toolCalls]);

  if (toolCalls.length === 0) return null;

  // 检测是否包含 Task 管理工具，聚合渲染为任务列表
  const TASK_TOOL_PATTERN = /^(TaskCreate|TaskUpdate|TaskList|TaskGet)$/i;
  const taskToolCalls = toolCalls.filter(t => TASK_TOOL_PATTERN.test(t.name));
  const otherToolCalls = toolCalls.filter(t => !TASK_TOOL_PATTERN.test(t.name));

  // 构建聚合 task 数据
  const taskAggregateData: TaskToolCall[] | null = taskToolCalls.length > 0
    ? taskToolCalls.map(t => ({
        name: t.name,
        input: t.input,
        result: (() => {
          const r = getResultById(t.id);
          return r ? { content: r.content, is_error: r.isError, sourceMessage: r.sourceMessage } : undefined;
        })(),
        id: t.id,
      }))
    : null;

  // 如果全部都是 task 工具，直接渲染聚合组件
  if (taskAggregateData && otherToolCalls.length === 0) {
    return (
      <div className={cn('tool-single-call my-2', className)}>
        <TaskListAggregateWidget toolCalls={taskAggregateData} />
      </div>
    );
  }

  // 只有一个工具时，直接渲染不提供折叠功能
  if (toolCalls.length === 1) {
    const tool = toolCalls[0];
    return (
      <div className={cn('tool-single-call my-2', className)}>
        <SingleToolCall
          tool={tool}
          result={getResultById(tool.id)}
          status={getStatusById(tool.id)}
          onLinkDetected={onLinkDetected}
        />
      </div>
    );
  }

  return (
    <div className={cn('tool-calls-group command-surface my-2 overflow-hidden', className)}>
      {/* 折叠/展开头部 */}
      <button
        onClick={toggleCollapse}
        className="flex items-center gap-2 w-full px-4 py-3 text-left hover:bg-accent/50 transition-colors"
      >
        {isCollapsed ? <ChevronRight className="w-4 h-4 shrink-0" /> : <ChevronDown className="w-4 h-4 shrink-0" />}
        <Wrench className="w-4 h-4 text-primary shrink-0" />
        <span className="font-medium text-sm">{t('tools.toolCalls', { count: stats.total })}</span>

        {/* 状态徽章 */}
        <div className="flex items-center gap-2 ml-auto">
          {stats.successCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-success bg-success/10 px-2 py-1 rounded">
              <CheckCircle className="w-3 h-3" />
              {stats.successCount}
            </span>
          )}
          {stats.errorCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-destructive bg-destructive/10 px-2 py-1 rounded">
              <AlertCircle className="w-3 h-3" />
              {stats.errorCount}
            </span>
          )}
          {stats.pendingCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-info bg-info/10 px-2 py-1 rounded">
              <Loader2 className="w-3 h-3 animate-spin" />
              {stats.pendingCount}
            </span>
          )}
        </div>

        <span className="text-xs text-muted-foreground ml-2 truncate max-w-[200px]">{toolTypesSummary}</span>
      </button>

      {/* 折叠摘要或完整内容 */}
      {isCollapsed ? (
        <CollapsedSummary
          toolCalls={toolCalls}
          getStatusById={getStatusById}
        />
      ) : (
        <div className="space-y-2 border-t border-[var(--surface-hairline-soft)] bg-[var(--surface-panel-muted)] p-4">
          {/* 如果有 task 工具，先渲染聚合任务列表 */}
          {taskAggregateData && (
            <TaskListAggregateWidget toolCalls={taskAggregateData} />
          )}
          {/* 渲染非 task 工具 */}
          {(taskAggregateData ? otherToolCalls : toolCalls).map((tool, index) => (
            <SingleToolCall
              key={tool.id}
              tool={tool}
              result={getResultById(tool.id)}
              status={getStatusById(tool.id)}
              onLinkDetected={onLinkDetected}
              index={index + 1}
              total={taskAggregateData ? otherToolCalls.length : toolCalls.length}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * 折叠时的摘要显示
 */
interface CollapsedSummaryProps {
  toolCalls: ToolCall[];
  getStatusById: (toolUseId?: string | null) => 'pending' | 'success' | 'error';
}

const CollapsedSummary: React.FC<CollapsedSummaryProps> = ({ toolCalls, getStatusById }) => {
  const { t } = useTranslation();
  return (
    <div className="px-4 py-3 bg-background/50 border-t border-border space-y-2">
      {/* 显示前3个工具 */}
      {toolCalls.slice(0, 3).map((tool, idx) => {
        const status = getStatusById(tool.id);
        const hasResult = status !== 'pending';
        const isError = status === 'error';

        let StatusIcon = Loader2;
        let statusColor = 'text-info';

        if (hasResult) {
          if (isError) {
            StatusIcon = AlertCircle;
            statusColor = 'text-destructive';
          } else {
            StatusIcon = CheckCircle;
            statusColor = 'text-success';
          }
        }

        return (
          <div key={idx} className="flex items-center gap-2 text-xs">
            <StatusIcon className={cn('w-3 h-3', statusColor, !hasResult && 'animate-spin')} />
            <span className="font-mono font-medium">{tool.name}</span>
            {tool.input?.path && <span className="text-muted-foreground truncate">: {tool.input.path}</span>}
          </div>
        );
      })}

      {toolCalls.length > 3 && (
        <div className="text-xs text-muted-foreground pl-5">{t('tools.moreTools', { count: toolCalls.length - 3 })}</div>
      )}

      <div className="text-[10px] text-muted-foreground/70 pt-1">{t('tools.clickToExpand')}</div>
    </div>
  );
};

/**
 * 单个工具调用渲染
 */
interface SingleToolCallProps {
  tool: ToolCall;
  result?: ToolResultEntry;
  status: 'pending' | 'success' | 'error';
  onLinkDetected?: (url: string) => void;
  index?: number;
  total?: number;
}

const SingleToolCallComponent: React.FC<SingleToolCallProps> = ({ tool, result, status, onLinkDetected, index, total }) => {
  const { t } = useTranslation();
  const renderer = toolRegistry.getRenderer(tool.name);

  const normalizedResult = result
    ? {
        content: result.content,
        is_error: result.isError,
        sourceMessage: result.sourceMessage,
      }
    : undefined;

  // 判断是否正在流式输出（工具执行中）
  const isStreaming = status === 'pending';

  // 构建渲染 props
  const renderProps = {
    toolName: tool.name,
    input: tool.input,
    result: normalizedResult,
    toolId: tool.id,
    onLinkDetected,
    isStreaming,
  };

  // 判断状态
  const hasResult = status !== 'pending';
  const isError = status === 'error';

  let StatusIcon = Loader2;
  let statusColor = 'text-info';
  let statusBg = 'bg-info/10';

  if (hasResult) {
    if (isError) {
      StatusIcon = AlertCircle;
      statusColor = 'text-destructive';
      statusBg = 'bg-destructive/10';
    } else {
      StatusIcon = CheckCircle;
      statusColor = 'text-success';
      statusBg = 'bg-success/10';
    }
  }

  return (
    <div className={cn('tool-call-item my-2', renderer ? '' : 'command-surface p-3')}>
      {/* 工具头部 - 仅在没有专用渲染器时显示 */}
      {!renderer && (
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <StatusIcon className={cn('w-4 h-4', statusColor, !hasResult && 'animate-spin')} />
            <span className="font-mono text-sm font-medium">{tool.name}</span>
            {index && total && (
              <span className="text-xs text-muted-foreground">
                ({index}/{total})
              </span>
            )}
          </div>
          <span className={cn('text-xs px-2 py-0.5 rounded', statusBg, statusColor)}>
            {hasResult ? (isError ? t('tools.failed') : t('tools.success')) : t('tools.executing')}
          </span>
        </div>
      )}

      {/* 使用注册的工具渲染器 */}
      {renderer ? (
        <div className="tool-widget-container">
          <renderer.render {...renderProps} />
        </div>
      ) : (
        <FallbackToolRender tool={tool} result={normalizedResult} />
      )}
    </div>
  );
};

SingleToolCallComponent.displayName = "SingleToolCall";

const SingleToolCall = memo(SingleToolCallComponent);

/**
 * 未注册工具的降级渲染
 */
interface FallbackToolRenderProps {
  tool: ToolCall;
  result?: {
    content?: any;
    is_error?: boolean;
  };
}

/**
 * 递归提取内容中的文本
 * 支持多种格式：字符串、数组、对象（含 text/message/content 字段）
 */
const extractTextContent = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }

  if (value == null) {
    return '';
  }

  if (Array.isArray(value)) {
    // 递归处理数组中的每个元素，用换行符连接
    return value.map(extractTextContent).filter(Boolean).join('\n');
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;

    // 优先提取 text 字段（MCP 工具常见格式）
    if (typeof record.text === 'string') {
      return record.text;
    }

    // 其次尝试 message 字段
    if (typeof record.message === 'string') {
      return record.message;
    }

    // 再次尝试 content 字段
    if (typeof record.content === 'string') {
      return record.content;
    }

    // 如果都没有，序列化为 JSON
    try {
      return JSON.stringify(record, null, 2);
    } catch {
      return String(record);
    }
  }

  return String(value);
};

/**
 * 处理结果内容，将转义的换行符转换为实际换行符
 */
const parseResultContent = (content: any): string => {
  // 先提取文本内容
  const text = extractTextContent(content);

  // 然后处理转义字符
  return text
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t');
};

const FallbackToolRender: React.FC<FallbackToolRenderProps> = ({ tool, result }) => {
  const { t } = useTranslation();
  const COLLAPSE_HEIGHT = 300;
  const resultRef = useRef<HTMLPreElement>(null);
  const [shouldCollapse, setShouldCollapse] = useState(false);
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    const el = resultRef.current;
    if (!el) return;
    const h = el.scrollHeight;
    const need = h > COLLAPSE_HEIGHT;
    setShouldCollapse(need);
    setCollapsed(need);
  }, [result]);

  const toggle = () => setCollapsed((v) => !v);

  // 处理结果内容
  const resultContent = result ? parseResultContent(result.content) : '';

  return (
    <div className="fallback-tool-render space-y-2 text-xs">
      <div className="text-muted-foreground">{t('tools.unregisteredTool')}</div>

      {tool.input && Object.keys(tool.input).length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
            {t('tools.inputParams')}
          </summary>
          <pre className="mt-1 p-2 bg-muted rounded text-[10px] overflow-x-auto whitespace-pre-wrap break-words" style={{ overflowWrap: 'anywhere' }}>
            {JSON.stringify(tool.input, null, 2)}
          </pre>
        </details>
      )}

      {result && (
        <div className={cn('relative rounded-lg border border-[var(--surface-hairline-soft)] p-2', result.is_error ? 'bg-destructive/10' : 'bg-[var(--surface-code)]')}>
          <div className="font-medium mb-1 text-xs">{result.is_error ? t('tools.executionFailed') : t('tools.executionResult')}:</div>
          <div className="relative">
            <pre
              ref={resultRef}
              className={cn(
                'text-[10px] overflow-x-auto whitespace-pre-wrap break-words transition-[max-height]',
                shouldCollapse && collapsed && 'overflow-hidden'
              )}
              style={{ overflowWrap: 'anywhere', ...(shouldCollapse && collapsed ? { maxHeight: `${COLLAPSE_HEIGHT}px` } : {}) }}
            >
              {resultContent}
            </pre>
            {shouldCollapse && collapsed && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-background/80 via-background/50 to-transparent" />
            )}
          </div>
          {shouldCollapse && (
            <button
              onClick={toggle}
              className="mt-2 text-[11px] text-primary underline underline-offset-2"
            >
              {collapsed ? t('tools.expandAll') : t('tools.collapseContent')}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default ToolCallsGroup;
