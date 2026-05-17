/**
 * AskUserQuestion Widget - 用户问题询问展示
 *
 * V4 改进版本：
 * - 添加折叠/展开功能
 * - 优化UI布局，更紧凑的设计
 * - 在选项上直接显示用户的选择（高亮）
 * - 完全隐藏底部的result.content冗余信息
 * - 添加问题统计信息
 * - 🆕 自动触发交互式对话框（未回答时）
 */

import React, { useState, useMemo, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { HelpCircle, CheckCircle, MessageCircle, ChevronDown, ChevronUp, Check, MousePointerClick } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useUserQuestion, getQuestionId } from "@/contexts/UserQuestionContext";

export interface AskUserQuestionWidgetProps {
  /** 问题列表 */
  questions?: Array<{
    /** 问题文本 */
    question: string;
    /** 问题头部（简短标签） */
    header?: string;
    /** 选项列表 */
    options?: Array<{
      label: string;
      description?: string;
    }>;
    /** 是否支持多选 */
    multiSelect?: boolean;
  }>;
  /** 用户答案 */
  answers?: Record<string, string | string[]>;
  /** 工具执行结果 */
  result?: {
    content?: any;
    is_error?: boolean;
  };
}

/**
 * 检查选项是否被选中
 */
function isOptionSelected(
  optionLabel: string,
  answer: string | string[] | undefined
): boolean {
  if (!answer) return false;

  if (Array.isArray(answer)) {
    // 多选：检查是否在数组中
    return answer.some(a =>
      optionLabel.toLowerCase().includes(a.toLowerCase()) ||
      a.toLowerCase().includes(optionLabel.toLowerCase())
    );
  } else {
    // 单选：检查是否匹配
    return optionLabel.toLowerCase().includes(answer.toLowerCase()) ||
           answer.toLowerCase().includes(optionLabel.toLowerCase());
  }
}

/**
 * AskUserQuestion Widget V3
 *
 * 展示 Claude 向用户提问的内容和用户的回答
 * 支持折叠/展开功能，在选项上直接显示选中状态
 */
