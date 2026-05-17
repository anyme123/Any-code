import React from "react";
import { ChevronUp, Check, Brain, Zap, Sparkles, Rocket, Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

/**
 * Codex reasoning level configuration
 * Based on OpenAI/Codex model_reasoning_effort.
 */
/** Reasoning level values used in config.toml (model_reasoning_effort) */
export type CodexReasoningLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface CodexReasoningLevelConfig {
  id: CodexReasoningLevel;
  name: string;
  description: string;
  icon: React.ReactNode;
  isDefault?: boolean;
  /** Maps to config.toml model_reasoning_effort value */
  configValue: string;
}

/**
 * Reasoning level options
 * - minimal: Lowest-latency responses
 * - low: Fast responses, fewer reasoning tokens
 * - medium: Balanced (default)
 * - high: Detailed reasoning, more tokens
 * - xhigh: Maximum reasoning depth
 */
export const CODEX_REASONING_LEVELS: CodexReasoningLevelConfig[] = [
  {
    id: 'minimal',
    name: '最小',
    description: '最低延迟，适合非常轻量的任务',
    icon: <Gauge className="h-4 w-4 text-cyan-500" />,
    isDefault: false,
    configValue: 'minimal',
  },
  {
    id: 'low',
    name: '低',
    description: '快速响应，最少推理',
    icon: <Zap className="h-4 w-4 text-yellow-500" />,
    isDefault: false,
    configValue: 'low',
  },
  {
    id: 'medium',
    name: '中',
    description: '平衡模式（默认）',
    icon: <Brain className="h-4 w-4 text-blue-500" />,
    isDefault: true,
    configValue: 'medium',
  },
  {
    id: 'high',
    name: '高',
    description: '详细推理，更多 token',
    icon: <Sparkles className="h-4 w-4 text-purple-500" />,
    isDefault: false,
    configValue: 'high',
  },
  {
    id: 'xhigh',
    name: '极高',
    description: '最大推理深度，适合复杂任务',
    icon: <Rocket className="h-4 w-4 text-red-500" />,
    isDefault: false,
    configValue: 'xhigh',
  },
];

interface CodexReasoningLevelSelectorProps {
  selectedLevel: CodexReasoningLevel | undefined;
  onLevelChange: (level: CodexReasoningLevel) => void;
  disabled?: boolean;
  /** Whether to persist the level change to config.toml (default: true) */
  persist?: boolean;
}

/**
 * CodexReasoningLevelSelector component - Dropdown for selecting reasoning effort level
 * Used with Codex engine to control model inference depth
 * Automatically persists changes to ~/.codex/config.toml
 */
export const CodexReasoningLevelSelector: React.FC<CodexReasoningLevelSelectorProps> = ({
  selectedLevel,
  onLevelChange,
  disabled = false,
  persist = true,
}) => {
  const [open, setOpen] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);

  // Find selected level or default
  const selectedLevelData = CODEX_REASONING_LEVELS.find(l => l.id === selectedLevel)
    || CODEX_REASONING_LEVELS.find(l => l.isDefault)
    || CODEX_REASONING_LEVELS[1]; // medium as fallback

  /**
   * Handle level change with optional persistence to config.toml
   */
  const handleLevelChange = async (level: CodexReasoningLevel) => {
    // Update local state immediately
    onLevelChange(level);
    setOpen(false);

    // Persist to config.toml if enabled
    if (persist) {
      setIsSaving(true);
      try {
        await api.updateCodexReasoningLevel(level);
        console.log(`[CodexReasoningLevel] Successfully saved level: ${level}`);
      } catch (error) {
        console.error('[CodexReasoningLevel] Failed to persist level:', error);
        // Note: We don't revert the UI state as the local change is still valid for the session
      } finally {
        setIsSaving(false);
      }
    }
  };

  return (
    <Popover
      trigger={
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || isSaving}
          className="h-8 gap-2 min-w-[120px] justify-start border-border/50 bg-background/50 hover:bg-accent/50"
        >
          {selectedLevelData.icon}
          <span className="flex-1 text-left">推理: {selectedLevelData.name}</span>
          <ChevronUp className="h-4 w-4 opacity-50" />
        </Button>
      }
      content={
        <div className="w-[280px] p-1">
          <div className="px-3 py-2 text-xs text-muted-foreground border-b border-border/50 mb-1">
            选择推理级别
          </div>
          {CODEX_REASONING_LEVELS.map((level) => {
            const isSelected = selectedLevel === level.id ||
              (!selectedLevel && level.isDefault);
            return (
              <button
                key={level.id}
                onClick={() => handleLevelChange(level.id)}
                className={cn(
                  "w-full flex items-start gap-3 p-3 rounded-md transition-colors text-left group",
                  "hover:bg-accent",
                  isSelected && "bg-accent"
                )}
              >
                <div className="mt-0.5">{level.icon}</div>
                <div className="flex-1 space-y-1">
                  <div className="font-medium text-sm flex items-center gap-2">
                    {level.name}
                    {isSelected && (
                      <Check className="h-3.5 w-3.5 text-primary" />
                    )}
                    {level.isDefault && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                        默认
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {level.description}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      }
      open={open}
      onOpenChange={setOpen}
      align="start"
      side="top"
    />
  );
};
