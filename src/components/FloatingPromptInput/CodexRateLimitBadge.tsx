import React from "react";
import { Clock, AlertTriangle, Calendar, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Popover } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { CodexRateLimits, CodexRateLimit } from "@/types/codex";

interface CodexRateLimitBadgeProps {
  rateLimits: CodexRateLimits | null;
  className?: string;
}

/**
 * Formats reset timestamp into human-readable time string
 * For same day: "14:49"
 * For different day: "12月24日 11:21"
 */
function formatResetTime(resetsAt?: number, resetsInSeconds?: number): string {
  let resetDate: Date;

  if (resetsAt !== undefined) {
    resetDate = new Date(resetsAt * 1000);
  } else if (resetsInSeconds !== undefined) {
    if (resetsInSeconds <= 0) return "已重置";
    resetDate = new Date(Date.now() + resetsInSeconds * 1000);
  } else {
    return "未知";
  }

  const now = new Date();
  const isToday = resetDate.toDateString() === now.toDateString();

  const timeStr = resetDate.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  if (isToday) {
    return timeStr;
  }

  // Show date for non-today resets
  const month = resetDate.getMonth() + 1;
  const day = resetDate.getDate();
  return `${month}月${day}日 ${timeStr}`;
}

/**
 * Gets variant based on usage percentage
 */
function getVariant(percent: number): "success" | "warning" | "destructive" {
  if (percent >= 90) return "destructive";
  if (percent >= 70) return "warning";
  return "success";
}

/**
 * Simple progress bar with custom color
 */
const ColoredProgressBar: React.FC<{
  value: number;
  variant: "success" | "warning" | "destructive";
}> = ({ value, variant }) => {
  return (
    <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-secondary">
      <div
        className={cn(
          "h-full transition-all duration-300",
          variant === "destructive" && "bg-destructive",
          variant === "warning" && "bg-warning",
          variant === "success" && "bg-success"
        )}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
};

/**
 * Rate limit progress bar component
 */
const RateLimitProgress: React.FC<{
  label: string;
  limit: CodexRateLimit;
  icon: React.ReactNode;
}> = ({ label, limit, icon }) => {
  const variant = getVariant(limit.usedPercent);
  const resetTime = formatResetTime(limit.resetsAt, limit.resetsInSeconds);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          {icon}
          <span>{label}</span>
        </div>
        <span className={cn(
          "font-mono font-medium",
          variant === "destructive" && "text-destructive",
          variant === "warning" && "text-warning",
          variant === "success" && "text-success"
        )}>
          {limit.usedPercent.toFixed(1)}%
        </span>
      </div>
      <ColoredProgressBar value={limit.usedPercent} variant={variant} />
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>已用 {limit.usedPercent.toFixed(1)}%</span>
        <span>重置: {resetTime}</span>
      </div>
    </div>
  );
};

/**
 * CodexRateLimitBadge - Displays Codex usage limits (5h and weekly)
 *
 * Shows a compact badge with the primary (5h) limit usage percentage.
 * Clicking/hovering shows detailed information in a popover.
 */
export const CodexRateLimitBadge: React.FC<CodexRateLimitBadgeProps> = ({
  rateLimits,
  className
}) => {
  const [open, setOpen] = React.useState(false);

  // Don't render if no rate limits data
  if (!rateLimits || (!rateLimits.primary && !rateLimits.secondary)) {
    return null;
  }

  // Use primary (5h) limit for badge display, fallback to secondary
  const primaryLimit = rateLimits.primary;
  const secondaryLimit = rateLimits.secondary;

  const displayLimit = primaryLimit || secondaryLimit;
  if (!displayLimit) return null;

  const variant = getVariant(displayLimit.usedPercent);
  const badgeVariant = variant === "destructive" ? "destructive"
    : variant === "warning" ? "warning"
    : "outline";

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Badge
          variant={badgeVariant}
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 h-8 cursor-pointer hover:opacity-80 transition-opacity",
            className
          )}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          {variant === "destructive" ? (
            <AlertTriangle className="h-3 w-3" />
          ) : (
            <Clock className="h-3 w-3" />
          )}
          <span className="font-mono text-xs">
            {displayLimit.usedPercent.toFixed(0)}%
          </span>
          <Info className="h-3 w-3 opacity-50" />
        </Badge>
      }
      content={
        <div className="space-y-4 p-1">
          <div className="font-medium text-sm border-b pb-2">
            Codex 用量限制
          </div>

          {primaryLimit && (
            <RateLimitProgress
              label="5小时限制"
              limit={primaryLimit}
              icon={<Clock className="h-3.5 w-3.5" />}
            />
          )}

          {secondaryLimit && (
            <RateLimitProgress
              label="每周限制"
              limit={secondaryLimit}
              icon={<Calendar className="h-3.5 w-3.5" />}
            />
          )}

          {rateLimits.updatedAt && (
            <div className="text-[10px] text-muted-foreground pt-2 border-t">
              更新于: {new Date(rateLimits.updatedAt).toLocaleTimeString()}
            </div>
          )}
        </div>
      }
      side="top"
      align="center"
      className="w-72"
    />
  );
};

export default CodexRateLimitBadge;
