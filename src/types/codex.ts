/**
 * OpenAI Codex Integration - Type Definitions
 *
 * This file defines TypeScript types for OpenAI Codex exec mode integration.
 * Based on: https://github.com/openai/codex/blob/main/docs/exec.md
 */

// ============================================================================
// Event Types (JSONL Stream)
// ============================================================================

/**
 * Base event structure for Codex JSONL stream
 * Note: Specific event types are handled via string matching in CodexEventConverter,
 * so we only maintain the base type and generic CodexEvent union.
 */
export interface CodexBaseEvent {
  type: string;
  timestamp?: string;
  payload?: any;
  [key: string]: any;
}

/**
 * Generic type for all Codex events
 * Events are processed by type string matching rather than explicit interfaces
 */
export type CodexEvent = CodexBaseEvent;

// ============================================================================
// Item Types
// ============================================================================

/**
 * Agent message item
 */
export interface CodexAgentMessageItem {
  id: string;
  type: 'agent_message';
  text: string;
}

/**
 * Reasoning item - assistant's thinking
 */
export interface CodexReasoningItem {
  id: string;
  type: 'reasoning';
  text: string;
}

/**
 * Command execution item
 */
export interface CodexCommandExecutionItem {
  id: string;
  type: 'command_execution';
  command: string;
  aggregated_output: string;
  exit_code?: number;
  status: 'in_progress' | 'completed' | 'failed';
}

/**
 * File change item
 */
export interface CodexFileChangeItem {
  id: string;
  type: 'file_change';
  file_path: string;
  change_type: 'create' | 'update' | 'delete';
  content?: string;
  status: 'in_progress' | 'completed' | 'failed';
}

/**
 * MCP tool call item
 */
export interface CodexMcpToolCallItem {
  id: string;
  type: 'mcp_tool_call';
  tool_name: string;
  tool_input: any;
  tool_output?: any;
  status: 'in_progress' | 'completed' | 'failed';
}

/**
 * Web search item
 */
export interface CodexWebSearchItem {
  id: string;
  type: 'web_search';
  query: string;
  results?: any[];
  status: 'in_progress' | 'completed' | 'failed';
}

/**
 * Todo list item - agent's running plan
 */
export interface CodexTodoListItem {
  id: string;
  type: 'todo_list';
  todos: Array<{
    id: string;
    description: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
  }>;
}

/**
 * Union type for all Codex items
 */
export type CodexItem =
  | CodexAgentMessageItem
  | CodexReasoningItem
  | CodexCommandExecutionItem
  | CodexFileChangeItem
  | CodexMcpToolCallItem
  | CodexWebSearchItem
  | CodexTodoListItem;

// ============================================================================
// Execution Configuration
// ============================================================================

/**
 * Codex execution mode
 */
export type CodexExecutionMode = 'read-only' | 'full-auto' | 'danger-full-access';

/**
 * Codex execution options
 */
export interface CodexExecutionOptions {
  /** Project path */
  projectPath: string;

  /** User prompt */
  prompt: string;

  /** Execution mode (default: read-only) */
  mode?: CodexExecutionMode;

  /** Model to use (e.g., gpt-5.5) */
  model?: string;

  /** Enable Codex fast service tier for supported models */
  fastMode?: boolean;

  /** Reasoning effort for this run */
  reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";

  /** Enable JSON output mode */
  json?: boolean;

  /** Output schema for structured output (JSON Schema) */
  outputSchema?: string;

  /** Output file path */
  outputFile?: string;

  /** Skip Git repository check */
  skipGitRepoCheck?: boolean;

  /** API key (overrides default) */
  apiKey?: string;

  /** Session ID for resuming */
  sessionId?: string;

  /** Resume last session */
  resumeLast?: boolean;
}

// ============================================================================
// Session Management
// ============================================================================

/**
 * Codex session metadata
 */
export interface CodexSession {
  /** Session/thread ID */
  id: string;

  /** Project path */
  projectPath: string;

  /** Creation timestamp */
  createdAt: number;

  /** Last updated timestamp */
  updatedAt: number;

  /** Execution mode used */
  mode: CodexExecutionMode;

  /** Model used */
  model?: string;

  /** Session status */
  status: 'active' | 'completed' | 'failed';

  /** 🆕 First user message */
  firstMessage?: string;

  /** 🆕 Last message timestamp (ISO string) */
  lastMessageTimestamp?: string;
}

// ============================================================================
// Message Conversion (Codex → ClaudeStreamMessage)
// ============================================================================

/**
 * Codex rate limit information (5h / weekly limits)
 * Source: Codex CLI token_count events in session files
 */
export interface CodexRateLimit {
  /** Usage percentage (0-100) */
  usedPercent: number;
  /** Window duration in minutes */
  windowMinutes: number;
  /** Unix timestamp when limit resets */
  resetsAt?: number;
  /** Seconds until reset */
  resetsInSeconds?: number;
}

/**
 * Codex Multi-Agent configuration (Experimental)
 * Controls the multi-agent/subagent feature in config.toml [features] section
 */
export interface CodexMultiAgentConfig {
  /** Whether multi-agent is enabled */
  enabled: boolean;
  /** Model for subagents (optional, defaults to main model) */
  subagentModel?: string;
  /** Reasoning effort for subagents (optional) */
  subagentReasoningEffort?: string;
}

/**
 * Codex rate limits structure
 */
export interface CodexRateLimits {
  /** Primary (5-hour) limit */
  primary?: CodexRateLimit;
  /** Secondary (weekly) limit */
  secondary?: CodexRateLimit;
  /** Timestamp when rate limits were last updated */
  updatedAt?: string;
}

/**
 * Codex item to message conversion metadata
 */
export interface CodexMessageMetadata {
  /** Original Codex item type */
  codexItemType: string;

  /** Original Codex item ID */
  codexItemId: string;

  /** Codex thread ID */
  threadId?: string;

  /** Token usage (if available) */
  usage?: {
    input_tokens: number;
    cached_input_tokens?: number;
    output_tokens: number;
  };

  /** Rate limits (if available from token_count events) */
  rateLimits?: CodexRateLimits;

  /** Model context window size */
  modelContextWindow?: number;
}
