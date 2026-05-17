import React, { memo, useEffect, useRef, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { getClaudeSyntaxTheme } from "@/lib/claudeSyntaxTheme";
import { useTheme } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";
import { copyTextToClipboard } from "@/lib/clipboard";
import { useTypewriter } from "@/hooks/useTypewriter";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { checkSyntaxHighlightSupport } from "@/lib/syntaxHighlightCompat";

interface CodeBlockRendererProps {
  language: string;
  code: string;
  syntaxTheme: any;
}

/**
 * 纯文本代码块 Fallback 组件（提取重复代码）
 */
interface PlainTextCodeBlockProps {
  language: string;
  code: string;
  copyState: 'idle' | 'success' | 'error';
  onCopy: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

const PlainTextCodeBlock: React.FC<PlainTextCodeBlockProps> = ({
  language,
  code,
  copyState,
  onCopy
}) => {
  const buttonLabel =
    copyState === 'success' ? '已复制!' : copyState === 'error' ? '复制失败' : '复制';

  return (
    <div className="command-surface my-3 overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--surface-hairline-soft)] px-3 py-1.5 bg-[var(--surface-panel-muted)]">
        <span className="text-xs font-mono text-muted-foreground">
          {language} (Plain Text - 浏览器不支持语法高亮)
        </span>
        <button
          onClick={onCopy}
          className={cn(
            "text-xs px-2 py-0.5 rounded-md transition-colors",
            "bg-[var(--surface-panel)] hover:bg-accent",
            copyState === 'success' && "text-success bg-success/10",
            copyState === 'error' && "text-destructive bg-destructive/10"
          )}
        >
          {buttonLabel}
        </button>
      </div>
      <pre className="p-3 text-xs font-mono overflow-auto text-foreground/80 whitespace-pre-wrap break-words" style={{ overflowWrap: 'anywhere' }}>
        {code}
      </pre>
    </div>
  );
};

const CodeBlockRenderer: React.FC<CodeBlockRendererProps> = ({ language, code, syntaxTheme }) => {
  const [copyState, setCopyState] = useState<'idle' | 'success' | 'error'>('idle');
  const [supportsSyntaxHighlight] = useState(() => checkSyntaxHighlightSupport());
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (!code) {
      return;
    }

    if (resetTimerRef.current) {
      window.clearTimeout(resetTimerRef.current);
    }

    try {
      await copyTextToClipboard(code);
      setCopyState('success');
    } catch (error) {
      console.error('[CodeBlock] Copy failed:', error);
      setCopyState('error');
    } finally {
      resetTimerRef.current = window.setTimeout(() => setCopyState('idle'), 2000);
    }
  }, [code]);

  const buttonLabel =
    copyState === 'success' ? '已复制!' : copyState === 'error' ? '复制失败' : '复制';

  // 如果浏览器不支持语法高亮所需特性，降级为纯文本显示
  if (!supportsSyntaxHighlight) {
    return (
      <PlainTextCodeBlock
        language={language}
        code={code}
        copyState={copyState}
        onCopy={handleCopy}
      />
    );
  }

  // 渲染语法高亮代码块
  return (
    <div className="command-surface relative group my-3 overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--surface-hairline-soft)] px-3 py-1.5 bg-[var(--surface-panel-muted)] backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-muted-foreground opacity-70">
            {language}
          </span>
        </div>
        <button
          onClick={handleCopy}
          className={cn(
            "text-xs px-2 py-0.5 rounded-md transition-all duration-200 opacity-0 group-hover:opacity-100",
            "bg-[var(--surface-panel)] hover:bg-accent",
            copyState === 'success' && "text-success bg-success/10",
            copyState === 'error' && "text-destructive bg-destructive/10"
          )}
        >
          {buttonLabel}
        </button>
      </div>

      <div className="relative">
        <SyntaxHighlighter
          style={syntaxTheme}
          language={language}
          PreTag="div"
          showLineNumbers={true}
          wrapLines={true}
          customStyle={{
            margin: 0,
            padding: '0.9rem',
            background: 'transparent',
            lineHeight: '1.55',
            fontSize: '0.8rem',
          }}
          lineNumberStyle={{
            minWidth: '2.5em',
            paddingRight: '1em',
            color: 'var(--color-muted-foreground)',
            opacity: 0.5,
            textAlign: 'right',
          }}
          codeTagProps={{
            style: {
              fontFamily: 'var(--font-mono)',
              fontVariantLigatures: 'none',
            }
          }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  );
};

interface MessageContentProps {
  /** Markdown内容 */
  content: string;
  /** 自定义类名 */
  className?: string;
  /** 是否正在流式输出 */
  isStreaming?: boolean;
  /** 是否启用打字机效果 */
  enableTypewriter?: boolean;
  /** 打字机速度（毫秒/字符） */
  typewriterSpeed?: number;
  /** 打字机效果完成回调 */
  onTypewriterComplete?: () => void;
}

/**
 * 消息内容渲染组件
 * 支持Markdown + 代码高亮 + 打字机效果
 */
const MessageContentComponent: React.FC<MessageContentProps> = ({
  content,
  className,
  isStreaming = false,
  enableTypewriter = true,
  typewriterSpeed = 8,
  onTypewriterComplete
}) => {
  const { theme } = useTheme();
  const syntaxTheme = getClaudeSyntaxTheme(theme === 'dark');

  // 判断是否应该启用打字机效果
  const shouldEnableTypewriter = enableTypewriter && isStreaming;

  // 使用打字机效果
  const {
    displayedText,
    isTyping,
    skipToEnd
  } = useTypewriter(content, {
    enabled: shouldEnableTypewriter,
    speed: typewriterSpeed,
    isStreaming,
    onComplete: onTypewriterComplete
  });

  // 决定显示的内容：打字机效果启用时使用 displayedText，否则直接显示全部
  const textToDisplay = shouldEnableTypewriter ? displayedText : content;

  // 双击跳过打字机效果
  const handleDoubleClick = useCallback(() => {
    if (isTyping) {
      skipToEnd();
    }
  }, [isTyping, skipToEnd]);

  return (
    <div
      className={cn(
        "prose prose-sm dark:prose-invert max-w-none break-words",
        "prose-headings:font-semibold prose-headings:tracking-normal",
        "prose-p:leading-relaxed prose-p:text-foreground/90",
        "prose-a:text-primary prose-a:no-underline prose-a:border-b prose-a:border-primary/30 hover:prose-a:border-primary prose-a:transition-colors",
        "prose-blockquote:border-l-4 prose-blockquote:border-primary/20 prose-blockquote:bg-muted/30 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:rounded-r-lg prose-blockquote:not-italic",
        "prose-ul:list-disc prose-ul:pl-6",
        "prose-ol:list-decimal prose-ol:pl-6",
        "prose-li:marker:text-muted-foreground",
        "prose-hr:border-border/50 prose-hr:my-8",
        className
      )}
      style={{ overflowWrap: 'anywhere' }}
      onDoubleClick={handleDoubleClick}
      title={isTyping ? "双击跳过打字效果" : undefined}
    >
      <ErrorBoundary
        onError={(error) => {
          console.error('[MessageContent] Markdown rendering error:', error);
        }}
        fallback={(error) => (
          <div className="p-4 rounded-md border border-destructive/20 bg-destructive/5 my-2">
            <p className="text-sm font-medium text-destructive mb-2">
              渲染内容时出错 (Markdown/Syntax Highlighting)
            </p>
            <pre className="text-xs font-mono whitespace-pre-wrap break-words text-muted-foreground bg-background/50 p-2 rounded max-h-[200px] overflow-y-auto" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
              {textToDisplay}
            </pre>
            <details className="mt-2">
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                错误详情
              </summary>
              <p className="text-xs text-destructive mt-1 font-mono">
                {error.message}
              </p>
            </details>
          </div>
        )}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            // 代码块渲染
            code(props: any) {
              const { inline, className, children, ...rest } = props;
              const match = /language-(\w+)/.exec(className || '');
              const language = match ? match[1] : '';

              if (inline || !language) {
                return (
                  <code
                    className={cn(
                      "px-1.5 py-0.5 rounded-md bg-muted/50 border border-border/50 text-xs font-mono text-foreground/80",
                      className
                    )}
                    {...rest}
                  >
                    {children}
                  </code>
                );
              }

              const code = String(children).replace(/\n$/, '');
              
              // 再次包裹 ErrorBoundary 以捕获 SyntaxHighlighter 特有的正则错误
              return (
                <ErrorBoundary
                  fallback={() => (
                    <div className="my-3 rounded-lg overflow-hidden bg-muted/20 border border-border/50">
                      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/30">
                        <span className="text-xs font-mono text-muted-foreground">{language} (Plain Text)</span>
                      </div>
                      <pre className="p-3 text-xs font-mono overflow-auto text-foreground/80 whitespace-pre-wrap break-words" style={{ overflowWrap: 'anywhere' }}>
                        {code}
                      </pre>
                    </div>
                  )}
                >
                  <CodeBlockRenderer
                    language={language}
                    code={code}
                    syntaxTheme={syntaxTheme}
                  />
                </ErrorBoundary>
              );
            },

            // 链接渲染
          a({ node, children, href, ...props }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary hover:text-primary/80 transition-colors"
                {...props}
              >
                {children}
              </a>
            );
          },

          // 表格渲染
          table({ node, children, ...props }) {
            return (
              <div className="overflow-x-auto my-6 rounded-lg border border-border/50 shadow-sm">
                <table className="min-w-full divide-y divide-border/50 bg-card/30" {...props}>
                  {children}
                </table>
              </div>
            );
          },

          thead({ node, children, ...props }) {
            return (
              <thead className="bg-muted/50" {...props}>
                {children}
              </thead>
            );
          },

          th({ node, children, ...props }) {
            return (
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-normal" {...props}>
                {children}
              </th>
            );
          },

          td({ node, children, ...props }) {
            return (
              <td className="px-4 py-3 text-sm text-foreground/80 whitespace-nowrap" {...props}>
                {children}
              </td>
            );
          },
        }}
      >
        {textToDisplay}
      </ReactMarkdown>
      </ErrorBoundary>

      {/* 流式输出光标指示器 - 只在打字中或流式输出时显示 */}
      {(isStreaming || isTyping) && (
        <span
          className={cn(
            "inline-block w-1.5 h-4 ml-1 rounded-full",
            isTyping
              ? "bg-primary animate-pulse"
              : "bg-primary/50 animate-pulse"
          )}
        />
      )}
    </div>
  );
};

MessageContentComponent.displayName = "MessageContent";

export const MessageContent = memo(MessageContentComponent);
