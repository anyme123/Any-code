import React, { useState, useEffect, useRef, useCallback } from "react";
import { BrainCircuit, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTypewriter } from "@/hooks/useTypewriter";
import { useTranslation } from "@/hooks/useTranslation";

interface ThinkingBlockProps {
  /** 思考内容 */
  content: string;
  /** 是否正在流式输出 */
  isStreaming?: boolean;
  /** 自动收起延迟（毫秒），默认 2500ms */
  autoCollapseDelay?: number;
  /** 打字机速度（毫秒/字符） */
  typewriterSpeed?: number;
}

/**
 * 思考块组件
 *
 * 功能：
 * - 打字机效果逐字显示思考内容
 * - 默认展开状态
 * - 思考输出结束后自动收起（可配置延迟）
 * - 支持手动展开/收起
 */
export const ThinkingBlock: React.FC<ThinkingBlockProps> = ({
  content,
  isStreaming = false,
  autoCollapseDelay = 2500,
  typewriterSpeed = 5 // 思考内容通常较长，稍快一些
}) => {
  const { t } = useTranslation();
  // 展开/收起状态 - 默认展开
  const [isOpen, setIsOpen] = useState(true);

  // 是否已经完成过自动收起（避免重复触发）
  const hasAutoCollapsedRef = useRef(false);

  // 是否用户手动操作过（手动操作后不再自动收起）
  const userInteractedRef = useRef(false);

  // 打字机效果完成回调
  const handleTypewriterComplete = useCallback(() => {
    // 如果用户已手动操作，不自动收起
    if (userInteractedRef.current) return;

    // 如果已经自动收起过，不重复
    if (hasAutoCollapsedRef.current) return;

    // 延迟后自动收起
    const timer = setTimeout(() => {
      if (!userInteractedRef.current) {
        setIsOpen(false);
        hasAutoCollapsedRef.current = true;
      }
    }, autoCollapseDelay);

    return () => clearTimeout(timer);
  }, [autoCollapseDelay]);

  // 使用打字机效果
  const {
    displayedText,
    isTyping,
    skipToEnd
  } = useTypewriter(content, {
    enabled: isStreaming,
    speed: typewriterSpeed,
    isStreaming,
    onComplete: handleTypewriterComplete
  });

  // 显示的文本内容
  const textToDisplay = isStreaming ? displayedText : content;
  
  // 处理分割符：将 ---divider--- 替换为可视化的分割线组件
  // 如果内容中包含分割符，说明是聚合后的多段思考
  const renderContent = () => {
    // 移除用于打字机计算的分割符干扰（虽然 useTypewriter 可能已经处理了纯文本）
    // 但在渲染阶段，我们需要将 textToDisplay 按分割符切分
    const parts = textToDisplay.split('---divider---');
    
    if (parts.length === 1) {
      return (
        <>
          {textToDisplay}
          {/* 打字中光标 */}
          {isTyping && (
            <span className="inline-block w-1 h-3 ml-0.5 bg-primary animate-pulse rounded-sm" />
          )}
        </>
      );
    }
    
    return parts.map((part, index) => (
      <React.Fragment key={index}>
        {index > 0 && (
          <div className="flex items-center gap-2 my-3 opacity-60 select-none">
            <div className="h-px bg-primary/30 flex-1" />
            <div className="text-[10px] text-primary/70 font-mono">STEP {index + 1}</div>
            <div className="h-px bg-primary/30 flex-1" />
          </div>
        )}
        <span>{part.trim()}</span>
        {/* 只在最后一部分且正在打字时显示光标 */}
        {index === parts.length - 1 && isTyping && (
          <span className="inline-block w-1 h-3 ml-0.5 bg-primary animate-pulse rounded-sm" />
        )}
      </React.Fragment>
    ));
  };

  // 如果不是流式输出且内容已经存在（历史消息），直接标记为已完成
  useEffect(() => {
    if (!isStreaming && content && !hasAutoCollapsedRef.current) {
      // 历史消息，默认收起
      setIsOpen(false);
      hasAutoCollapsedRef.current = true;
    }
  }, [isStreaming, content]);

  // 用户点击切换展开/收起
  const handleToggle = () => {
    userInteractedRef.current = true;
    setIsOpen(prev => !prev);
  };

  // 双击跳过打字效果
  const handleDoubleClick = useCallback(() => {
    if (isTyping) {
      skipToEnd();
    }
  }, [isTyping, skipToEnd]);

  if (!content) return null;

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-[var(--surface-hairline-soft)] bg-[var(--surface-code)]">
      {/* Header - 可点击切换 */}
      <button
        onClick={handleToggle}
        className="w-full cursor-pointer px-3 py-2 text-xs text-primary font-medium hover:bg-primary/10 transition-colors select-none flex items-center gap-2 outline-none text-left"
      >
        <BrainCircuit className="w-3.5 h-3.5 opacity-70" />
        <span>Thinking Process</span>

        {/* 打字中指示器 */}
        {isTyping && (
          <span className="inline-block w-1.5 h-3 bg-primary animate-pulse rounded-full" />
        )}

        <span className="ml-auto flex items-center gap-2">
          <span className="text-[10px] opacity-60">
            {content.length} chars
          </span>
          <ChevronDown
            className={cn(
              "w-3.5 h-3.5 opacity-60 transition-transform duration-200",
              isOpen ? "rotate-180" : ""
            )}
          />
        </span>
      </button>

      {/* Content - 可展开/收起 */}
      <div
        className={cn(
          "overflow-hidden transition-all duration-300 ease-in-out",
          isOpen ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0"
        )}
      >
        <div
          className="px-3 pb-3 pt-1"
          onDoubleClick={handleDoubleClick}
          title={isTyping ? t('thinking.doubleClickSkip') : undefined}
        >
          <div className="text-xs text-muted-foreground/80 whitespace-pre-wrap font-mono leading-relaxed max-h-[400px] overflow-y-auto">
            {renderContent()}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ThinkingBlock;