export const AskUserQuestionWidget: React.FC<AskUserQuestionWidgetProps> = ({
  questions = [],
  answers = {},
  result,
}) => {
  const { t } = useTranslation();
  const isError = result?.is_error;
  const hasAnswers = Object.keys(answers).length > 0;

  // 折叠状态：已回答时默认折叠，未回答时默认展开
  const [isCollapsed, setIsCollapsed] = useState(hasAnswers);
  const hasTriggered = useRef(false);

  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  // 🆕 尝试获取 UserQuestion Context
  let triggerQuestionDialog: ((questions: any[]) => void) | undefined;
  let isQuestionAnswered: ((questionId: string) => boolean) | undefined;

  try {
    const userQuestionContext = useUserQuestion();
    triggerQuestionDialog = userQuestionContext.triggerQuestionDialog;
    isQuestionAnswered = userQuestionContext.isQuestionAnswered;
  } catch {
    // Context 不可用时忽略（组件可能在 Provider 外部渲染）
  }

  // 计算问题 ID
  const questionId = useMemo(() => {
    return questions.length > 0 ? getQuestionId(questions) : null;
  }, [questions]);

  // 检查是否已回答
  const answered = questionId && isQuestionAnswered ? isQuestionAnswered(questionId) : false;

  // 🆕 自动触发问答对话框（仅在有问题且未回答时）
  useEffect(() => {
    if (
      questions.length > 0 &&
      !hasAnswers &&
      !answered &&
      triggerQuestionDialog &&
      !hasTriggered.current &&
      !isError &&
      !result // 如果已有结果，不再触发
    ) {
      hasTriggered.current = true;
      // 延迟触发，确保 UI 已渲染
      const timer = setTimeout(() => {
        triggerQuestionDialog(questions);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [questions, hasAnswers, answered, triggerQuestionDialog, isError, result]);

  // 🆕 手动重新打开问答对话框（修复 Plan 模式下自动触发失效问题 #176）
  const handleManualTrigger = () => {
    if (triggerQuestionDialog && questions.length > 0) {
      // 重置触发标记，允许再次触发
      hasTriggered.current = false;
      triggerQuestionDialog(questions);
    }
  };

  // 解析answers - 可能在result.content中以字符串格式存储
  const parsedAnswers = useMemo(() => {
    // 如果answers不为空，直接使用
    if (Object.keys(answers).length > 0) {
      return answers;
    }

    // 尝试从result.content解析
    if (result?.content) {
      const content = result.content;

      // 如果content是字符串，尝试解析 "问题？"="答案" 格式
      if (typeof content === 'string') {
        const parsed: Record<string, string> = {};

        // 正则：匹配格式 "问题？"="答案"
        // 注意：问号可能是中文全角？或英文半角?
        const regex = /"([^"]+[？?])"="([^"]+)"/g;
        const matches = content.matchAll(regex);

        for (const match of matches) {
          const question = match[1].trim(); // 问题部分（包含问号）
          const answer = match[2].trim();   // 答案部分
          parsed[question] = answer;
        }

        return parsed;
      }

      // 如果content.answers存在
      if (content.answers) {
        return content.answers;
      }
    }

    return {};
  }, [answers, result]);

  // 构建问题到答案的映射
  const questionAnswerMap = useMemo(() => {
    const map = new Map<string, string | string[]>();

    questions.forEach((q) => {
      // 尝试多种方式匹配答案
      const possibleKeys = [
        q.question,                    // 使用完整问题文本作为key（最常见）
        q.question.replace(/\?$/, ''), // 去掉问号
        q.question.replace(/\s+/g, ' ').trim(), // 标准化空格
        q.header,                      // 使用header作为key
      ].filter(Boolean);

      for (const key of possibleKeys) {
        if (key && parsedAnswers[key]) {
          map.set(q.header || q.question, parsedAnswers[key]);
          break;
        }
      }

      // 如果仍然没匹配到，尝试模糊匹配
      if (!map.has(q.header || q.question)) {
        const questionText = q.question.toLowerCase();
        for (const [answerKey, answerValue] of Object.entries(parsedAnswers)) {
          const keyLower = answerKey.toLowerCase();
          // 检查问题文本的前30个字符是否匹配
          if (questionText.substring(0, 30) === keyLower.substring(0, 30)) {
            map.set(q.header || q.question, answerValue as string | string[]);
            break;
          }
        }
      }
    });

    return map;
  }, [questions, parsedAnswers]);

  return (
    <div
      className={cn(
        "rounded-lg border overflow-hidden",
        isError
          ? "border-destructive/20 bg-destructive/5"
          : hasAnswers
            ? "border-green-500/20 bg-green-500/5"
            : "border-blue-500/20 bg-blue-500/5"
      )}
    >
      {/* 头部：可点击折叠/展开 */}
      <div
        className="px-4 py-3 flex items-start gap-3 cursor-pointer hover:bg-background/30 transition-colors"
        onClick={toggleCollapse}
      >
        {/* 图标 */}
        <div className="mt-0.5">
          <div
            className={cn(
              "h-8 w-8 rounded-full flex items-center justify-center",
              isError
                ? "bg-destructive/10"
                : hasAnswers
                  ? "bg-green-500/20"
                  : "bg-blue-500/10"
            )}
          >
            {hasAnswers ? (
              <CheckCircle
                className={cn(
                  "h-4 w-4",
                  isError ? "text-destructive" : "text-green-600"
                )}
              />
            ) : (
              <HelpCircle className="h-4 w-4 text-blue-500" />
            )}
          </div>
        </div>

        {/* 标题和摘要 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "text-xs font-medium",
                  isError
                    ? "text-destructive"
                    : hasAnswers
                      ? "text-green-600"
                      : "text-blue-500"
                )}
              >
                {hasAnswers ? t('widget.userAnswered') : t('widget.claudeAsking')}
              </span>
              {questions.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {t('widget.questionsCount', { count: questions.length })}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1">
              {/* 手动触发对话框（修复 #176 Plan 模式下自动弹窗失效） */}
              {!hasAnswers && !answered && !isError && triggerQuestionDialog && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs gap-1 text-blue-600 hover:text-blue-700 hover:bg-blue-500/10"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleManualTrigger();
                  }}
                  title="重新打开问答对话框"
                >
                  <MousePointerClick className="h-3 w-3" />
                  回答
                </Button>
              )}

              {/* 折叠按钮 */}
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleCollapse();
                }}
              >
                {isCollapsed ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronUp className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          {/* 折叠时显示的简要信息 */}
          {isCollapsed && hasAnswers && (
            <div className="mt-1 text-xs text-muted-foreground truncate">
              {Object.entries(answers).slice(0, 2).map(([key, value]) => {
                const displayValue = Array.isArray(value) ? value.join(", ") : value;
                return `${key}: ${displayValue}`;
              }).join(" | ")}
              {Object.keys(answers).length > 2 && ` +${Object.keys(answers).length - 2}...`}
            </div>
          )}
        </div>
      </div>

      {/* 展开的内容 */}
      {!isCollapsed && (
        <div className="px-4 pb-3 space-y-3 border-t border-border/30">
          {/* 问题列表 */}
          {questions.length > 0 && (
            <div className="space-y-2 pt-3">
              {questions.map((q, qIndex) => {
                // 获取这个问题的答案
                const questionKey = q.header || q.question;
                const answer = questionAnswerMap.get(questionKey);
                const hasAnswer = !!answer;

                return (
                  <div
                    key={qIndex}
                    className={cn(
                      "p-3 rounded-md border space-y-2",
                      hasAnswer
                        ? "bg-green-500/5 border-green-500/20"
                        : "bg-background/50 border-border/50"
                    )}
                  >
                    {/* 问题文本 */}
                    <div className="flex items-start gap-2">
                      <MessageCircle className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        {q.header && (
                          <div className="text-xs font-medium text-primary mb-1 flex items-center gap-2">
                            <span>{q.header}</span>
                            {hasAnswer && (
                              <CheckCircle className="h-3 w-3 text-green-600" />
                            )}
                          </div>
                        )}
                        <div className="text-sm text-foreground">{q.question}</div>
                      </div>
                    </div>

                    {/* 选项列表 */}
                    {q.options && q.options.length > 0 && (
                      <div className="pl-6 space-y-1.5">
                        {q.options.map((option, optIndex) => {
                          const isSelected = isOptionSelected(option.label, answer);

                          return (
                            <div
                              key={optIndex}
                              className={cn(
                                "text-xs p-2.5 rounded-md transition-all relative",
                                isSelected
                                  ? "bg-green-500/15 border-2 border-green-500/40 shadow-md"
                                  : "bg-muted/30 hover:bg-muted/50 border border-transparent"
                              )}
                            >
                              <div className="flex items-start gap-2.5">
                                {/* 选中徽章 */}
                                {isSelected ? (
                                  <div className="flex-shrink-0 h-5 w-5 rounded-full bg-green-500 flex items-center justify-center shadow-sm">
                                    <Check className="h-3.5 w-3.5 text-white font-bold" strokeWidth={3} />
                                  </div>
                                ) : (
                                  <div className="flex-shrink-0 h-5 w-5 rounded-full border-2 border-muted-foreground/30 bg-background" />
                                )}
                                <div className="flex-1 pt-0.5">
                                  <div className="flex items-center gap-2">
                                    <div
                                      className={cn(
                                        "font-medium",
                                        isSelected
                                          ? "text-green-700 dark:text-green-300"
                                          : "text-foreground"
                                      )}
                                    >
                                      {option.label}
                                    </div>
                                    {/* 选中标签 */}
                                    {isSelected && (
                                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-green-500 text-white shadow-sm">
                                        {t('widget.selected')}
                                      </span>
                                    )}
                                  </div>
                                  {option.description && (
                                    <div
                                      className={cn(
                                        "mt-0.5",
                                        isSelected
                                          ? "text-green-600 dark:text-green-400"
                                          : "text-muted-foreground"
                                      )}
                                    >
                                      {option.description}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        {q.multiSelect && (
                          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                            <span className="text-blue-500">ℹ️</span>
                            <span>{t('widget.multipleChoice')}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* 错误信息 */}
          {isError && result?.content && (
            <div className="p-2 rounded bg-destructive/10 text-xs text-destructive">
              {typeof result.content === "string"
                ? result.content
                : JSON.stringify(result.content)}
            </div>
          )}

          {/* 完全隐藏result.content，因为答案已经在选项上显示 */}
        </div>
      )}
    </div>
  );
};
