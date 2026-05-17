import React, { useState, useEffect, useRef, useMemo } from "react";
import { Undo2, AlertTriangle, ChevronDown, ChevronUp, User } from "lucide-react";
import { MessageBubble } from "./MessageBubble";
import { MessageImagePreview, extractImagesFromContent, extractImagePathsFromText } from "./MessageImagePreview";
import { MessageActions } from "./MessageActions";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import type { ClaudeStreamMessage } from '@/types/claude';
import type { RewindCapabilities, RewindMode } from '@/lib/api';
import { formatTimestamp } from "@/lib/messageUtils";
import { api } from '@/lib/api';
import { useTranslation } from "@/hooks/useTranslation";

interface UserMessageProps {
  /** 消息数据 */
  message: ClaudeStreamMessage;
  /** 自定义类名 */
  className?: string;
  /** 提示词索引（只计算用户提示词） */
  promptIndex?: number;
  /** Session ID */
  sessionId?: string;
  /** Project ID */
  projectId?: string;
  /** Project Path (for Gemini rewind) */
  projectPath?: string;
  /** 撤回回调 */
  onRevert?: (promptIndex: number, mode: RewindMode) => void;
}

/**
 * 检查是否是 Skills 消息
 */
const isSkillsMessage = (text: string): boolean => {
  return text.includes('<command-name>')
    || text.includes('Launching skill:')
    || text.includes('skill is running');
};

/**
 * 检查是否是斜杠命令输出消息
 * Claude CLI 的斜杠命令（如 /cost, /context）输出会包含 <local-command-stdout> 标签
 */
const isSlashCommandOutput = (text: string): boolean => {
  return text.includes('<local-command-stdout>');
};

/**
 * 检查是否是斜杠命令输入
 * 用户输入的斜杠命令（如 /cost, /context, /help）以 / 开头
 * 排除路径（包含 \ 或多个 /）和长文本
 */
