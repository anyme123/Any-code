/**
 * Type definitions for the Tauri IPC bridge.
 *
 * Split out of api.ts so the bridge layer can stay focused on invocations and
 * the type surface remains independently consumable (e.g. by components that
 * only need typings, not the runtime client).
 *
 * Re-exported by `@/lib/api` for full backward compatibility — existing
 * `import { Project } from "@/lib/api"` still works.
 */

/** Process type for tracking in ProcessRegistry */
export type ProcessType =
  | { AgentRun: { agent_id: number; agent_name: string } }
  | { ClaudeSession: { session_id: string } };

/** Information about a running process */
export interface ProcessInfo {
  run_id: number;
  process_type: ProcessType;
  pid: number;
  started_at: string;
  project_path: string;
  task: string;
  model: string;
}

/**
 * Represents a project in the ~/.claude/projects directory
 */
export interface Project {
  /** The project ID (derived from the directory name) */
  id: string;
  /** The original project path (decoded from the directory name) */
  path: string;
  /** List of session IDs (JSONL file names without extension) */
  sessions: string[];
  /** Unix timestamp when the project directory was created */
  created_at: number;
}

/**
 * Represents a session with its metadata
 */
export interface Session {
  /** The session ID (UUID) */
  id: string;
  /** The project ID this session belongs to */
  project_id: string;
  /** The project path */
  project_path: string;
  /** Optional todo data associated with this session */
  todo_data?: any;
  /** Unix timestamp when the session file was created */
  created_at: number;
  /** First user message content (if available) */
  first_message?: string;
  /** Timestamp of the first user message (if available) */
  message_timestamp?: string;
  /** Timestamp of the last message in the session (if available) - ISO string */
  last_message_timestamp?: string;
  /** The model used in this session (if available) */
  model?: string;
  /** Execution engine: 'claude' | 'codex' | 'gemini' */
  engine?: 'claude' | 'codex' | 'gemini';
}

/**
 * Session conversion source information
 */
export interface ConversionSource {
  /** Source engine type: "claude" | "codex" */
  engine: string;
  /** Source session ID */
  sessionId: string;
  /** Conversion timestamp (ISO 8601) */
  convertedAt: string;
  /** Source project path */
  sourceProjectPath: string;
}

/**
 * Session conversion result
 */
export interface ConversionResult {
  /** Whether conversion succeeded */
  success: boolean;
  /** New generated session ID */
  newSessionId: string;
  /** Target engine type */
  targetEngine: string;
  /** Number of messages converted */
  messageCount: number;
  /** Conversion source information */
  source: ConversionSource;
  /** Target file path */
  targetPath: string;
  /** Error message if conversion failed */
  error?: string;
}

/**
 * Represents the settings from ~/.claude/settings.json
 */
export interface ClaudeSettings {
  [key: string]: any;
}

/**
 * Permission mode for Claude execution
 */
export enum PermissionMode {
  Interactive = "Interactive",
  AcceptEdits = "AcceptEdits",
  ReadOnly = "ReadOnly",
  Plan = "Plan",
}

/**
 * Permission configuration for Claude execution
 */
export interface ClaudePermissionConfig {
  allowed_tools: string[];
  disallowed_tools: string[];
  permission_mode: PermissionMode;
  auto_approve_edits: boolean;
  enable_dangerous_skip: boolean;
}

/**
 * Output format for Claude execution
 */
export enum OutputFormat {
  StreamJson = "StreamJson",
  Json = "Json",
  Text = "Text",
}

/**
 * Claude execution configuration
 */
export interface ClaudeExecutionConfig {
  output_format: OutputFormat;
  timeout_seconds: number | null;
  max_tokens: number | null;
  max_thinking_tokens: number | null;
  verbose: boolean;
  permissions: ClaudePermissionConfig;
  disable_rewind_git_operations: boolean;
}

/**
 * Represents the Claude Code version status
 */
export interface ClaudeVersionStatus {
  /** Whether Claude Code is installed and working */
  is_installed: boolean;
  /** The version string if available */
  version?: string;
  /** The full output from the command */
  output: string;
}

/**
 * Represents a CLAUDE.md file found in the project
 */
export interface ClaudeMdFile {
  /** Relative path from the project root */
  relative_path: string;
  /** Absolute path to the file */
  absolute_path: string;
  /** File size in bytes */
  size: number;
  /** Last modified timestamp */
  modified: number;
}

/**
 * Represents a file or directory entry
 */
export interface FileEntry {
  name: string;
  path: string;
  is_directory: boolean;
  size: number;
  extension?: string;
}

