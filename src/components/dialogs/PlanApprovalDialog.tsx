/**
 * PlanApprovalDialog - 计划审批对话框
 *
 * 当 Claude 调用 ExitPlanMode 工具时显示此对话框
 * 让用户审批计划，确认后关闭 Plan 模式开始执行
 *
 * V2 改进：
 * - 支持 Markdown 渲染计划内容
 * - 添加计划分析统计
 */

import { XCircle, FileText, Play, ListChecks } from "lucide-react";
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
import ReactMarkdown from 'react-markdown';
import { useMemo } from 'react';

export interface PlanApprovalDialogProps {
  /** 是否显示对话框 */
  open: boolean;
  /** 计划内容 */
  plan: string;
  /** 关闭对话框 */
  onClose: () => void;
  /** 批准计划 - 关闭 Plan 模式开始执行 */
  onApprove: () => void;
  /** 拒绝计划 - 保持 Plan 模式继续规划 */
  onReject: () => void;
}

/**
 * 计划审批对话框
 */
export function PlanApprovalDialog({
  open,
  plan,
  onClose,
  onApprove,
  onReject,
}: PlanApprovalDialogProps) {
  const handleApprove = () => {
    onApprove();
    onClose();
  };

  const handleReject = () => {
    onReject();
    onClose();
  };

  // 分析计划内容
  const planStats = useMemo(() => {
    if (!plan) return null;

    // 计算步骤数（根据编号列表）
    const stepMatches = plan.match(/^\d+\./gm);
    const steps = stepMatches ? stepMatches.length : 0;

    // 计算字符数和行数
    const chars = plan.length;
    const lines = plan.split('\n').length;

    return { steps, chars, lines };
  }, [plan]);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="h-10 w-10 rounded-full bg-info/10 flex items-center justify-center">
              <FileText className="h-5 w-5 text-info" />
            </div>
            <div>
              <DialogTitle className="text-lg">计划已完成</DialogTitle>
              <DialogDescription>
                Claude 已完成规划，请审批以下计划
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* 计划统计 */}
        {planStats && planStats.steps > 0 && (
          <div className="flex items-center gap-4 p-3 rounded-lg bg-info/5 border border-info/20">
            <ListChecks className="h-5 w-5 text-info flex-shrink-0" />
            <div className="flex-1 flex items-center gap-4 text-xs">
              <div>
                <span className="text-muted-foreground">步骤数：</span>
                <span className="font-medium ml-1">{planStats.steps}</span>
              </div>
              <div className="h-4 w-px bg-border" />
              <div>
                <span className="text-muted-foreground">内容：</span>
                <span className="font-medium ml-1">{planStats.lines} 行</span>
              </div>
            </div>
          </div>
        )}

        {/* 计划内容 */}
        <div className="flex-1 min-h-0 my-4">
          <div className="text-sm font-medium text-muted-foreground mb-2">
            计划内容：
          </div>
          <ScrollArea className="h-[300px] rounded-lg border bg-muted/30 p-4">
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown>
                {plan || "（无计划内容）"}
              </ReactMarkdown>
            </div>
          </ScrollArea>
        </div>

        {/* 提示信息 */}
        <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3 mb-4">
          <p className="font-medium mb-1">提示：</p>
          <ul className="list-disc list-inside space-y-1">
            <li><strong>批准执行</strong>：关闭 Plan 模式，Claude 将开始执行计划中的操作</li>
            <li><strong>继续规划</strong>：保持 Plan 模式，你可以要求 Claude 修改或完善计划</li>
          </ul>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={handleReject}
            className="gap-2"
          >
            <XCircle className="h-4 w-4" />
            继续规划
          </Button>
          <Button
            onClick={handleApprove}
            className="gap-2 bg-green-600 hover:bg-green-700"
          >
            <Play className="h-4 w-4" />
            批准执行
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