const isSlashCommandInput = (text: string): boolean => {
  const trimmed = text.trim();
  // 必须以 / 开头，不能包含换行，不能太长，不能是路径
  return trimmed.startsWith('/')
    && !trimmed.includes('\n')
    && trimmed.length < 100
    && !trimmed.includes('\\')  // 排除 Windows 路径
    && (trimmed.match(/\//g) || []).length === 1;  // 只有一个 /，排除 URL 和路径
};

/**
 * 格式化斜杠命令输出
 * 提取 <local-command-stdout> 标签内的内容并美化显示
 */
const formatSlashCommandOutput = (text: string): React.ReactNode => {
  // 提取 local-command-stdout 内容
  const match = text.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
  if (!match) return text;

  const content = match[1].trim();

  // 检测是否是表格格式（包含 | 分隔符）
  const isTable = content.includes('|') && content.includes('---');

  if (isTable) {
    // 解析并渲染表格
    const lines = content.split('\n').filter(line => line.trim());
    const tableRows: string[][] = [];

    for (const line of lines) {
      // 跳过分隔行（如 |---|---|---|）
      if (line.match(/^\|[-\s|]+\|$/)) continue;

      // 解析表格行
      const cells = line.split('|').filter(cell => cell.trim()).map(cell => cell.trim());
      if (cells.length > 0) {
        tableRows.push(cells);
      }
    }

    if (tableRows.length > 0) {
      const [header, ...dataRows] = tableRows;
      return (
        <div className="space-y-3">
          {/* 非表格内容（如标题） */}
          {content.split('\n').filter(line => !line.includes('|')).map((line, i) => (
            line.trim() && (
              <div key={i} className={line.startsWith('#') ? 'font-semibold text-sm' : 'text-sm'}>
                {line.replace(/^#+\s*/, '')}
              </div>
            )
          ))}

          {/* 表格 */}
          <div className="overflow-x-auto">
            <table className="text-xs w-full border-collapse">
              <thead>
                <tr className="border-b border-border/50">
                  {header.map((cell, i) => (
                    <th key={i} className="text-left py-1 px-2 font-medium text-muted-foreground">
                      {cell}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataRows.map((row, rowIdx) => (
                  <tr key={rowIdx} className="border-b border-border/30 last:border-0">
                    {row.map((cell, cellIdx) => (
                      <td key={cellIdx} className="py-1 px-2">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }
  }

  // 非表格内容 - 简单格式化显示
  return (
    <div className="space-y-1 text-sm">
      {content.split('\n').map((line, i) => {
        const trimmedLine = line.trim();
        if (!trimmedLine) return null;

        // 标题样式
        if (trimmedLine.startsWith('#')) {
          return (
            <div key={i} className="font-semibold mt-2 first:mt-0">
              {trimmedLine.replace(/^#+\s*/, '')}
            </div>
          );
        }

        // 键值对样式（如 **Key:** Value）
        const kvMatch = trimmedLine.match(/^\*\*(.+?)\*\*:?\s*(.*)$/);
        if (kvMatch) {
          return (
            <div key={i} className="flex gap-2">
              <span className="font-medium">{kvMatch[1]}:</span>
              <span className="text-muted-foreground">{kvMatch[2]}</span>
            </div>
          );
        }

        // 普通行
        return <div key={i}>{trimmedLine}</div>;
      })}
    </div>
  );
};

/**
 * 格式化 Skills 消息显示
 */
const formatSkillsMessage = (text: string): React.ReactNode => {
  // 提取 command-name 和 command-message
  const commandNameMatch = text.match(/<command-name>(.+?)<\/command-name>/);
  const commandMessageMatch = text.match(/<command-message>(.+?)<\/command-message>/);
  
  if (commandNameMatch || commandMessageMatch) {
    return (
      <div className="space-y-2">
        {commandMessageMatch && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-success">OK</span>
            <span>{commandMessageMatch[1]}</span>
          </div>
        )}
        {commandNameMatch && (
          <div className="text-xs text-muted-foreground font-mono">
            Skill: {commandNameMatch[1]}
          </div>
        )}
      </div>
    );
  }
  
  // 处理 "Launching skill:" 格式
  if (text.includes('Launching skill:')) {
    const skillNameMatch = text.match(/Launching skill: (.+)/);
    if (skillNameMatch) {
      return (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-success">OK</span>
            <span>Skill</span>
          </div>
          <div className="text-xs text-muted-foreground">
            Launching skill: <span className="font-mono">{skillNameMatch[1]}</span>
          </div>
        </div>
      );
    }
  }
  
  return text;
};

/**
 * 提取用户消息的纯文本内容
 */
const extractUserText = (message: ClaudeStreamMessage): string => {
  if (!message.message?.content) return '';
  
  const content = message.message.content;
  
  let text = '';
  
  // 如果是字符串，直接使用
  if (typeof content === 'string') {
    text = content;
  } 
  // 如果是数组，提取所有text类型的内容
  else if (Array.isArray(content)) {
    text = content
      .filter((item: any) => item.type === 'text')
      .map((item: any) => item.text || '')
      .join('\n');
  }
  
  // ⚡ 关键修复：JSONL 保存为 \\n（双反斜杠），需要替换为真正的换行
  // 正则 /\\\\n/ 匹配两个反斜杠+n
  if (text.includes('\\')) {
    text = text
      .replace(/\\\\n/g, '\n')      // \\n（双反斜杠+n）→ 换行符
      .replace(/\\\\r/g, '\r')      // \\r → 回车
      .replace(/\\\\t/g, '\t')      // \\t → 制表符
      .replace(/\\\\"/g, '"')       // \\" → 双引号
      .replace(/\\\\'/g, "'")       // \\' → 单引号
      .replace(/\\\\\\\\/g, '\\');  // \\\\ → 单个反斜杠（最后处理）
  }
  
  return text;
};

/**
 * 用户消息组件
 * 右对齐气泡样式，简洁展示
 * 🆕 支持长文本自动折叠（超过 5 行时折叠）
 */
export const UserMessage: React.FC<UserMessageProps> = ({
  message,
  className,
  promptIndex,
  sessionId,
  projectId,
  projectPath,
  onRevert
}) => {
  const { t } = useTranslation();
  const engine = (message as any).engine || 'claude';
  const text = extractUserText(message);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [capabilities, setCapabilities] = useState<RewindCapabilities | null>(null);
  const [isLoadingCapabilities, setIsLoadingCapabilities] = useState(false);

  // 🆕 折叠功能相关状态
  const [isExpanded, setIsExpanded] = useState(false);
  const [shouldCollapse, setShouldCollapse] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // 🆕 从 content 数组提取图片（base64 格式）
  const contentImages = useMemo(() => {
    const content = message.message?.content;
    if (!content || !Array.isArray(content)) return [];
    return extractImagesFromContent(content);
  }, [message]);

  // 🆕 从文本中提取图片路径（@path 格式）
  const { images: textImages, cleanText } = useMemo(() => {
    return extractImagePathsFromText(text);
  }, [text]);

  // 合并所有图片
  const images = useMemo(() => {
    return [...contentImages, ...textImages];
  }, [contentImages, textImages]);

  // 如果没有文本内容且没有图片，不渲染
  if (!text && images.length === 0) return null;

  // ⚡ 检查是否是 Skills 消息
  const isSkills = isSkillsMessage(text);
  // 🆕 检查是否是斜杠命令输出
  const isCommandOutput = isSlashCommandOutput(text);
  // 🆕 检查是否是斜杠命令输入（如 /cost, /help）- 不应显示撤回按钮
  const isSlashCommand = isSlashCommandInput(text);
  // 使用清理后的文本（移除图片路径），但特殊消息保持原样
  const displayContent = isSkills
    ? formatSkillsMessage(text)
    : isCommandOutput
    ? formatSlashCommandOutput(text)
    : (cleanText || text);

  // 🆕 计算是否需要折叠（超过 5 行）
  useEffect(() => {
    if (!contentRef.current || isSkills || isCommandOutput || !displayContent) {
      setShouldCollapse(false);
      return;
    }

    // 计算行数：使用清理后的文本
    const textToCheck = typeof displayContent === 'string' ? displayContent : text;
    const lines = textToCheck.split('\n').length;

    // 如果超过 5 行，需要折叠
    if (lines > 5) {
      setShouldCollapse(true);
    } else {
      setShouldCollapse(false);
    }
  }, [text, isSkills, isCommandOutput, displayContent]);

  // 检测撤回能力
  useEffect(() => {
    const loadCapabilities = async () => {
      if (promptIndex === undefined || !sessionId) return;
      if (engine === 'gemini' && !projectPath) return;
      if (engine !== 'codex' && engine !== 'gemini' && !projectId) return;

      setIsLoadingCapabilities(true);
      try {
        const caps = engine === 'codex'
          ? await api.checkCodexRewindCapabilities(sessionId, promptIndex)
          : engine === 'gemini'
          ? await api.checkGeminiRewindCapabilities(sessionId, projectPath!, promptIndex)
          : await api.checkRewindCapabilities(sessionId, projectId!, promptIndex);
        setCapabilities(caps);
      } catch (error) {
        console.error('Failed to check rewind capabilities:', error);
      } finally {
        setIsLoadingCapabilities(false);
      }
    };

    if (showConfirmDialog) {
      loadCapabilities();
    }
  }, [showConfirmDialog, promptIndex, sessionId, projectId, engine]);

  const handleRevertClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (promptIndex === undefined || !onRevert) return;
    setShowConfirmDialog(true);
  };

  const handleConfirmRevert = (mode: RewindMode) => {
    if (promptIndex !== undefined && onRevert) {
      setShowConfirmDialog(false);
      onRevert(promptIndex, mode);
    }
  };

  const showRevertButton = promptIndex !== undefined && promptIndex >= 0 && onRevert;
  const hasWarning = capabilities && !capabilities.code;

  return (
    <>
    <div
      id={promptIndex !== undefined ? `prompt-${promptIndex}` : undefined}
      className={cn("group relative", className)}
    >
      <div className="flex justify-end gap-4">
        <div className="relative flex-1 min-w-0 flex justify-end">
          <div className="relative max-w-full">
          <MessageBubble
            variant="user"
            sideContent={images.length > 0 && (
              <MessageImagePreview
                images={images}
                compact
              />
            )}
          >
            <div className="relative">
        {/* 消息头部 (Removed) */}
        {/* MessageHeader removed to save space */}

        {/* 消息内容和撤回按钮 - 优化布局，按钮悬浮在右下角 */}
        <div className="relative min-w-0">
          {/* Actions Toolbar - Visible on Hover (Left side for User messages) */}
          {!isSkills && !isCommandOutput && (
            <div className="absolute -top-2 left-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
              <MessageActions content={text} />
            </div>
          )}

          {/* 消息内容 */}
          <div className="w-full min-w-0">
            {/* 文本内容（只在有文本时显示） */}
            {displayContent && (
              <>
                <div
                  ref={contentRef}
                  className={cn(
                    "text-sm leading-relaxed",
                    (isSkills || isCommandOutput) ? "" : "whitespace-pre-wrap break-words",
                    // 折叠样式：未展开时限制为 5 行
                    shouldCollapse && !isExpanded && "line-clamp-5 overflow-hidden"
                  )}
                  style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
                >
                  {displayContent}
                  {/* 占位符，确保文字不遮挡绝对定位的按钮 */}
                  {showRevertButton && !isSkills && !isCommandOutput && !isSlashCommand && (
                    <span className="inline-block w-8 h-4 align-middle select-none" aria-hidden="true" />
                  )}
                </div>

                {/* 展开/收起按钮 */}
                {shouldCollapse && (
                  <button
                    onClick={() => setIsExpanded(!isExpanded)}
                  className="flex items-center gap-1 text-xs text-white/70 hover:text-white transition-colors mt-1"
                  >
                    {isExpanded ? (
                      <>
                        <ChevronUp className="h-3 w-3" />
                        <span>{t('message.collapse')}</span>
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-3 w-3" />
                        <span>{t('message.expand')}</span>
                      </>
                    )}
                  </button>
                )}
              </>
            )}
          </div>

          {/* 撤回按钮和警告图标 - Skills/命令输出/斜杠命令消息不显示撤回按钮 */}
          {showRevertButton && !isSkills && !isCommandOutput && !isSlashCommand && (
            <div className="absolute bottom-0 right-0 flex items-center justify-end gap-1">
              {/* CLI 提示词警告图标 */}
              {hasWarning && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center justify-center h-6 w-6">
                        <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs">
                      <p className="text-sm">
                        {capabilities?.warning || t('planMode.cannotRollbackCode')}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}

              {/* 撤回按钮 */}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 rounded-md text-white/45 hover:text-white hover:bg-white/10 transition-all"
                      onClick={handleRevertClick}
                    >
                      <Undo2 className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {t('message.revertToMessage')}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          )}
        </div>
        </div>
      </MessageBubble>
      
        </div>
        </div>

        {/* Right Column: User Avatar with Tooltip */}
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex-shrink-0 mt-0.5 select-none cursor-default">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--surface-hairline-soft)] bg-[var(--surface-panel-elevated)] text-[var(--text-soft)] transition-colors hover:bg-accent hover:text-foreground">
                  <User className="w-4 h-4" />
                </div>
              </div>
            </TooltipTrigger>
            {((message as any).sentAt || (message as any).timestamp) && (
              <TooltipContent side="left" className="text-[11px]">
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium">You</span>
                  <span className="text-muted-foreground">
                    {formatTimestamp((message as any).sentAt || (message as any).timestamp)}
                  </span>
                </div>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>

      {/* 撤回确认对话框 - 三模式选择 */}
      {showConfirmDialog && (
        <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-orange-600" />
                {t('planMode.selectRevertMode')}
              </DialogTitle>
              <DialogDescription>
                {t('planMode.revertToPrompt', { index: (promptIndex ?? 0) + 1 })}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {/* CLI 提示词警告 */}
              {capabilities?.warning && (
                <Alert className="border-orange-500/50 bg-orange-50 dark:bg-orange-950/20">
                  <AlertTriangle className="h-4 w-4 text-orange-600" />
                  <AlertDescription className="text-orange-800 dark:text-orange-200">
                    {capabilities.warning}
                  </AlertDescription>
                </Alert>
              )}

              {/* 加载中状态 */}
              {isLoadingCapabilities && (
                <div className="flex items-center justify-center py-4">
                  <div className="text-sm text-muted-foreground">{t('planMode.checkingCapabilities')}</div>
                </div>
              )}

              {/* 三种模式选择 */}
              {!isLoadingCapabilities && capabilities && (
                <div className="space-y-3">
                  <div className="text-sm font-medium">{t('planMode.selectRevertContent')}</div>

                  {/* 模式1: 仅对话 */}
                  <div className={cn(
                    "p-4 rounded-lg border-2 cursor-pointer transition-all duration-200",
                    "hover:border-primary hover:bg-accent/50 hover:shadow-md hover:scale-[1.02]",
                    "active:scale-[0.98]"
                  )}
                    onClick={() => handleConfirmRevert("conversation_only")}
                  >
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <div className="font-medium">{t('planMode.conversationOnly')}</div>
                        <div className="text-sm text-muted-foreground">
                          {t('planMode.conversationOnlyDesc')}
                        </div>
                      </div>
                      <div className="text-xs text-success font-medium bg-success/10 px-2 py-1 rounded">
                        {t('planMode.alwaysAvailable')}
                      </div>
                    </div>
                  </div>

                  {/* 模式2: 仅代码 */}
                  <div className={cn(
                    "p-4 rounded-lg border-2 transition-all duration-200",
                    capabilities.code
                      ? "cursor-pointer hover:border-primary hover:bg-accent/50 hover:shadow-md hover:scale-[1.02] active:scale-[0.98]"
                      : "opacity-50 cursor-not-allowed bg-muted"
                  )}
                    onClick={() => capabilities.code && handleConfirmRevert("code_only")}
                  >
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <div className="font-medium">{t('planMode.codeOnly')}</div>
                        <div className="text-sm text-muted-foreground">
                          {t('planMode.codeOnlyDesc')}
                        </div>
                      </div>
                      <div className={cn(
                        "text-xs font-medium px-2 py-1 rounded",
                        capabilities.code
                          ? "text-success bg-success/10"
                          : "text-muted-foreground bg-muted"
                      )}>
                        {capabilities.code ? t('planMode.available') : t('planMode.unavailable')}
                      </div>
                    </div>
                  </div>

                  {/* 模式3: 两者都撤回 */}
                  <div className={cn(
                    "p-4 rounded-lg border-2 transition-all duration-200",
                    capabilities.both
                      ? "cursor-pointer hover:border-primary hover:bg-accent/50 hover:shadow-md hover:scale-[1.02] active:scale-[0.98]"
                      : "opacity-50 cursor-not-allowed bg-muted"
                  )}
                    onClick={() => capabilities.both && handleConfirmRevert("both")}
                  >
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <div className="font-medium">{t('planMode.fullRevert')}</div>
                        <div className="text-sm text-muted-foreground">
                          {t('planMode.fullRevertDesc')}
                        </div>
                      </div>
                      <div className={cn(
                        "text-xs font-medium px-2 py-1 rounded",
                        capabilities.both
                          ? "text-success bg-success/10"
                          : "text-muted-foreground bg-muted"
                      )}>
                        {capabilities.both ? t('planMode.available') : t('planMode.unavailable')}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <strong>{t('planMode.revertWarning').split('：')[0]}：</strong>{t('planMode.revertWarning').split('：')[1]}
                </AlertDescription>
              </Alert>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowConfirmDialog(false)}
              >
                {t('buttons.cancel')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
};
