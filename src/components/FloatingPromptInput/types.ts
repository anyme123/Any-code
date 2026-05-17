import { ReactNode } from "react";

/**
 * Model type definition
 */
export type ModelType =
  | "default"
  | "best"
  | "sonnet"
  | "opus"
  | "haiku"
  | "opusplan"
  | "custom";

/**
 * Thinking mode type definition
 * Claude adaptive thinking with effort levels
 */
export type ThinkingMode = "off" | "adaptive";

/**
 * Thinking effort level
 */
export type ThinkingEffort = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * Model configuration
 */
export interface ModelConfig {
  id: ModelType;
  name: string;
  description: string;
  icon: ReactNode;
}

/**
 * Thinking mode configuration
 */
export interface ThinkingModeConfig {
  id: ThinkingMode;
  effort?: ThinkingEffort; // Effort level for adaptive thinking
  name: string;
  description: string;
  level: number; // 0-4 for visual indicator
}

/**
 * Image attachment interface
 */
export interface ImageAttachment {
  id: string;
  filePath: string;
  previewUrl: string;
  width: number;
  height: number;
}

/**
 * Execution engine configuration (re-export from ExecutionEngineSelector)
 */
export type ExecutionEngineConfig = import('@/components/ExecutionEngineSelector').ExecutionEngineConfig;

/**
 * Floating prompt input props
 */
export interface FloatingPromptInputProps {
  /**
   * Callback when prompt is sent - includes maxThinkingTokens separately
   */
  onSend: (prompt: string, model: ModelType, maxThinkingTokens?: number) => void;
  /**
   * Whether the input is loading
   */
  isLoading?: boolean;
  /**
   * Whether the input is disabled
   */
  disabled?: boolean;
  /**
   * Default model to select
   */
  defaultModel?: ModelType;
  /**
   * Model from session (for restoring model selection on page reload)
   */
  sessionModel?: string;
  /**
   * Project path for file picker
   */
  projectPath?: string;
  /**
   * 🆕 Session ID (for history-aware context search)
   */
  sessionId?: string;
  /**
   * 🆕 Project ID (for history-aware context search)
   */
  projectId?: string;
  /**
   * Optional className for styling
   */
  className?: string;
  /**
   * Callback when cancel is clicked (only during loading)
   */
  onCancel?: () => void;
  /**
   * Optional function to get conversation context for prompt enhancement
   */
  getConversationContext?: () => string[];
  /**
   * 🆕 Complete message list (for dual API context extraction)
   */
  messages?: import("@/types/claude").ClaudeStreamMessage[];
  /**
   * Whether Plan Mode is enabled
   */
  isPlanMode?: boolean;
  /**
   * Callback when Plan Mode is toggled
   */
  onTogglePlanMode?: () => void;
  /**
   * Session cost for display (formatted string like "$0.05")
   */
  sessionCost?: string;
  /**
   * Detailed session statistics (optional)
   */
  sessionStats?: {
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    durationSeconds: number;
    apiDurationSeconds: number;
  };
  /**
   * Whether there are messages (to show cost display)
   */
  hasMessages?: boolean;
  /**
   * 🆕 Complete session information (for export)
   */
  session?: import("@/lib/api").Session;
  /**
   * ?? Codex rate limits (for live badge updates)
   */
  codexRateLimits?: import("@/types/codex").CodexRateLimits | null;
  /**
   * 🆕 Execution engine configuration (optional, for Codex integration)
   */
  executionEngineConfig?: ExecutionEngineConfig;
  /**
   * 🆕 Callback when execution engine config changes
   */
  onExecutionEngineConfigChange?: (config: ExecutionEngineConfig) => void;
}

/**
 * Floating prompt input ref interface
 */
export interface FloatingPromptInputRef {
  addImage: (imagePath: string) => void;
  setPrompt: (text: string) => void;
}
