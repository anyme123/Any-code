/**
 * AskUserQuestionDialog - 用户问答对话框
 *
 * 当 Claude 调用 AskUserQuestion 工具时显示此对话框
 * 让用户选择答案，确认后自动发送给 Claude
 *
 * 参考：PlanApprovalDialog 的实现模式
 */

import { useState, useMemo } from "react";
import { HelpCircle, Send, XCircle, CheckCircle, Info } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { Question, UserAnswers } from "@/contexts/UserQuestionContext";

export interface AskUserQuestionDialogProps {
  /** 是否显示对话框 */
  open: boolean;
  /** 问题列表 */
  questions: Question[];
  /** 关闭对话框 */
  onClose: () => void;
  /** 提交答案 */
  onSubmit: (answers: UserAnswers) => void;
}

/**
 * 用户问答对话框
 */
export function AskUserQuestionDialog({
  open,
  questions,
  onClose,
  onSubmit,
}: AskUserQuestionDialogProps) {
  // 用户选择的答案
  const [selectedAnswers, setSelectedAnswers] = useState<UserAnswers>({});

  // 处理单选
  const handleSingleSelect = (questionKey: string, optionLabel: string) => {
    setSelectedAnswers(prev => ({
      ...prev,
      [questionKey]: optionLabel,
    }));
  };

  // 处理多选
  const handleMultiSelect = (questionKey: string, optionLabel: string, checked: boolean) => {
    setSelectedAnswers(prev => {
      const current = prev[questionKey];
      const currentArray = Array.isArray(current) ? current : [];

      if (checked) {
        // 添加到数组
        return {
          ...prev,
          [questionKey]: [...currentArray, optionLabel],
        };
      } else {
        // 从数组移除
        return {
          ...prev,
          [questionKey]: currentArray.filter(item => item !== optionLabel),
        };
      }
    });
  };

  // 检查选项是否被选中
  const isOptionSelected = (questionKey: string, optionLabel: string): boolean => {
    const answer = selectedAnswers[questionKey];
    if (!answer) return false;

    if (Array.isArray(answer)) {
      return answer.includes(optionLabel);
    } else {
      return answer === optionLabel;
    }
  };

  // 检查是否所有问题都已回答
  const allAnswered = useMemo(() => {
    return questions.every(q => {
      const key = q.header || q.question;
      const answer = selectedAnswers[key];
      if (Array.isArray(answer)) {
        return answer.length > 0;
      }
      return !!answer;
    });
  }, [questions, selectedAnswers]);

  // 提交答案
  const handleSubmit = () => {
    if (!allAnswered) return;
    onSubmit(selectedAnswers);
    onClose();
    // 重置选择
    setSelectedAnswers({});
  };

  // 关闭对话框
  const handleClose = () => {
    onClose();
    // 保留选择，用户可能稍后继续
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="h-10 w-10 rounded-full bg-info/10 flex items-center justify-center">
              <HelpCircle className="h-5 w-5 text-info" />
            </div>
            <div>
              <DialogTitle className="text-lg">Claude 正在询问你</DialogTitle>
              <DialogDescription>
                请回答以下问题，Claude 将根据你的答案继续执行
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* 问题列表 */}
        <div className="flex-1 min-h-0 my-4">
          <ScrollArea className="h-[400px]">
            <div className="space-y-4 pr-4">
              {questions.map((q, qIndex) => {
                const questionKey = q.header || q.question;
                const hasAnswer = !!selectedAnswers[questionKey];

                return (
                  <div
                    key={qIndex}
                    className={cn(
                      "p-4 rounded-lg border space-y-3 transition-all",
                      hasAnswer
                        ? "border-green-500/30 bg-green-500/5"
                        : "border-border bg-muted/20"
                    )}
                  >
                    {/* 问题头部 */}
                    <div className="flex items-start gap-2">
                      <div className="flex-shrink-0 mt-0.5">
                        {hasAnswer ? (
                          <div className="h-5 w-5 rounded-full bg-green-500 flex items-center justify-center">
                            <CheckCircle className="h-3 w-3 text-white" />
                          </div>
                        ) : (
                          <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30 bg-background" />
                        )}
                      </div>
                      <div className="flex-1">
                        {q.header && (
                          <div className="text-sm font-semibold text-primary mb-1">
                            {q.header}
                          </div>
                        )}
                        <div className="text-sm text-foreground">{q.question}</div>
                      </div>
                    </div>

                    {/* 选项列表 */}
                    {q.options && q.options.length > 0 && (
                      <div className="space-y-2 pl-7">
                        {q.options.map((option, optIndex) => {
                          const isSelected = isOptionSelected(questionKey, option.label);

                          return (
                            <div
                              key={optIndex}
                              className={cn(
                                "p-3 rounded-md border cursor-pointer transition-all hover:shadow-sm",
                                isSelected
                                  ? "border-green-500/40 bg-green-500/10 shadow-sm"
                                  : "border-border/50 bg-background hover:bg-muted/50"
                              )}
                              onClick={() => {
                                if (q.multiSelect) {
                                  handleMultiSelect(questionKey, option.label, !isSelected);
                                } else {
                                  handleSingleSelect(questionKey, option.label);
                                }
                              }}
                            >
                              <div className="flex items-start gap-2.5">
                                {/* 选择图标 */}
                                {q.multiSelect ? (
                                  <Checkbox
                                    checked={isSelected}
                                    onCheckedChange={(checked) =>
                                      handleMultiSelect(questionKey, option.label, checked as boolean)
                                    }
                                    className="mt-0.5"
                                  />
                                ) : (
                                  <div
                                    className={cn(
                                      "flex-shrink-0 h-5 w-5 rounded-full border-2 flex items-center justify-center transition-all",
                                      isSelected
                                        ? "bg-green-500 border-green-500"
                                        : "border-muted-foreground/30 bg-background"
                                    )}
                                  >
                                    {isSelected && (
                                      <div className="h-2 w-2 rounded-full bg-white" />
                                    )}
                                  </div>
                                )}

                                {/* 选项内容 */}
                                <div className="flex-1 pt-0.5">
                                  <div
                                    className={cn(
                                      "text-sm font-medium mb-0.5",
                                      isSelected ? "text-success" : "text-foreground"
                                    )}
                                  >
                                    {option.label}
                                  </div>
                                  {option.description && (
                                    <div
                                      className={cn(
                                        "text-xs",
                                        isSelected
                                          ? "text-success"
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

                        {/* 多选提示 */}
                        {q.multiSelect && (
                          <div className="text-xs text-muted-foreground flex items-center gap-1 mt-2">
                            <Info className="h-4 w-4 text-info" />
                            <span>可以选择多个选项</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </div>

        {/* 提示信息 */}
        <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3 mb-4">
          <p className="font-medium mb-1">提示：</p>
          <ul className="list-disc list-inside space-y-1">
            <li>请为每个问题选择一个或多个选项</li>
            <li>点击<strong>提交答案</strong>后，你的选择将发送给 Claude</li>
            <li>Claude 将根据你的答案继续执行任务</li>
          </ul>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={handleClose}
            className="gap-2"
          >
            <XCircle className="h-4 w-4" />
            稍后回答
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!allAnswered}
            className="gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="h-4 w-4" />
            提交答案 {allAnswered ? "" : `(${Object.keys(selectedAnswers).length}/${questions.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
