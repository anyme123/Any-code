// Gemini CLI Types

/**
 * Gemini authentication method
 */
export type GeminiAuthMethod = "google_oauth" | "api_key" | "vertex_ai";

/**
 * Gemini CLI configuration
 */
export interface GeminiConfig {
  authMethod: GeminiAuthMethod;
  defaultModel: string;
  approvalMode: string;
  apiKey?: string;
  googleCloudProject?: string;
  env?: Record<string, string>;
}

/**
 * Gemini model information
 */
export interface GeminiModelInfo {
  id: string;
  name: string;
  description: string;
  contextWindow: number;
  isDefault: boolean;
}

/**
 * Gemini execution options
 */
export interface GeminiExecutionOptions {
  projectPath: string;
  prompt: string;
  model?: string;
  approvalMode?: "auto_edit" | "yolo" | "default";
  includeDirectories?: string[];
  sessionId?: string;
  debug?: boolean;
}

/**
 * Gemini installation status
 */
export interface GeminiInstallStatus {
  installed: boolean;
  path?: string;
  version?: string;
  error?: string;
}

/**
 * Gemini session metadata
 */
export interface GeminiSession {
  id: string;
  projectPath: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  status: string;
  firstMessage?: string;
}

/**
 * Gemini statistics from execution result
 */
export interface GeminiStats {
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  duration_ms?: number;
  tool_calls?: number;
}

/**
 * Gemini-specific metadata attached to unified messages
 */
export interface GeminiMetadata {
  provider: "gemini";
  eventType: string;
  delta?: boolean;
  stats?: GeminiStats;
  durationMs?: number;
  toolCalls?: number;
  toolName?: string;
  toolId?: string;
  status?: string;
  exitCode?: number;
  raw?: unknown;
}

/**
 * Gemini stream event types
 */
export type GeminiEventType =
  | "init"
  | "message"
  | "tool_use"
  | "tool_result"
  | "error"
  | "result";

/**
 * Raw Gemini stream event from JSONL output
 */
export interface GeminiStreamEvent {
  type: GeminiEventType;
  session_id?: string;
  model?: string;
  role?: string;
  content?: string;
  delta?: boolean;
  tool_name?: string;
  tool_id?: string;
  parameters?: Record<string, unknown>;
  status?: string;
  output?: string;
  error_type?: string;
  message?: string;
  code?: number;
  stats?: GeminiStats;
  timestamp?: string;
}

/**
 * Extended ClaudeStreamMessage with Gemini metadata
 * This extends the base message type to include Gemini-specific info
 */
export interface GeminiUnifiedMessage {
  type: "system" | "assistant" | "user" | "result" | "tool_use";
  subtype?: string;
  session_id?: string;
  model?: string;
  message?: {
    content?: Array<{
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: unknown;
      tool_use_id?: string;
      is_error?: boolean;
    }>;
    role?: string;
  };
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  error?: {
    type?: string;
    message: string;
    code?: number;
  };
  timestamp?: string;
  geminiMetadata?: GeminiMetadata;
}

/**
 * Check if a message is from Gemini provider
 */
export function isGeminiMessage(msg: unknown): msg is GeminiUnifiedMessage {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "geminiMetadata" in msg &&
    (msg as GeminiUnifiedMessage).geminiMetadata?.provider === "gemini"
  );
}

/**
 * Available Gemini models and CLI aliases.
 * Updated: May 2026
 */
export const GEMINI_MODELS: GeminiModelInfo[] = [
  {
    id: "auto-gemini-3",
    name: "Auto (Gemini 3)",
    description: "Recommended auto routing between Gemini 3 Pro/Flash Preview",
    contextWindow: 1_000_000,
    isDefault: true,
  },
  {
    id: "pro",
    name: "Pro",
    description: "Gemini CLI Pro alias for complex reasoning",
    contextWindow: 1_000_000,
    isDefault: false,
  },
  {
    id: "flash",
    name: "Flash",
    description: "Gemini CLI Flash alias for fast everyday coding",
    contextWindow: 1_000_000,
    isDefault: false,
  },
  {
    id: "flash-lite",
    name: "Flash-Lite",
    description: "Gemini CLI Flash-Lite alias for lightweight tasks",
    contextWindow: 1_000_000,
    isDefault: false,
  },
  {
    id: "gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro (Preview)",
    description: "Flagship preview model rolling out gradually",
    contextWindow: 2_000_000,
    isDefault: false,
  },
  {
    id: "gemini-3-pro-preview",
    name: "Gemini 3 Pro (Preview)",
    description: "Gemini 3 Pro preview for complex reasoning",
    contextWindow: 1_000_000,
    isDefault: false,
  },
  {
    id: "gemini-3-flash-preview",
    name: "Gemini 3 Flash (Preview)",
    description: "Gemini 3 fast preview model",
    contextWindow: 1_000_000,
    isDefault: false,
  },
  {
    id: "auto-gemini-2.5",
    name: "Auto (Gemini 2.5)",
    description: "Stable auto routing between Gemini 2.5 Pro and Flash",
    contextWindow: 1_000_000,
    isDefault: false,
  },
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    description: "Stable Pro model",
    contextWindow: 1_000_000,
    isDefault: false,
  },
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    description: "Stable Flash model",
    contextWindow: 1_000_000,
    isDefault: false,
  },
  {
    id: "gemini-2.5-flash-lite",
    name: "Gemini 2.5 Flash-Lite",
    description: "Stable lightweight model",
    contextWindow: 1_000_000,
    isDefault: false,
  },
];

/**
 * Default Gemini configuration
 */
export const DEFAULT_GEMINI_CONFIG: GeminiConfig = {
  authMethod: "google_oauth",
  defaultModel: "auto-gemini-3",
  approvalMode: "auto_edit",
};

// ============================================================================
// Session History Types
// ============================================================================

/**
 * Session log entry from logs.json
 */
export interface GeminiSessionLog {
  sessionId: string;
  messageId: number;
  type: string;
  message: string;
  timestamp: string;
}

/**
 * Complete session detail from chats/session-*.json
 */
export interface GeminiSessionDetail {
  sessionId: string;
  projectHash: string;
  startTime: string;
  lastUpdated: string;
  messages: Array<{
    id: string;
    timestamp: string;
    type: "user" | "gemini";
    content: string;
    toolCalls?: Array<{
      id: string;
      name: string;
      args: Record<string, unknown>;
      result?: unknown;
      status?: string;
      timestamp?: string;
      resultDisplay?: string;
      displayName?: string;
      description?: string;
      renderOutputAsMarkdown?: boolean;
    }>;
    thoughts?: unknown[];
    model?: string;
    tokens?: unknown;
  }>;
}

/**
 * Session file info (simplified for listing)
 */
export interface GeminiSessionInfo {
  sessionId: string;
  fileName: string;
  startTime: string;
  firstMessage?: string;
}
