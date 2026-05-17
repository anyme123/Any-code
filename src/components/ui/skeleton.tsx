import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Skeleton Component - 轻量级加载占位符
 *
 * 用于首屏加载时显示内容结构，提升用户体验
 *
 * @example
 * // 简单矩形
 * <Skeleton className="h-32 w-full" />
 *
 * @example
 * // 文本行
 * <Skeleton className="h-4 w-3/4" />
 *
 * @example
 * // 圆形头像
 * <Skeleton className="h-12 w-12 rounded-full" />
 */
export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * 是否启用动画
   * @default true
   */
  animate?: boolean;
}

export const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
  ({ className, animate = true, ...props }, ref) => {
    return (
      <div
        ref={ref}
        role="status"
        aria-busy="true"
        aria-live="polite"
        aria-label="加载中"
        className={cn(
          "rounded-lg bg-[var(--surface-panel-elevated)]",
          animate && "animate-pulse",
          className
        )}
        {...props}
      />
    );
  }
);

Skeleton.displayName = "Skeleton";

/**
 * 项目卡片骨架屏
 * 精确匹配 ProjectList 中的卡片布局
 */
export const ProjectCardSkeleton: React.FC = () => {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      {/* 项目名称 */}
      <Skeleton className="h-6 w-2/3" />

      {/* 会话数和时间 */}
      <div className="flex items-center gap-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-28" />
      </div>

      {/* 路径 */}
      <Skeleton className="h-3 w-full" />
    </div>
  );
};

/**
 * 会话列表项骨架屏
 * 精确匹配 SessionList 中的列表项布局
 */
export const SessionListItemSkeleton: React.FC = () => {
  return (
    <div className="flex items-center px-4 py-3 border-b border-border">
      <div className="flex-1 space-y-2">
        {/* 首条消息 */}
        <Skeleton className="h-4 w-3/4" />
        {/* 会话 ID */}
        <Skeleton className="h-3 w-1/2" />
      </div>
      {/* 时间戳 */}
      <Skeleton className="h-3 w-20" />
    </div>
  );
};

/**
 * 通用列表骨架屏
 * 用于快速生成多个骨架屏项目
 */
export interface SkeletonListProps {
  /**
   * 骨架屏项目数量
   * @default 3
   */
  count?: number;
  /**
   * 单个骨架屏组件
   */
  children: React.ReactElement;
  /**
   * 容器类名
   */
  className?: string;
}

export const SkeletonList: React.FC<SkeletonListProps> = ({
  count = 3,
  children,
  className
}) => {
  return (
    <div className={className}>
      {Array.from({ length: count }, (_, i) =>
        React.cloneElement(children, { key: i })
      )}
    </div>
  );
};
