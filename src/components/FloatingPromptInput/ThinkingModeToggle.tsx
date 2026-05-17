import React from "react";
import { Brain } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ThinkingEffort } from "./types";

interface ThinkingModeToggleProps {
  isEnabled: boolean;
  effort?: ThinkingEffort;
  onToggle: () => void;
  disabled?: boolean;
}

const EFFORT_COLORS: Record<ThinkingEffort, string> = {
  low: "bg-blue-600 hover:bg-blue-700 border-blue-600 shadow-blue-500/20",
  medium: "bg-amber-600 hover:bg-amber-700 border-amber-600 shadow-amber-500/20",
  high: "bg-orange-600 hover:bg-orange-700 border-orange-600 shadow-orange-500/20",
  xhigh: "bg-fuchsia-600 hover:bg-fuchsia-700 border-fuchsia-600 shadow-fuchsia-500/20",
  max: "bg-red-600 hover:bg-red-700 border-red-600 shadow-red-500/20",
};

const EFFORT_LABELS: Record<ThinkingEffort, string> = {
  low: "Low",
  medium: "Med",
  high: "High",
  xhigh: "XHigh",
  max: "Max",
};

/**
 * ThinkingModeToggle - Adaptive Thinking with effort levels
 * Click to cycle: off → high → xhigh → max → low → medium → off
 */
export const ThinkingModeToggle: React.FC<ThinkingModeToggleProps> = ({
  isEnabled,
  effort,
  onToggle,
  disabled = false
}) => {
  const { t } = useTranslation();
  const colorClass = isEnabled && effort ? EFFORT_COLORS[effort] : "";
  const label = isEnabled && effort ? EFFORT_LABELS[effort] : "";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={isEnabled ? "default" : "outline"}
            size="sm"
            disabled={disabled}
            onClick={onToggle}
            className={cn(
              "h-8 gap-1.5 transition-all duration-200",
              isEnabled
                ? `${colorClass} text-white shadow-sm`
                : "bg-background/50 hover:bg-accent/50 text-muted-foreground border-border/50"
            )}
          >
            <Brain className={cn(
              "h-4 w-4 transition-all duration-200",
              isEnabled ? "animate-pulse text-white" : "text-muted-foreground"
            )} />
            <span className="text-sm font-medium">
              {isEnabled ? label : t('promptInput.thinkingOff')}
            </span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-center">
            <p className="font-medium">
              {isEnabled
                ? t('promptInput.adaptiveThinking', { effort: effort })
                : t('promptInput.thinkingDisabled')}
            </p>
            <p className="text-xs text-muted-foreground">
              {isEnabled
                ? t('promptInput.effortDescription')
                : t('promptInput.normalSpeed')}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {t('common.back')}: <kbd className="px-1 py-0.5 bg-muted rounded">Tab</kbd>
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