/**
 * Rewind mode for reverting prompts
 */
export type RewindMode = "conversation_only" | "code_only" | "both";

/**
 * Capabilities for rewinding a specific prompt
 */
export interface RewindCapabilities {
  /** Can revert conversation (always true) */
  conversation: boolean;
  /** Can revert code (true if has git_commit_before) */
  code: boolean;
  /** Can revert both (true if has git_commit_before) */
  both: boolean;
  /** Warning message if code revert is not available */
  warning?: string;
  /** Prompt source indicator */
  source: "project" | "cli";
}

/**
 * Information about the safety of a git reset operation
 * Used to warn users when reverting might lose commits from other engines or user manual commits
 */
export interface ResetSafetyInfo {
  /** Number of commits that will be lost */
  commitsToLose: number;
  /** Whether there are commits from other engines (Claude/Codex/Gemini) */
  hasOtherEngineCommits: boolean;
  /** Whether there are user manual commits */
  hasUserCommits: boolean;
  /** List of commit summaries that will be lost (max 10) */
  commitsSummary: string[];
  /** Whether it's safe to proceed without warning */
  safeToProceed: boolean;
  /** Warning message if not safe */
  warning: string | null;
}

/**
 * A record of a user prompt
 */
export interface PromptRecord {
  /** Index of this prompt (0, 1, 2...) */
  index: number;
  /** The prompt text user entered */
  text: string;
  /** Git commit before sending this prompt */
  gitCommitBefore: string;
  /** Git commit after AI completed (optional) */
  gitCommitAfter?: string;
  /** Timestamp when prompt was sent */
  timestamp: number;
  /** Prompt source: "project" (from project interface) or "cli" (from CLI) */
  source: string;
}

// Usage Dashboard types
export interface UsageEntry {
  project: string;
  timestamp: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_write_tokens: number;
  cache_read_tokens: number;
  cost: number;
}

export interface ModelUsage {
  model: string;
  total_cost: number;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  session_count: number;
}

export interface DailyUsage {
  date: string;
  total_cost: number;
  total_tokens: number;
  models_used: string[];
}

export interface ProjectUsage {
  project_path: string;
  project_name: string;
  total_cost: number;
  total_tokens: number;
  session_count: number;
  last_used: string;
}

export interface ApiBaseUrlUsage {
  api_base_url: string;
  total_cost: number;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  session_count: number;
}

export interface UsageStats {
  total_cost: number;
  total_tokens: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_creation_tokens: number;
  total_cache_read_tokens: number;
  total_sessions: number;
  by_model: ModelUsage[];
  by_date: DailyUsage[];
  by_project: ProjectUsage[];
  by_api_base_url?: ApiBaseUrlUsage[];
}

export interface UsageOverview {
  total_cost: number;
  total_sessions: number;
  total_tokens: number;
  today_cost: number;
  week_cost: number;
  top_model?: string;
  top_project?: string;
}

export interface SessionCacheTokens {
  session_id: string;
  total_cache_creation_tokens: number;
  total_cache_read_tokens: number;
}

/**
 * Provider configuration for API switching
 */
export interface ProviderConfig {
  id: string;
  name: string;
  description: string;
  base_url: string;
  auth_token?: string;
  api_key?: string;
  api_key_helper?: string;
  model?: string;
  enable_auto_api_key_helper?: boolean;
}

/**
 * Current provider configuration from environment variables
 */
export interface CurrentProviderConfig {
  anthropic_base_url?: string;
  anthropic_auth_token?: string;
  anthropic_api_key?: string;
  anthropic_api_key_helper?: string;
  anthropic_model?: string;
  anthropic_small_fast_model?: string;
  anthropic_default_opus_model?: string;
  anthropic_default_sonnet_model?: string;
  anthropic_custom_model_option?: string;
  api_timeout_ms?: string;
  claude_code_disable_nonessential_traffic?: string;
}

/**
 * API Key usage information
 */
export interface ApiKeyUsage {
  /** Total balance in USD */
  total_balance: number;
  /** Used balance in USD */
  used_balance: number;
  /** Remaining balance in USD */
  remaining_balance: number;
  /** Whether the balance is unlimited */
  is_unlimited: boolean;
  /** Access expiration timestamp (0 means never expires) */
  access_until: number;
  /** Query start date */
  query_start_date: string;
  /** Query end date */
  query_end_date: string;
}

/**
 * Codex provider configuration for OpenAI Codex API switching
 */
export interface CodexProviderConfig {
  id: string;
  name: string;
  description?: string;
  websiteUrl?: string;
  category?: 'official' | 'cn_official' | 'aggregator' | 'third_party' | 'custom';
  auth: Record<string, any>;
  config: string;
  isOfficial?: boolean;
  isPartner?: boolean;
  createdAt?: number;
}

/**
 * Current Codex provider configuration from ~/.codex directory
 */
export interface CurrentCodexConfig {
  auth: Record<string, any>;
  config: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

/**
 * Gemini provider configuration for Gemini API switching
 */
export interface GeminiProviderConfig {
  id: string;
  name: string;
  description?: string;
  websiteUrl?: string;
  category?: 'official' | 'third_party' | 'custom';
  env: Record<string, string>;
  isOfficial?: boolean;
  isPartner?: boolean;
  createdAt?: number;
}

/**
 * Current Gemini provider configuration from ~/.gemini directory
 */
export interface CurrentGeminiProviderConfig {
  env: Record<string, string>;
  settings: Record<string, any>;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  selectedAuthType?: string;
}

// ============================================================================
// MCP types
// ============================================================================

/**
 * MCP server spec (concrete configuration)
 */
export interface MCPServerSpec {
  type?: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
}

/**
 * MCP app enabled flags
 */
export interface McpApps {
  claude: boolean;
  codex: boolean;
  gemini: boolean;
}

/**
 * MCP server (unified)
 */
export interface McpServer {
  id: string;
  name: string;
  server: MCPServerSpec;
  apps: McpApps;
  description?: string;
  homepage?: string;
  docs?: string;
  tags?: string[];
}

/**
 * MCP status
 */
export interface McpStatus {
  user_config_path: string;
  user_config_exists: boolean;
  server_count: number;
}

/**
 * MCP server with its enabled flag for a specific engine
 */
export interface McpServerWithStatus {
  id: string;
  spec: MCPServerSpec;
  enabled: boolean;
}

// ============================================================================
// Legacy MCP types (kept for backward compatibility; deprecated)
// ============================================================================

/**
 * @deprecated Use {@link McpServer} instead.
 */
export interface MCPServer {
  name: string;
  transport: string;
  command?: string;
  args: string[];
  env: Record<string, string>;
  url?: string;
  scope: string;
  is_active: boolean;
  status: ServerStatus;
}

/** @deprecated */
export interface ServerStatus {
  running: boolean;
  error?: string;
  last_checked?: number;
}

/**
 * MCP configuration for project scope (.mcp.json)
 */
export interface MCPProjectConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

/**
 * Individual server configuration in .mcp.json
 */
export interface MCPServerConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * Result of saving clipboard image
 */
export interface SavedImageResult {
  success: boolean;
  file_path?: string;
  error?: string;
}

/**
 * Result of adding a server
 */
export interface AddServerResult {
  success: boolean;
  message: string;
  server_name?: string;
}

/**
 * Translation configuration interface
 */
export interface TranslationConfig {
  enabled: boolean;
  api_base_url: string;
  api_key: string;
  model: string;
  timeout_seconds: number;
  cache_ttl_seconds: number;
}

/**
 * Translation cache statistics
 */
export interface TranslationCacheStats {
  total_entries: number;
  expired_entries: number;
  active_entries: number;
}

/**
 * Auto-compact configuration
 */
export interface AutoCompactConfig {
  enabled: boolean;
  max_context_tokens: number;
  compaction_threshold: number;
  min_compaction_interval: number;
  compaction_strategy: CompactionStrategy;
  preserve_recent_messages: boolean;
  preserve_message_count: number;
  custom_instructions?: string;
}

/**
 * Compaction strategies
 */
export type CompactionStrategy =
  | 'Smart'
  | 'Aggressive'
  | 'Conservative'
  | { Custom: string };

/**
 * Session context information
 */
export interface SessionContext {
  session_id: string;
  project_path: string;
  current_tokens: number;
  message_count: number;
  last_compaction?: string;
  compaction_count: number;
  model: string;
  status: SessionStatus;
}

/**
 * Session status
 */
export type SessionStatus =
  | 'Active'
  | 'Idle'
  | 'Compacting'
  | { CompactionFailed: string };

/**
 * Auto-compact status information
 */
export interface AutoCompactStatus {
  enabled: boolean;
  is_monitoring: boolean;
  sessions_count: number;
  total_compactions: number;
  max_context_tokens: number;
  compaction_threshold: number;
}

/**
 * Import result for multiple servers
 */
export interface ImportResult {
  imported_count: number;
  failed_count: number;
  servers: ImportServerResult[];
}

/**
 * Result for individual server import
 */
export interface ImportServerResult {
  name: string;
  success: boolean;
  error?: string;
}
