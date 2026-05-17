import { invoke } from "@tauri-apps/api/core";
import type { HooksConfiguration } from '@/types/hooks';
import { HooksManager } from '@/lib/hooksManager';
import { codexProviderPresets } from '@/config/codexProviderPresets';

// Re-export all IPC types from the dedicated module for backward compatibility.
// Existing imports like `import { Project, Session } from "@/lib/api"` keep working.
export * from "./api/types";

import type {
  AddServerResult,
  ApiKeyUsage,
  AutoCompactConfig,
  AutoCompactStatus,
  ClaudeExecutionConfig,
  ClaudeMdFile,
  ClaudeSettings,
  ClaudeVersionStatus,
  CodexProviderConfig,
  ConversionResult,
  CurrentCodexConfig,
  CurrentGeminiProviderConfig,
  CurrentProviderConfig,
  FileEntry,
  GeminiProviderConfig,
  ImportResult,
  MCPProjectConfig,
  MCPServer,
  MCPServerSpec,
  McpApps,
  McpServer,
  McpServerWithStatus,
  McpStatus,
  Project,
  ProjectUsage,
  PromptRecord,
  ProviderConfig,
  ResetSafetyInfo,
  RewindCapabilities,
  RewindMode,
  SavedImageResult,
  ServerStatus,
  Session,
  SessionCacheTokens,
  SessionContext,
  TranslationCacheStats,
  TranslationConfig,
  UsageStats,
} from "./api/types";

/**
 * API client for interacting with the Rust backend
 */
export const api = {
  /**
   * Lists all projects in the ~/.claude/projects directory
   * @returns Promise resolving to an array of projects
   */
  async listProjects(): Promise<Project[]> {
    try {
      return await invoke<Project[]>("list_projects");
    } catch (error) {
      console.error("Failed to list projects:", error);
      throw error;
    }
  },

  /**
   * Retrieves sessions for a specific project (both Claude and Codex)
   * @param projectId - The ID of the project to retrieve sessions for
   * @param projectPath - Optional project path to filter Codex sessions (if not provided, tries to infer from Claude sessions)
   * @returns Promise resolving to an array of sessions
   */
  async getProjectSessions(projectId: string, projectPath?: string): Promise<Session[]> {
    try {
      // Get Claude sessions
      const claudeSessions = await invoke<Session[]>('get_project_sessions', { projectId });

      // Get Codex sessions and filter by project path
      const codexSessions = await this.listCodexSessions();

      const targetPath = projectPath || claudeSessions[0]?.project_path;

      // Normalize paths for comparison (handle Windows backslashes and case insensitivity)
      const normalize = (p: string) => p ? p.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase() : '';
      const targetPathNorm = normalize(targetPath || '');

      const filteredCodexSessions: Session[] = codexSessions
        .filter(cs => {
          // If we don't have a target path, we can't filter, so return no Codex sessions
          if (!targetPathNorm) return false;

          const csPathNorm = normalize(cs.projectPath);
          const match = csPathNorm === targetPathNorm;

          return match;
        })
        .map(cs => ({
          id: cs.id,
          project_id: projectId,
          project_path: cs.projectPath,
          created_at: cs.createdAt,
          model: cs.model || 'gpt-5.5',
          engine: 'codex' as const,
          // 🆕 Use actual first message from JSONL file
          first_message: cs.firstMessage || `Codex Session`,
          last_message_timestamp: cs.lastMessageTimestamp,
        }));

      // Merge and sort by creation time
      const allSessions = [...claudeSessions.map(s => ({ ...s, engine: 'claude' as const })), ...filteredCodexSessions];
      allSessions.sort((a, b) => b.created_at - a.created_at);

      return allSessions;
    } catch (error) {
      console.error("Failed to get project sessions:", error);
      throw error;
    }
  },

  /**
   * Deletes a session and all its associated data
   * @param sessionId - The session ID to delete
   * @param projectId - The project ID this session belongs to
   * @returns Promise resolving to success message
   */
  async deleteSession(sessionId: string, projectId: string): Promise<string> {
    try {
      return await invoke<string>('delete_session', { sessionId, projectId });
    } catch (error) {
      console.error("Failed to delete session:", error);
      throw error;
    }
  },

  /**
   * Deletes multiple sessions in batch
   * @param sessionIds - Array of session IDs to delete
   * @param projectId - The project ID these sessions belong to
   * @returns Promise resolving to success message
   */
  async deleteSessionsBatch(sessionIds: string[], projectId: string): Promise<string> {
    try {
      return await invoke<string>('delete_sessions_batch', { sessionIds, projectId });
    } catch (error) {
      console.error("Failed to batch delete sessions:", error);
      throw error;
    }
  },

  /**
   * Removes a project from the project list (without deleting files)
   * @param projectId - The ID of the project to remove from list
   * @returns Promise resolving to success message
   */
  async deleteProject(projectId: string): Promise<string> {
    try {
      return await invoke<string>('delete_project', { projectId });
    } catch (error) {
      console.error("Failed to remove project from list:", error);
      throw error;
    }
  },

  /**
   * Restores a hidden project back to the project list
   * @param projectId - The ID of the project to restore
   * @returns Promise resolving to success message
   */
  async restoreProject(projectId: string): Promise<string> {
    try {
      return await invoke<string>('restore_project', { projectId });
    } catch (error) {
      console.error("Failed to restore project:", error);
      throw error;
    }
  },

  /**
   * Lists all hidden projects
   * @returns Promise resolving to array of hidden project IDs
   */
  async listHiddenProjects(): Promise<string[]> {
    try {
      return await invoke<string[]>('list_hidden_projects');
    } catch (error) {
      console.error("Failed to list hidden projects:", error);
      throw error;
    }
  },

  /**
   * Permanently delete a project and all its files
   * @param projectId - The project ID to permanently delete
   * @returns Promise resolving to success message
   */
  async deleteProjectPermanently(projectId: string): Promise<string> {
    try {
      return await invoke<string>('delete_project_permanently', { projectId });
    } catch (error) {
      console.error("Failed to permanently delete project:", error);
      throw error;
    }
  },

  /**
   * Reads the Claude settings file
   * @returns Promise resolving to the settings object
  */
  async getClaudeSettings(): Promise<ClaudeSettings> {
    try {
      // Due to #[serde(flatten)] in Rust, the result is directly the settings object
      return await invoke<ClaudeSettings>("get_claude_settings");
    } catch (error) {
      console.error("Failed to get Claude settings:", error);
      throw error;
    }
  },

  /**
   * Opens a new Claude Code session
   * @param path - Optional path to open the session in
   * @returns Promise resolving when the session is opened
   */
  async openNewSession(path?: string): Promise<string> {
    try {
      return await invoke<string>("open_new_session", { path });
    } catch (error) {
      console.error("Failed to open new session:", error);
      throw error;
    }
  },

  /**
   * Reads the CLAUDE.md system prompt file
   * @returns Promise resolving to the system prompt content
   */
  async getSystemPrompt(): Promise<string> {
    try {
      return await invoke<string>("get_system_prompt");
    } catch (error) {
      console.error("Failed to get system prompt:", error);
      throw error;
    }
  },

  /**
   * Checks if Claude Code is installed and gets its version
   * @returns Promise resolving to the version status
   */
  async checkClaudeVersion(): Promise<ClaudeVersionStatus> {
    try {
      return await invoke<ClaudeVersionStatus>("check_claude_version");
    } catch (error) {
      console.error("Failed to check Claude version:", error);
      throw error;
    }
  },

  /**
   * Saves the CLAUDE.md system prompt file
   * @param content - The new content for the system prompt
   * @returns Promise resolving when the file is saved
   */
  async saveSystemPrompt(content: string): Promise<string> {
    try {
      return await invoke<string>("save_system_prompt", { content });
    } catch (error) {
      console.error("Failed to save system prompt:", error);
      throw error;
    }
  },

  /**
   * Reads the AGENTS.md system prompt file from Codex directory
   * @returns Promise resolving to the Codex system prompt content
   */
  async getCodexSystemPrompt(): Promise<string> {
    try {
      return await invoke<string>("get_codex_system_prompt");
    } catch (error) {
      console.error("Failed to get Codex system prompt:", error);
      throw error;
    }
  },

  /**
   * Saves the AGENTS.md system prompt file to Codex directory
   * @param content - The new content for the Codex system prompt
   * @returns Promise resolving when the file is saved
   */
  async saveCodexSystemPrompt(content: string): Promise<string> {
    try {
      return await invoke<string>("save_codex_system_prompt", { content });
    } catch (error) {
      console.error("Failed to save Codex system prompt:", error);
      throw error;
    }
  },

  /**
   * Reads the GEMINI.md system prompt file from Gemini directory
   * @returns Promise resolving to the content of GEMINI.md
   */
  async getGeminiSystemPrompt(): Promise<string> {
    try {
      return await invoke<string>("get_gemini_system_prompt");
    } catch (error) {
      console.error("Failed to get Gemini system prompt:", error);
      throw error;
    }
  },

  /**
   * Saves the GEMINI.md system prompt file to Gemini directory
   * @param content - The new content for the Gemini system prompt
   * @returns Promise resolving when the file is saved
   */
  async saveGeminiSystemPrompt(content: string): Promise<string> {
    try {
      return await invoke<string>("save_gemini_system_prompt", { content });
    } catch (error) {
      console.error("Failed to save Gemini system prompt:", error);
      throw error;
    }
  },

  /**
   * Saves the Claude settings file
   * @param settings - The settings object to save
   * @returns Promise resolving when the settings are saved
   */
  async saveClaudeSettings(settings: ClaudeSettings): Promise<string> {
    try {
      return await invoke<string>("save_claude_settings", { settings });
    } catch (error) {
      console.error("Failed to save Claude settings:", error);
      throw error;
    }
  },

  /**
   * Updates the Claude Code effort mode.
   * Sets CLAUDE_CODE_EFFORT_LEVEL env var in settings.json.
   * @param enabled - Whether to enable adaptive thinking
   * @param effort - Effort level: low, medium, high, xhigh, max (only used when enabled)
   * @returns Promise resolving when the settings are updated
   */
  async updateThinkingMode(enabled: boolean, effort?: string): Promise<string> {
    try {
      return await invoke<string>("update_thinking_mode", { enabled, effort });
    } catch (error) {
      console.error("Failed to update thinking mode:", error);
      throw error;
    }
  },

  async updateClaudeFastMode(enabled: boolean): Promise<string> {
    try {
      return await invoke<string>("update_claude_fast_mode", { enabled });
    } catch (error) {
      console.error("Failed to update Claude fast mode:", error);
      throw error;
    }
  },

  /**
   * Get Claude execution configuration
   * @returns Promise resolving to the current execution config
   */
  async getClaudeExecutionConfig(): Promise<ClaudeExecutionConfig> {
    try {
      return await invoke<ClaudeExecutionConfig>("get_claude_execution_config");
    } catch (error) {
      console.error("Failed to get Claude execution config:", error);
      throw error;
    }
  },

  /**
   * Update Claude execution configuration
   * @param config - The new execution configuration
   * @returns Promise resolving when the config is saved
   */
  async updateClaudeExecutionConfig(config: ClaudeExecutionConfig): Promise<void> {
    try {
      return await invoke<void>("update_claude_execution_config", { config });
    } catch (error) {
      console.error("Failed to update Claude execution config:", error);
      throw error;
    }
  },

  /**
   * Finds all CLAUDE.md files in a project directory
   * @param projectPath - The absolute path to the project
   * @returns Promise resolving to an array of CLAUDE.md files
   */
  async findClaudeMdFiles(projectPath: string): Promise<ClaudeMdFile[]> {
    try {
      return await invoke<ClaudeMdFile[]>("find_claude_md_files", { projectPath });
    } catch (error) {
      console.error("Failed to find CLAUDE.md files:", error);
      throw error;
    }
  },

  /**
   * Reads a specific CLAUDE.md file
   * @param filePath - The absolute path to the file
   * @returns Promise resolving to the file content
   */
  async readClaudeMdFile(filePath: string): Promise<string> {
    try {
      return await invoke<string>("read_claude_md_file", { filePath });
    } catch (error) {
      console.error("Failed to read CLAUDE.md file:", error);
      throw error;
    }
  },

  /**
   * Saves a specific CLAUDE.md file
   * @param filePath - The absolute path to the file
   * @param content - The new content for the file
   * @returns Promise resolving when the file is saved
   */
  async saveClaudeMdFile(filePath: string, content: string): Promise<string> {
    try {
      return await invoke<string>("save_claude_md_file", { filePath, content });
    } catch (error) {
      console.error("Failed to save CLAUDE.md file:", error);
      throw error;
    }
  },


  /**
   * Loads the JSONL history for a specific session (Claude or Codex)
   */
  async loadSessionHistory(sessionId: string, projectId: string, engine?: 'claude' | 'codex'): Promise<any[]> {
    // For Codex sessions, read directly from .codex/sessions
    if (engine === 'codex') {
      return this.loadCodexSessionHistory(sessionId);
    }
    // For Claude sessions, use existing backend
    return invoke("load_session_history", { sessionId, projectId });
  },

  /**
   * 🆕 Loads Codex session history from JSONL file
   */
  async loadCodexSessionHistory(sessionId: string): Promise<any[]> {
    try {
      return await invoke("load_codex_session_history", { sessionId });
    } catch (error) {
      console.error("Failed to load Codex session history:", error);
      throw error;
    }
  },

  /**
   * Executes a new interactive Claude Code session with streaming output
   * @param planMode - Enable Plan Mode for read-only research and planning
   * @param tabId - Unique identifier for the tab, used to filter global events
   */
  async executeClaudeCode(projectPath: string, prompt: string, model: string, planMode?: boolean, maxThinkingTokens?: number, tabId?: string, fastMode?: boolean): Promise<void> {
    return invoke("execute_claude_code", { projectPath, prompt, model, planMode, maxThinkingTokens, tabId, fastMode });
  },

  /**
   * Continues an existing Claude Code conversation with streaming output
   * @param planMode - Enable Plan Mode for read-only research and planning
   * @param tabId - Unique identifier for the tab, used to filter global events
   */
  async continueClaudeCode(projectPath: string, prompt: string, model: string, planMode?: boolean, maxThinkingTokens?: number, tabId?: string, fastMode?: boolean): Promise<void> {
    return invoke("continue_claude_code", { projectPath, prompt, model, planMode, maxThinkingTokens, tabId, fastMode });
  },

  /**
   * Resumes an existing Claude Code session by ID with streaming output
   * @param planMode - Enable Plan Mode for read-only research and planning
   * @param tabId - Unique identifier for the tab, used to filter global events
   */
  async resumeClaudeCode(projectPath: string, sessionId: string, prompt: string, model: string, planMode?: boolean, maxThinkingTokens?: number, tabId?: string, fastMode?: boolean): Promise<void> {
    return invoke("resume_claude_code", { projectPath, sessionId, prompt, model, planMode, maxThinkingTokens, tabId, fastMode });
  },

  /**
   * Cancels the currently running Claude Code execution
   * @param sessionId - Optional session ID to cancel a specific session
   */
  async cancelClaudeExecution(sessionId?: string): Promise<void> {
    return invoke("cancel_claude_execution", { sessionId });
  },

  /**
   * Lists all currently running Claude sessions
   * @returns Promise resolving to list of running Claude sessions
   */
  async listRunningClaudeSessions(): Promise<any[]> {
    return invoke("list_running_claude_sessions");
  },

  /**
   * Gets live output from a Claude session
   * @param sessionId - The session ID to get output for
   * @returns Promise resolving to the current live output
   */
  async getClaudeSessionOutput(sessionId: string): Promise<string> {
    return invoke("get_claude_session_output", { sessionId });
  },

  /**
   * Lists files and directories in a given path
   */
  async listDirectoryContents(directoryPath: string): Promise<FileEntry[]> {
    return invoke("list_directory_contents", { directoryPath });
  },

  /**
   * Searches for files and directories matching a pattern
   */
  async searchFiles(basePath: string, query: string): Promise<FileEntry[]> {
    return invoke("search_files", { basePath, query });
  },

  /**
   * Gets overall usage statistics
   * @returns Promise resolving to usage statistics
   */
  async getUsageStats(): Promise<UsageStats> {
    try {
      return await invoke<UsageStats>("get_usage_stats");
    } catch (error) {
      console.error("Failed to get usage stats:", error);
      throw error;
    }
  },


  /**
   * Gets usage statistics filtered by date range
   * @param startDate - Start date (ISO format)
   * @param endDate - End date (ISO format)
   * @returns Promise resolving to usage statistics
   */
  async getUsageByDateRange(startDate: string, endDate: string): Promise<UsageStats> {
    try {
      return await invoke<UsageStats>("get_usage_by_date_range", { startDate, endDate });
    } catch (error) {
      console.error("Failed to get usage by date range:", error);
      throw error;
    }
  },

  /**
   * Gets usage statistics grouped by session
   * @param since - Optional start date (YYYYMMDD)
   * @param until - Optional end date (YYYYMMDD)
   * @param order - Optional sort order ('asc' or 'desc')
   * @returns Promise resolving to an array of session usage data
   */
  async getSessionStats(
    since?: string,
    until?: string,
    order?: "asc" | "desc"
  ): Promise<ProjectUsage[]> {
    try {
      return await invoke<ProjectUsage[]>("get_session_stats", {
        since,
        until,
        order,
      });
    } catch (error) {
      console.error("Failed to get session stats:", error);
      throw error;
    }
  },




  /**
   * Gets cache tokens for a specific session
   * @param sessionId - The session ID to get cache tokens for
   * @returns Promise resolving to session cache tokens
   */
  async getSessionCacheTokens(sessionId: string): Promise<SessionCacheTokens> {
    try {
      return await invoke<SessionCacheTokens>("get_session_cache_tokens", { sessionId });
    } catch (error) {
      console.error("Failed to get session cache tokens:", error);
      throw error;
    }
  },

  // ============================================================================
  // CODEX USAGE STATISTICS
  // ============================================================================

  /**
   * Gets Codex usage statistics
   * @param startDate - Optional start date (YYYY-MM-DD)
   * @param endDate - Optional end date (YYYY-MM-DD)
   * @returns Promise resolving to Codex usage statistics
   */
  async getCodexUsageStats(
    startDate?: string,
    endDate?: string
  ): Promise<import('@/types/usage').CodexUsageStats> {
    try {
      return await invoke<import('@/types/usage').CodexUsageStats>("get_codex_usage_stats", {
        startDate,
        endDate,
      });
    } catch (error) {
      console.error("Failed to get Codex usage stats:", error);
      throw error;
    }
  },

  // ============================================================================
  // GEMINI USAGE STATISTICS
  // ============================================================================

  /**
   * Gets Gemini usage statistics
   * @param startDate - Optional start date (YYYY-MM-DD)
   * @param endDate - Optional end date (YYYY-MM-DD)
   * @returns Promise resolving to Gemini usage statistics
   */
  async getGeminiUsageStats(
    startDate?: string,
    endDate?: string
  ): Promise<import('@/types/usage').GeminiUsageStats> {
    try {
      return await invoke<import('@/types/usage').GeminiUsageStats>("get_gemini_usage_stats", {
        startDate,
        endDate,
      });
    } catch (error) {
      console.error("Failed to get Gemini usage stats:", error);
      throw error;
    }
  },

  // ============================================================================
  // MCP SERVER OPERATIONS
  // ============================================================================

  /**
   * Adds a new MCP server
   */
  async mcpAdd(
    name: string,
    transport: string,
    command?: string,
    args: string[] = [],
    env: Record<string, string> = {},
    url?: string,
    scope: string = "local"
  ): Promise<AddServerResult> {
    try {
      return await invoke<AddServerResult>("mcp_add", {
        name,
        transport,
        command,
        args,
        env,
        url,
        scope
      });
    } catch (error) {
      console.error("Failed to add MCP server:", error);
      throw error;
    }
  },

  /**
   * Lists all configured MCP servers
   */
  async mcpList(): Promise<MCPServer[]> {
    try {
      return await invoke<MCPServer[]>("mcp_list");
    } catch (error) {
      console.error("API: Failed to list MCP servers:", error);
      throw error;
    }
  },

  /**
   * Gets details for a specific MCP server
   */
  async mcpGet(name: string): Promise<MCPServer> {
    try {
      return await invoke<MCPServer>("mcp_get", { name });
    } catch (error) {
      console.error("Failed to get MCP server:", error);
      throw error;
    }
  },

  /**
   * Removes an MCP server
   */
  async mcpRemove(name: string): Promise<string> {
    try {
      return await invoke<string>("mcp_remove", { name });
    } catch (error) {
      console.error("Failed to remove MCP server:", error);
      throw error;
    }
  },

  /**
   * Adds an MCP server from JSON configuration
   */
  async mcpAddJson(name: string, jsonConfig: string, scope: string = "local"): Promise<AddServerResult> {
    try {
      return await invoke<AddServerResult>("mcp_add_json", { name, jsonConfig, scope });
    } catch (error) {
      console.error("Failed to add MCP server from JSON:", error);
      throw error;
    }
  },

  /**
   * Imports MCP servers from Claude Desktop
   */
  async mcpAddFromClaudeDesktop(scope: string = "local"): Promise<ImportResult> {
    try {
      return await invoke<ImportResult>("mcp_add_from_claude_desktop", { scope });
    } catch (error) {
      console.error("Failed to import from Claude Desktop:", error);
      throw error;
    }
  },

  /**
   * Starts Claude Code as an MCP server
   */
  async mcpServe(): Promise<string> {
    try {
      return await invoke<string>("mcp_serve");
    } catch (error) {
      console.error("Failed to start MCP server:", error);
      throw error;
    }
  },

  /**
   * Tests connection to an MCP server
   */
  async mcpTestConnection(name: string): Promise<string> {
    try {
      return await invoke<string>("mcp_test_connection", { name });
    } catch (error) {
      console.error("Failed to test MCP connection:", error);
      throw error;
    }
  },

  /**
   * Exports MCP server configuration from .claude.json
   */
  async mcpExportConfig(): Promise<string> {
    try {
      return await invoke<string>("mcp_export_config");
    } catch (error) {
      console.error("Failed to export MCP configuration:", error);
      throw error;
    }
  },

  /**
   * Resets project-scoped server approval choices
   */
  async mcpResetProjectChoices(): Promise<string> {
    try {
      return await invoke<string>("mcp_reset_project_choices");
    } catch (error) {
      console.error("Failed to reset project choices:", error);
      throw error;
    }
  },

  /**
   * Gets the status of MCP servers
   */
  async mcpGetServerStatus(): Promise<Record<string, ServerStatus>> {
    try {
      return await invoke<Record<string, ServerStatus>>("mcp_get_server_status");
    } catch (error) {
      console.error("Failed to get server status:", error);
      throw error;
    }
  },

  /**
   * Reads .mcp.json from the current project
   */
  async mcpReadProjectConfig(projectPath: string): Promise<MCPProjectConfig> {
    try {
      return await invoke<MCPProjectConfig>("mcp_read_project_config", { projectPath });
    } catch (error) {
      console.error("Failed to read project MCP config:", error);
      throw error;
    }
  },

  /**
   * Saves .mcp.json to the current project
   */
  async mcpSaveProjectConfig(projectPath: string, config: MCPProjectConfig): Promise<string> {
    try {
      return await invoke<string>("mcp_save_project_config", { projectPath, config });
    } catch (error) {
      console.error("Failed to save project MCP config:", error);
      throw error;
    }
  },

  // ============================================================================
  // MCP 多应用支持方法（新版）
  // ============================================================================

  /**
   * 获取 Claude MCP 配置状态
   */
  async mcpGetStatus(): Promise<McpStatus> {
    try {
      return await invoke<McpStatus>("mcp_get_claude_status");
    } catch (error) {
      console.error("Failed to get MCP status:", error);
      throw error;
    }
  },

  /**
   * 获取所有 MCP 服务器（从 Claude 配置）
   * @deprecated 使用 mcpGetUnifiedServers 获取真实的多应用状态
   */
  async mcpGetAllServers(): Promise<Record<string, MCPServerSpec>> {
    try {
      return await invoke<Record<string, MCPServerSpec>>("mcp_get_all_servers");
    } catch (error) {
      console.error("Failed to get all MCP servers:", error);
      throw error;
    }
  },

  /**
   * 获取所有应用的 MCP 服务器统一视图（推荐）
   *
   * 返回合并后的服务器列表，每个服务器的 apps 字段显示真实的启用状态
   * @deprecated 使用 mcpGetEngineServers 代替，按引擎独立管理
   */
  async mcpGetUnifiedServers(): Promise<Record<string, McpServer>> {
    try {
      return await invoke<Record<string, McpServer>>("mcp_get_unified_servers");
    } catch (error) {
      console.error("Failed to get unified MCP servers:", error);
      throw error;
    }
  },

  // ============================================================================
  // 多引擎独立隔离控制 API（新设计）
  // ============================================================================

  /**
   * 获取指定引擎的 MCP 服务器列表
   *
   * @param engine 引擎名称（"claude" | "codex" | "gemini"）
   * @returns 该引擎的 MCP 服务器映射
   */
  async mcpGetEngineServers(
    engine: "claude" | "codex" | "gemini"
  ): Promise<Record<string, MCPServerSpec>> {
    try {
      return await invoke<Record<string, MCPServerSpec>>("mcp_get_engine_servers", {
        engine,
      });
    } catch (error) {
      console.error(`Failed to get ${engine} MCP servers:`, error);
      throw error;
    }
  },

  /**
   * 在指定引擎中添加或更新 MCP 服务器
   *
   * @param engine 引擎名称（"claude" | "codex" | "gemini"）
   * @param id 服务器 ID
   * @param serverSpec 服务器规范
   */
  async mcpUpsertEngineServer(
    engine: "claude" | "codex" | "gemini",
    id: string,
    serverSpec: MCPServerSpec
  ): Promise<string> {
    try {
      return await invoke<string>("mcp_upsert_engine_server", {
        engine,
        id,
        serverSpec,
      });
    } catch (error) {
      console.error(`Failed to upsert ${engine} MCP server:`, error);
      throw error;
    }
  },

  /**
   * 从指定引擎中删除 MCP 服务器
   *
   * @param engine 引擎名称（"claude" | "codex" | "gemini"）
   * @param id 服务器 ID
   */
  async mcpDeleteEngineServer(
    engine: "claude" | "codex" | "gemini",
    id: string
  ): Promise<string> {
    try {
      return await invoke<string>("mcp_delete_engine_server", {
        engine,
        id,
      });
    } catch (error) {
      console.error(`Failed to delete ${engine} MCP server:`, error);
      throw error;
    }
  },

  /**
   * 切换指定引擎中 MCP 服务器的启用状态
   *
   * @param engine 引擎名称（"claude" | "codex" | "gemini"）
   * @param id 服务器 ID
   * @param serverSpec 服务器规范
   * @param enabled 启用状态
   */
  async mcpToggleEngineServer(
    engine: "claude" | "codex" | "gemini",
    id: string,
    serverSpec: MCPServerSpec,
    enabled: boolean
  ): Promise<string> {
    try {
      return await invoke<string>("mcp_toggle_engine_server", {
        engine,
        id,
        serverSpec,
        enabled,
      });
    } catch (error) {
      console.error(`Failed to toggle ${engine} MCP server:`, error);
      throw error;
    }
  },

  /**
   * 带启用状态的 MCP 服务器条目
   */
  // McpServerWithStatus 类型定义在下方

  /**
   * 获取指定引擎的 MCP 服务器列表（包含禁用的服务器）
   *
   * @param engine 引擎名称（"claude" | "codex" | "gemini"）
   * @returns 该引擎的 MCP 服务器列表（包含启用状态）
   */
  async mcpGetEngineServersWithStatus(
    engine: "claude" | "codex" | "gemini"
  ): Promise<McpServerWithStatus[]> {
    try {
      return await invoke<McpServerWithStatus[]>("mcp_get_engine_servers_with_status", {
        engine,
      });
    } catch (error) {
      console.error(`Failed to get ${engine} MCP servers with status:`, error);
      throw error;
    }
  },

  /**
   * 添加或更新 MCP 服务器（支持多应用）
   */
  async mcpUpsertServer(
    id: string,
    name: string,
    serverSpec: MCPServerSpec,
    apps: McpApps
  ): Promise<string> {
    try {
      return await invoke<string>("mcp_upsert_server", {
        id,
        name,
        serverSpec,
        apps,
      });
    } catch (error) {
      console.error("Failed to upsert MCP server:", error);
      throw error;
    }
  },

  /**
   * 删除 MCP 服务器（从所有应用）
   */
  async mcpDeleteServer(id: string, apps: McpApps): Promise<string> {
    try {
      return await invoke<string>("mcp_delete_server", { id, apps });
    } catch (error) {
      console.error("Failed to delete MCP server:", error);
      throw error;
    }
  },

  /**
   * 切换 MCP 服务器在指定应用的启用状态
   */
  async mcpToggleApp(
    id: string,
    serverSpec: MCPServerSpec,
    app: string,
    enabled: boolean
  ): Promise<string> {
    try {
      return await invoke<string>("mcp_toggle_app", {
        id,
        serverSpec,
        app,
        enabled,
      });
    } catch (error) {
      console.error("Failed to toggle MCP app:", error);
      throw error;
    }
  },

  /**
   * 从指定应用导入 MCP 服务器
   */
  async mcpImportFromApp(app: string): Promise<string[]> {
    try {
      return await invoke<string[]>("mcp_import_from_app", { app });
    } catch (error) {
      console.error("Failed to import from app:", error);
      throw error;
    }
  },

  /**
   * 验证命令是否在 PATH 中可用
   */
  async mcpValidateCommand(cmd: string): Promise<boolean> {
    try {
      return await invoke<boolean>("mcp_validate_command", { cmd });
    } catch (error) {
      console.error("Failed to validate command:", error);
      throw error;
    }
  },

  /**
   * 读取 Claude MCP 配置文本内容
   */
  async mcpReadClaudeConfig(): Promise<string | null> {
    try {
      return await invoke<string | null>("mcp_read_claude_config");
    } catch (error) {
      console.error("Failed to read Claude MCP config:", error);
      throw error;
    }
  },

  /**
   * Get the stored Claude binary path from settings
   * @returns Promise resolving to the path if set, null otherwise
   */
  async getClaudeBinaryPath(): Promise<string | null> {
    try {
      return await invoke<string | null>("get_claude_binary_path");
    } catch (error) {
      console.error("Failed to get Claude binary path:", error);
      throw error;
    }
  },

  /**
   * Set the Claude binary path in settings
   * @param path - The absolute path to the Claude binary
   * @returns Promise resolving when the path is saved
   */
  async setClaudeBinaryPath(path: string): Promise<void> {
    try {
      return await invoke<void>("set_claude_binary_path", { path });
    } catch (error) {
      console.error("Failed to set Claude binary path:", error);
      throw error;
    }
  },


  // Storage API methods

  /**
   * Lists all tables in the SQLite database
   * @returns Promise resolving to an array of table information
   */
  async storageListTables(): Promise<any[]> {
    try {
      return await invoke<any[]>("storage_list_tables");
    } catch (error) {
      console.error("Failed to list tables:", error);
      throw error;
    }
  },

  /**
   * Reads table data with pagination
   * @param tableName - Name of the table to read
   * @param page - Page number (1-indexed)
   * @param pageSize - Number of rows per page
   * @param searchQuery - Optional search query
   * @returns Promise resolving to table data with pagination info
   */
  async storageReadTable(
    tableName: string,
    page: number,
    pageSize: number,
    searchQuery?: string
  ): Promise<any> {
    try {
      return await invoke<any>("storage_read_table", {
        tableName,
        page,
        pageSize,
        searchQuery,
      });
    } catch (error) {
      console.error("Failed to read table:", error);
      throw error;
    }
  },

  /**
   * Updates a row in a table
   * @param tableName - Name of the table
   * @param primaryKeyValues - Map of primary key column names to values
   * @param updates - Map of column names to new values
   * @returns Promise resolving when the row is updated
   */
  async storageUpdateRow(
    tableName: string,
    primaryKeyValues: Record<string, any>,
    updates: Record<string, any>
  ): Promise<void> {
    try {
      return await invoke<void>("storage_update_row", {
        tableName,
        primaryKeyValues,
        updates,
      });
    } catch (error) {
      console.error("Failed to update row:", error);
      throw error;
    }
  },

  /**
   * Deletes a row from a table
   * @param tableName - Name of the table
   * @param primaryKeyValues - Map of primary key column names to values
   * @returns Promise resolving when the row is deleted
   */
  async storageDeleteRow(
    tableName: string,
    primaryKeyValues: Record<string, any>
  ): Promise<void> {
    try {
      return await invoke<void>("storage_delete_row", {
        tableName,
        primaryKeyValues,
      });
    } catch (error) {
      console.error("Failed to delete row:", error);
      throw error;
    }
  },

  /**
   * Inserts a new row into a table
   * @param tableName - Name of the table
   * @param values - Map of column names to values
   * @returns Promise resolving to the last insert row ID
   */
  async storageInsertRow(
    tableName: string,
    values: Record<string, any>
  ): Promise<number> {
    try {
      return await invoke<number>("storage_insert_row", {
        tableName,
        values,
      });
    } catch (error) {
      console.error("Failed to insert row:", error);
      throw error;
    }
  },

  /**
   * Executes a raw SQL query
   * @param query - SQL query string
   * @returns Promise resolving to query result
   */
  async storageExecuteSql(query: string): Promise<any> {
    try {
      return await invoke<any>("storage_execute_sql", { query });
    } catch (error) {
      console.error("Failed to execute SQL:", error);
      throw error;
    }
  },

  /**
   * Resets the entire database
   * @returns Promise resolving when the database is reset
   */
  async storageResetDatabase(): Promise<void> {
    try {
      return await invoke<void>("storage_reset_database");
    } catch (error) {
      console.error("Failed to reset database:", error);
      throw error;
    }
  },

  /**
   * Get hooks configuration for a specific scope
   * @param scope - The configuration scope: 'user', 'project', or 'local'
   * @param projectPath - Project path (required for project and local scopes)
   * @returns Promise resolving to the hooks configuration
   */
  async getHooksConfig(scope: 'user' | 'project' | 'local', projectPath?: string): Promise<HooksConfiguration> {
    try {
      return await invoke<HooksConfiguration>("get_hooks_config", { scope, projectPath });
    } catch (error) {
      console.error("Failed to get hooks config:", error);
      throw error;
    }
  },

  /**
   * Update hooks configuration for a specific scope
   * @param scope - The configuration scope: 'user', 'project', or 'local'
   * @param hooks - The hooks configuration to save
   * @param projectPath - Project path (required for project and local scopes)
   * @returns Promise resolving to success message
   */
  async updateHooksConfig(
    scope: 'user' | 'project' | 'local',
    hooks: HooksConfiguration,
    projectPath?: string
  ): Promise<string> {
    try {
      return await invoke<string>("update_hooks_config", { scope, projectPath, hooks });
    } catch (error) {
      console.error("Failed to update hooks config:", error);
      throw error;
    }
  },

  /**
   * Validate a hook command syntax
   * @param command - The shell command to validate
   * @returns Promise resolving to validation result
   */
  async validateHookCommand(command: string): Promise<{ valid: boolean; message: string }> {
    try {
      return await invoke<{ valid: boolean; message: string }>("validate_hook_command", { command });
    } catch (error) {
      console.error("Failed to validate hook command:", error);
      throw error;
    }
  },

  /**
   * Get merged hooks configuration (respecting priority)
   * @param projectPath - The project path
   * @returns Promise resolving to merged hooks configuration
   */
  async getMergedHooksConfig(projectPath: string): Promise<HooksConfiguration> {
    try {
      const [userHooks, projectHooks, localHooks] = await Promise.all([
        this.getHooksConfig('user'),
        this.getHooksConfig('project', projectPath),
        this.getHooksConfig('local', projectPath)
      ]);

      return HooksManager.mergeConfigs(userHooks, projectHooks, localHooks);
    } catch (error) {
      console.error("Failed to get merged hooks config:", error);
      throw error;
    }
  },


  /**
   * Set custom Claude CLI path
   * @param customPath - Path to custom Claude CLI executable
   * @returns Promise resolving when path is set successfully
   */
  async setCustomClaudePath(customPath: string): Promise<void> {
    try {
      return await invoke<void>("set_custom_claude_path", { customPath });
    } catch (error) {
      console.error("Failed to set custom Claude path:", error);
      throw error;
    }
  },

  /**
   * Get current Claude CLI path (custom or auto-detected)
   * @returns Promise resolving to current Claude CLI path
   */
  async getClaudePath(): Promise<string> {
    try {
      return await invoke<string>("get_claude_path");
    } catch (error) {
      console.error("Failed to get Claude path:", error);
      throw error;
    }
  },

  /**
   * Clear custom Claude CLI path and revert to auto-detection
   * @returns Promise resolving when custom path is cleared
   */
  async clearCustomClaudePath(): Promise<void> {
    try {
      return await invoke<void>("clear_custom_claude_path");
    } catch (error) {
      console.error("Failed to clear custom Claude path:", error);
      throw error;
    }
  },



  // Clipboard API methods

  /**
   * Saves clipboard image data to a temporary file
   * @param base64Data - Base64 encoded image data
   * @param format - Optional image format
   * @returns Promise resolving to saved image result
   */
  async saveClipboardImage(base64Data: string, format?: string): Promise<SavedImageResult> {
    try {
      return await invoke<SavedImageResult>("save_clipboard_image", { base64Data, format });
    } catch (error) {
      console.error("Failed to save clipboard image:", error);
      throw error;
    }
  },

  // Provider Management API methods

  /**
   * Gets the list of preset provider configurations
   * @returns Promise resolving to array of provider configurations
   */
  async getProviderPresets(): Promise<ProviderConfig[]> {
    try {
      return await invoke<ProviderConfig[]>("get_provider_presets");
    } catch (error) {
      console.error("Failed to get provider presets:", error);
      throw error;
    }
  },

  /**
   * Gets the current provider configuration from environment variables
   * @returns Promise resolving to current configuration
   */
  async getCurrentProviderConfig(): Promise<CurrentProviderConfig> {
    try {
      return await invoke<CurrentProviderConfig>("get_current_provider_config");
    } catch (error) {
      console.error("Failed to get current provider config:", error);
      throw error;
    }
  },

  /**
   * Switches to a new provider configuration
   * @param config - The provider configuration to switch to
   * @returns Promise resolving to success message
   */
  async switchProviderConfig(config: ProviderConfig): Promise<string> {
    try {
      return await invoke<string>("switch_provider_config", { config });
    } catch (error) {
      console.error("Failed to switch provider config:", error);
      throw error;
    }
  },

  /**
   * Clears all provider-related environment variables
   * @returns Promise resolving to success message
   */
  async clearProviderConfig(): Promise<string> {
    try {
      return await invoke<string>("clear_provider_config");
    } catch (error) {
      console.error("Failed to clear provider config:", error);
      throw error;
    }
  },

  /**
   * Tests connection to a provider endpoint
   * @param baseUrl - The base URL to test
   * @returns Promise resolving to test result message
   */
  async testProviderConnection(baseUrl: string): Promise<string> {
    try {
      return await invoke<string>("test_provider_connection", { baseUrl });
    } catch (error) {
      console.error("Failed to test provider connection:", error);
      throw error;
    }
  },

  /**
   * Adds a new provider configuration
   * @param config - The provider configuration to add
   * @returns Promise resolving to success message
   */
  async addProviderConfig(config: Omit<ProviderConfig, 'id'>): Promise<string> {
    // Generate ID from name
    const id = config.name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    const fullConfig: ProviderConfig = {
      ...config,
      id
    };

    try {
      return await invoke<string>("add_provider_config", { config: fullConfig });
    } catch (error) {
      console.error("Failed to add provider config:", error);
      throw error;
    }
  },

  /**
   * Updates an existing provider configuration
   * @param config - The provider configuration to update (with id)
   * @returns Promise resolving to success message
   */
  async updateProviderConfig(config: ProviderConfig): Promise<string> {
    try {
      return await invoke<string>("update_provider_config", { config });
    } catch (error) {
      console.error("Failed to update provider config:", error);
      throw error;
    }
  },

  /**
   * Deletes a provider configuration by ID
   * @param id - The ID of the provider configuration to delete
   * @returns Promise resolving to success message
   */
  async deleteProviderConfig(id: string): Promise<string> {
    try {
      return await invoke<string>("delete_provider_config", { id });
    } catch (error) {
      console.error("Failed to delete provider config:", error);
      throw error;
    }
  },

  /**
   * Gets a single provider configuration by ID
   * @param id - The ID of the provider configuration to get
   * @returns Promise resolving to provider configuration
   */
  async getProviderConfig(id: string): Promise<ProviderConfig> {
    try {
      return await invoke<ProviderConfig>("get_provider_config", { id });
    } catch (error) {
      console.error("Failed to get provider config:", error);
      throw error;
    }
  },

  /**
   * Queries API Key usage/balance from the provider
   * @param baseUrl - The base URL of the provider API
   * @param apiKey - The API key to query usage for
   * @returns Promise resolving to API key usage information
   */
  async queryProviderUsage(baseUrl: string, apiKey: string): Promise<ApiKeyUsage> {
    try {
      return await invoke<ApiKeyUsage>("query_provider_usage", { baseUrl, apiKey });
    } catch (error) {
      console.error("Failed to query provider usage:", error);
      throw error;
    }
  },

  /**
   * Reorders provider configurations
   * @param ids - Array of provider IDs in the desired order
   * @returns Promise resolving to success message
   */
  async reorderProviderConfigs(ids: string[]): Promise<string> {
    try {
      return await invoke<string>("reorder_provider_configs", { ids });
    } catch (error) {
      console.error("Failed to reorder provider configs:", error);
      throw error;
    }
  },


  // ============================================================================
  // ACEMCP INTEGRATION
  // ============================================================================

  /**
   * Enhances a prompt by adding project context from acemcp semantic search
   * 🆕 v2: 支持历史上下文感知和多轮搜索
   *
   * @param prompt - The original prompt to enhance
   * @param projectPath - Path to the project directory
   * @param sessionId - 🆕 Optional session ID for history-aware search
   * @param projectId - 🆕 Optional project ID for history-aware search
   * @param maxContextLength - Maximum length of context to include (default: 3000)
   * @param enableMultiRound - 🆕 Enable multi-round search for better coverage (default: true)
   * @returns Promise resolving to enhancement result
   */
  async enhancePromptWithContext(
    prompt: string,
    projectPath: string,
    sessionId?: string,
    projectId?: string,
    maxContextLength?: number,
    enableMultiRound?: boolean
  ): Promise<{
    originalPrompt: string;
    enhancedPrompt: string;
    contextCount: number;
    acemcpUsed: boolean;
    error?: string;
  }> {
    try {
      return await invoke("enhance_prompt_with_context", {
        prompt,
        projectPath,
        sessionId,
        projectId,
        maxContextLength,
        enableMultiRound,
      });
    } catch (error) {
      console.error("Failed to enhance prompt with context:", error);
      throw error;
    }
  },

  /**
   * Tests if acemcp is available and can be used
   * @returns Promise resolving to true if acemcp is available
   */
  async testAcemcpAvailability(): Promise<boolean> {
    try {
      return await invoke<boolean>("test_acemcp_availability");
    } catch (error) {
      console.error("Failed to test acemcp availability:", error);
      return false;
    }
  },

  /**
   * Saves acemcp configuration to ~/.acemcp/settings.toml
   */
  async saveAcemcpConfig(
    baseUrl: string,
    token: string,
    batchSize?: number,
    maxLinesPerBlob?: number
  ): Promise<void> {
    try {
      return await invoke("save_acemcp_config", {
        baseUrl,
        token,
        batchSize,
        maxLinesPerBlob,
      });
    } catch (error) {
      console.error("Failed to save acemcp config:", error);
      throw error;
    }
  },

  /**
   * Loads acemcp configuration from ~/.acemcp/settings.toml
   */
  async loadAcemcpConfig(): Promise<{
    baseUrl: string;
    token: string;
    batchSize?: number;
    maxLinesPerBlob?: number;
  }> {
    try {
      return await invoke("load_acemcp_config");
    } catch (error) {
      console.error("Failed to load acemcp config:", error);
      // 返回默认配置
      return {
        baseUrl: '',
        token: '',
        batchSize: 10,
        maxLinesPerBlob: 800,
      };
    }
  },

  /**
   * Pre-indexes a project in background (non-blocking)
   * Automatically triggered when user selects a project
   */
  async preindexProject(projectPath: string): Promise<void> {
    try {
      // 后台执行，不等待结果
      invoke("preindex_project", { projectPath }).catch((error) => {
        console.warn("Background pre-indexing failed:", error);
      });
    } catch (error) {
      console.warn("Failed to start pre-indexing:", error);
    }
  },

  /**
   * Exports the embedded acemcp sidecar to a specified path
   * For CLI configuration
   */
  async exportAcemcpSidecar(targetPath: string): Promise<string> {
    try {
      return await invoke<string>("export_acemcp_sidecar", { targetPath });
    } catch (error) {
      console.error("Failed to export sidecar:", error);
      throw error;
    }
  },

  /**
   * Gets the path of extracted sidecar in temp directory (if exists)
   */
  async getExtractedSidecarPath(): Promise<string | null> {
    try {
      return await invoke<string | null>("get_extracted_sidecar_path");
    } catch (error) {
      console.error("Failed to get extracted sidecar path:", error);
      return null;
    }
  },

  // Translation API methods

  /**
   * Translates text using the translation service
   * @param text - The text to translate
   * @param targetLang - Optional target language (defaults to auto-detection)
   * @returns Promise resolving to translated text
   */
  async translateText(text: string, targetLang?: string): Promise<string> {
    try {
      return await invoke<string>("translate", { text, targetLang });
    } catch (error) {
      console.error("Failed to translate text:", error);
      throw error;
    }
  },

  /**
   * Translates multiple texts in batch
   * @param texts - Array of texts to translate
   * @param targetLang - Optional target language
   * @returns Promise resolving to array of translated texts
   */
  async translateBatch(texts: string[], targetLang?: string): Promise<string[]> {
    try {
      return await invoke<string[]>("translate_batch", { texts, targetLang });
    } catch (error) {
      console.error("Failed to batch translate texts:", error);
      throw error;
    }
  },

  /**
   * Gets the current translation configuration
   * @returns Promise resolving to translation configuration
   */
  async getTranslationConfig(): Promise<TranslationConfig> {
    try {
      return await invoke<TranslationConfig>("get_translation_config");
    } catch (error) {
      console.error("Failed to get translation config:", error);
      throw error;
    }
  },

  /**
   * Updates the translation configuration
   * @param config - New translation configuration
   * @returns Promise resolving to success message
   */
  async updateTranslationConfig(config: TranslationConfig): Promise<string> {
    try {
      return await invoke<string>("update_translation_config", { config });
    } catch (error) {
      console.error("Failed to update translation config:", error);
      throw error;
    }
  },

  /**
   * Clears the translation cache
   * @returns Promise resolving to success message
   */
  async clearTranslationCache(): Promise<string> {
    try {
      return await invoke<string>("clear_translation_cache");
    } catch (error) {
      console.error("Failed to clear translation cache:", error);
      throw error;
    }
  },

  /**
   * Gets translation cache statistics
   * @returns Promise resolving to cache statistics
   */
  async getTranslationCacheStats(): Promise<TranslationCacheStats> {
    try {
      return await invoke<TranslationCacheStats>("get_translation_cache_stats");
    } catch (error) {
      console.error("Failed to get translation cache stats:", error);
      throw error;
    }
  },

  /**
   * Detects the language of the given text
   * @param text - The text to analyze
   * @returns Promise resolving to detected language code
   */
  async detectTextLanguage(text: string): Promise<string> {
    try {
      return await invoke<string>("detect_text_language", { text });
    } catch (error) {
      console.error("Failed to detect text language:", error);
      throw error;
    }
  },

  /**
   * Initializes the translation service
   * @param config - Optional translation configuration
   * @returns Promise resolving to success message
   */
  async initTranslationService(config?: TranslationConfig): Promise<string> {
    try {
      return await invoke<string>("init_translation_service_command", { config });
    } catch (error) {
      console.error("Failed to initialize translation service:", error);
      throw error;
    }
  },

  // Auto-Compact Context Management API methods

  /**
   * Initializes the auto-compact manager
   * @returns Promise resolving when manager is initialized
   */
  async initAutoCompactManager(): Promise<void> {
    try {
      return await invoke<void>("init_auto_compact_manager");
    } catch (error) {
      console.error("Failed to initialize auto-compact manager:", error);
      throw error;
    }
  },

  /**
   * Registers a Claude session for auto-compact monitoring
   * @param sessionId - The session ID to register
   * @param projectPath - The project path
   * @param model - The model being used
   * @returns Promise resolving when session is registered
   */
  async registerAutoCompactSession(sessionId: string, projectPath: string, model: string): Promise<void> {
    try {
      return await invoke<void>("register_auto_compact_session", { sessionId, projectPath, model });
    } catch (error) {
      console.error("Failed to register auto-compact session:", error);
      throw error;
    }
  },

  /**
   * Updates session token count and checks for auto-compact trigger
   * @param sessionId - The session ID
   * @param tokenCount - Current token count
   * @returns Promise resolving to whether compaction was triggered
   */
  async updateSessionContext(sessionId: string, tokenCount: number): Promise<boolean> {
    try {
      return await invoke<boolean>("update_session_context", { sessionId, tokenCount });
    } catch (error) {
      console.error("Failed to update session context:", error);
      throw error;
    }
  },

  /**
   * Manually triggers compaction for a session
   * @param sessionId - The session ID
   * @param customInstructions - Optional custom compaction instructions
   * @returns Promise resolving when compaction is complete
   */
  async triggerManualCompaction(sessionId: string, customInstructions?: string): Promise<void> {
    try {
      return await invoke<void>("trigger_manual_compaction", { sessionId, customInstructions });
    } catch (error) {
      console.error("Failed to trigger manual compaction:", error);
      throw error;
    }
  },

  /**
   * Gets the current auto-compact configuration
   * @returns Promise resolving to the configuration
   */
  async getAutoCompactConfig(): Promise<AutoCompactConfig> {
    try {
      return await invoke<AutoCompactConfig>("get_auto_compact_config");
    } catch (error) {
      console.error("Failed to get auto-compact config:", error);
      throw error;
    }
  },

  /**
   * Updates the auto-compact configuration
   * @param config - The new configuration
   * @returns Promise resolving when configuration is updated
   */
  async updateAutoCompactConfig(config: AutoCompactConfig): Promise<void> {
    try {
      return await invoke<void>("update_auto_compact_config", { config });
    } catch (error) {
      console.error("Failed to update auto-compact config:", error);
      throw error;
    }
  },

  /**
   * Gets session context statistics
   * @param sessionId - The session ID
   * @returns Promise resolving to session context information
   */
  async getSessionContextStats(sessionId: string): Promise<SessionContext | null> {
    try {
      return await invoke<SessionContext | null>("get_session_context_stats", { sessionId });
    } catch (error) {
      console.error("Failed to get session context stats:", error);
      throw error;
    }
  },

  /**
   * Gets all monitored sessions
   * @returns Promise resolving to array of session contexts
   */
  async getAllMonitoredSessions(): Promise<SessionContext[]> {
    try {
      return await invoke<SessionContext[]>("get_all_monitored_sessions");
    } catch (error) {
      console.error("Failed to get monitored sessions:", error);
      throw error;
    }
  },

  /**
   * Unregisters session from auto-compact monitoring
   * @param sessionId - The session ID to unregister
   * @returns Promise resolving when session is unregistered
   */
  async unregisterAutoCompactSession(sessionId: string): Promise<void> {
    try {
      return await invoke<void>("unregister_auto_compact_session", { sessionId });
    } catch (error) {
      console.error("Failed to unregister auto-compact session:", error);
      throw error;
    }
  },

  /**
   * Stops auto-compact monitoring
   * @returns Promise resolving when monitoring is stopped
   */
  async stopAutoCompactMonitoring(): Promise<void> {
    try {
      return await invoke<void>("stop_auto_compact_monitoring");
    } catch (error) {
      console.error("Failed to stop auto-compact monitoring:", error);
      throw error;
    }
  },

  /**
   * Starts auto-compact monitoring
   * @returns Promise resolving when monitoring is started
   */
  async startAutoCompactMonitoring(): Promise<void> {
    try {
      return await invoke<void>("start_auto_compact_monitoring");
    } catch (error) {
      console.error("Failed to start auto-compact monitoring:", error);
      throw error;
    }
  },

  /**
   * Gets auto-compact status and statistics
   * @returns Promise resolving to status information
   */
  async getAutoCompactStatus(): Promise<AutoCompactStatus> {
    try {
      return await invoke<AutoCompactStatus>("get_auto_compact_status");
    } catch (error) {
      console.error("Failed to get auto-compact status:", error);
      throw error;
    }
  },

  /**
   * Gets active sessions information
   * @returns Promise resolving to array of active session info
   */
  async getActiveSessions(): Promise<any[]> {
    try {
      return await invoke("get_active_sessions");
    } catch (error) {
      console.error('Failed to get active sessions:', error);
      throw error;
    }
  },

  // Subagent Management & Specialization API methods








  // Enhanced Hooks Automation API methods

  /**
   * Triggers a hook event with context
   * @param event - The hook event name
   * @param context - The hook execution context
   * @returns Promise resolving to hook chain execution result
   */
  async triggerHookEvent(event: string, context: any): Promise<any> {
    try {
      return await invoke<any>("trigger_hook_event", { event, context });
    } catch (error) {
      console.error("Failed to trigger hook event:", error);
      throw error;
    }
  },

  /**
   * Tests a hook condition expression
   * @param condition - The condition expression to test
   * @param context - The hook context for evaluation
   * @returns Promise resolving to whether condition is true
   */
  async testHookCondition(condition: string, context: any): Promise<boolean> {
    try {
      return await invoke<boolean>("test_hook_condition", { condition, context });
    } catch (error) {
      console.error("Failed to test hook condition:", error);
      throw error;
    }
  },

  /**
   * Executes pre-commit code review hook with intelligent decision making
   * @param projectPath - The project path to review
   * @param config - Optional configuration for the review hook
   * @returns Promise resolving to commit decision
   */
  async executePreCommitReview(
    projectPath: string,
    config?: import('@/types/enhanced-hooks').PreCommitCodeReviewConfig
  ): Promise<import('@/types/enhanced-hooks').CommitDecision> {
    try {
      return await invoke<import('@/types/enhanced-hooks').CommitDecision>("execute_pre_commit_review", {
        projectPath,
        config
      });
    } catch (error) {
      console.error("Failed to execute pre-commit review:", error);
      throw error;
    }
  },

  // ==================== Checkpoint API Methods ====================

  /**
  /**
   * Tracks a batch of messages for a session for checkpointing
   */
  async trackSessionMessages(
    sessionId: string,
    projectId: string,
    projectPath: string,
    messages: string[]
  ): Promise<void> {
    try {
      return await invoke<void>("track_session_messages", {
        sessionId,
        projectId,
        projectPath,
        messages
      });
    } catch (error) {
      console.error("Failed to track session messages:", error);
      throw error;
    }
  },

  // ==================== Prompt Revert System ====================

  /**
   * Check and initialize Git repository
   */
  async checkAndInitGit(projectPath: string): Promise<boolean> {
    try {
      return await invoke<boolean>("check_and_init_git", { projectPath });
    } catch (error) {
      console.error("Failed to check/init Git:", error);
      return false;
    }
  },

  /**
   * Check if a git reset operation is safe
   * This prevents accidentally reverting to a much older version when
   * multiple engines or user manual commits are involved
   */
  async checkResetSafety(
    projectPath: string,
    targetCommit: string,
    currentEngine: string
  ): Promise<ResetSafetyInfo> {
    try {
      return await invoke<ResetSafetyInfo>("check_reset_safety", {
        projectPath,
        targetCommit,
        currentEngine,
      });
    } catch (error) {
      console.error("Failed to check reset safety:", error);
      // Return a safe default that allows proceeding
      return {
        commitsToLose: 0,
        hasOtherEngineCommits: false,
        hasUserCommits: false,
        commitsSummary: [],
        safeToProceed: true,
        warning: null,
      };
    }
  },

  /**
   * Record a prompt being sent
   */
  async recordPromptSent(
    sessionId: string,
    projectId: string,
    projectPath: string,
    promptText: string
  ): Promise<number> {
    try {
      return await invoke<number>("record_prompt_sent", {
        sessionId,
        projectId,
        projectPath,
        promptText
      });
    } catch (error) {
      console.error("Failed to record prompt:", error);
      throw error;
    }
  },

  /**
   * Mark a prompt as completed
   */
  async markPromptCompleted(
    sessionId: string,
    projectId: string,
    projectPath: string,
    promptIndex: number,
    promptText?: string
  ): Promise<void> {
    try {
      const payload: Record<string, unknown> = {
        sessionId,
        projectId,
        projectPath,
        promptIndex
      };
      if (promptText !== undefined) {
        payload.promptText = promptText;
      }
      return await invoke<void>("mark_prompt_completed", {
        ...payload
      });
    } catch (error) {
      console.error("Failed to mark prompt completed:", error);
      throw error;
    }
  },

  /**
   * Revert to a specific prompt with support for different rewind modes
   */
  async revertToPrompt(
    sessionId: string,
    projectId: string,
    projectPath: string,
    promptIndex: number,
    mode: RewindMode = "both"
  ): Promise<string> {
    try {
      return await invoke<string>("revert_to_prompt", {
        sessionId,
        projectId,
        projectPath,
        promptIndex,
        mode
      });
    } catch (error) {
      console.error("Failed to revert to prompt:", error);
      throw error;
    }
  },

  /**
   * Get list of all prompts for a session
   * Extracts all prompts from .jsonl (single source of truth)
   */
  async getPromptList(
    sessionId: string,
    projectId: string
  ): Promise<PromptRecord[]> {
    try {
      return await invoke<PromptRecord[]>("get_prompt_list", {
        sessionId,
        projectId
      });
    } catch (error) {
      console.error("Failed to get prompt list:", error);
      return [];
    }
  },

  /**
   * Get unified prompt list with git records enriched from .git-records.json
   * Combines .jsonl prompts (all messages) with git records (hash-based mapping)
   * This includes both project interface prompts (with git records) and CLI prompts (without git records)
   */
  async getUnifiedPromptList(
    sessionId: string,
    projectId: string
  ): Promise<PromptRecord[]> {
    try {
      return await invoke<PromptRecord[]>("get_unified_prompt_list", {
        sessionId,
        projectId
      });
    } catch (error) {
      console.error("Failed to get unified prompt list:", error);
      return [];
    }
  },

  /**
   * Check rewind capabilities for a specific prompt
   * Determines whether a prompt can be reverted fully (conversation + code) or partially (conversation only)
   */
  async checkRewindCapabilities(
    sessionId: string,
    projectId: string,
    promptIndex: number
  ): Promise<RewindCapabilities> {
    try {
      return await invoke<RewindCapabilities>("check_rewind_capabilities", {
        sessionId,
        projectId,
        promptIndex
      });
    } catch (error) {
      console.error("Failed to check rewind capabilities:", error);
      throw error;
    }
  },

  // ==================== Claude Extensions (Plugins, Subagents & Skills) ====================

  /**
   * List all installed plugins
   */
  async listPlugins(projectPath?: string): Promise<any[]> {
    try {
      return await invoke<any[]>("list_plugins", { projectPath });
    } catch (error) {
      console.error("Failed to list plugins:", error);
      return [];
    }
  },

  /**
   * Toggle a plugin's enabled/disabled state
   * @param pluginName - The plugin key (e.g. "plugin-name@marketplace")
   * @returns The new enabled state (true = enabled, false = disabled)
   */
  async togglePluginEnabled(pluginName: string): Promise<boolean> {
    try {
      return await invoke<boolean>("toggle_plugin_enabled", { pluginName });
    } catch (error) {
      console.error("Failed to toggle plugin enabled state:", error);
      throw error;
    }
  },

  /**
   * Uninstall a plugin completely
   * @param pluginName - The plugin key (e.g. "plugin-name@marketplace")
   */
  async uninstallPlugin(pluginName: string): Promise<void> {
    try {
      return await invoke<void>("uninstall_plugin", { pluginName });
    } catch (error) {
      console.error("Failed to uninstall plugin:", error);
      throw error;
    }
  },

  /**
   * Reinstall a plugin from its marketplace source
   * @param pluginSource - The marketplace source identifier
   * @returns CLI output from the reinstall command
   */
  async reinstallPlugin(pluginSource: string): Promise<string> {
    try {
      return await invoke<string>("reinstall_plugin", { pluginSource });
    } catch (error) {
      console.error("Failed to reinstall plugin:", error);
      throw error;
    }
  },

  /**
   * Open plugins directory
   */
  async openPluginsDirectory(projectPath?: string): Promise<string> {
    try {
      return await invoke<string>("open_plugins_directory", { projectPath });
    } catch (error) {
      console.error("Failed to open plugins directory:", error);
      throw error;
    }
  },

  /**
   * List all subagents
   */
  async listSubagents(projectPath?: string): Promise<any[]> {
    try {
      return await invoke<any[]>("list_subagents", { projectPath });
    } catch (error) {
      console.error("Failed to list subagents:", error);
      return [];
    }
  },

  /**
   * List all agent skills
   */
  async listAgentSkills(projectPath?: string): Promise<any[]> {
    try {
      return await invoke<any[]>("list_agent_skills", { projectPath });
    } catch (error) {
      console.error("Failed to list agent skills:", error);
      return [];
    }
  },

  /**
   * Read a subagent file
   */
  async readSubagent(filePath: string): Promise<string> {
    try {
      return await invoke<string>("read_subagent", { filePath });
    } catch (error) {
      console.error("Failed to read subagent:", error);
      throw error;
    }
  },

  /**
   * Read a skill file
   */
  async readSkill(filePath: string): Promise<string> {
    try {
      return await invoke<string>("read_skill", { filePath });
    } catch (error) {
      console.error("Failed to read skill:", error);
      throw error;
    }
  },

  /**
   * Open agents directory in file explorer
   */
  async openAgentsDirectory(projectPath?: string): Promise<string> {
    try {
      return await invoke<string>("open_agents_directory", { projectPath });
    } catch (error) {
      console.error("Failed to open agents directory:", error);
      throw error;
    }
  },

  /**
   * Open skills directory in file explorer
   */
  async openSkillsDirectory(projectPath?: string): Promise<string> {
    try {
      return await invoke<string>("open_skills_directory", { projectPath });
    } catch (error) {
      console.error("Failed to open skills directory:", error);
      throw error;
    }
  },

  /**
   * Create a new subagent
   * @param name - Agent name (alphanumeric, hyphens, underscores only)
   * @param description - Short description of the agent
   * @param content - Agent system prompt content
   * @param scope - "project" or "user"
   * @param projectPath - Required for project scope
   */
  async createSubagent(
    name: string,
    description: string,
    content: string,
    scope: 'project' | 'user',
    projectPath?: string
  ): Promise<{ name: string; path: string; scope: string; description: string; content: string }> {
    try {
      return await invoke("create_subagent", { name, description, content, scope, projectPath });
    } catch (error) {
      console.error("Failed to create subagent:", error);
      throw error;
    }
  },

  /**
   * Create a new Agent Skill
   * @param name - Skill name (alphanumeric, hyphens, underscores only)
   * @param description - Short description of what this skill does
   * @param content - Skill instructions content
   * @param scope - "project" or "user"
   * @param projectPath - Required for project scope
   */
  async createSkill(
    name: string,
    description: string,
    content: string,
    scope: 'project' | 'user',
    projectPath?: string
  ): Promise<{ name: string; path: string; scope: string; description: string; content: string }> {
    try {
      return await invoke("create_skill", { name, description, content, scope, projectPath });
    } catch (error) {
      console.error("Failed to create skill:", error);
      throw error;
    }
  },

  /**
   * Open a directory in system file explorer (cross-platform)
   */
  async openDirectoryInExplorer(directoryPath: string): Promise<void> {
    try {
      return await invoke<void>("open_directory_in_explorer", { directoryPath });
    } catch (error) {
      console.error("Failed to open directory in explorer:", error);
      throw error;
    }
  },

  /**
   * Open a file with system default application (cross-platform)
   */
  async openFileWithDefaultApp(filePath: string): Promise<void> {
    try {
      return await invoke<void>("open_file_with_default_app", { filePath });
    } catch (error) {
      console.error("Failed to open file with default app:", error);
      throw error;
    }
  },

  // ==================== Git Statistics ====================

  /**
   * Get Git diff statistics between commits
   */
  async getGitDiffStats(
    projectPath: string,
    fromCommit: string,
    toCommit?: string
  ): Promise<{ linesAdded: number; linesRemoved: number; filesChanged: number }> {
    try {
      return await invoke("get_git_diff_stats", { projectPath, fromCommit, toCommit });
    } catch (error) {
      console.error("Failed to get git diff stats:", error);
      throw error;
    }
  },

  /**
   * Get code changes for current session
   */
  async getSessionCodeChanges(
    projectPath: string,
    sessionStartCommit: string
  ): Promise<{ linesAdded: number; linesRemoved: number; filesChanged: number }> {
    try {
      return await invoke("get_session_code_changes", { projectPath, sessionStartCommit });
    } catch (error) {
      console.error("Failed to get session code changes:", error);
      throw error;
    }
  },

  // ==================== OpenAI Codex Integration ====================

  /**
   * Executes a Codex task in non-interactive mode with streaming output
   * @param options - Codex execution options
   * @returns Promise resolving when execution starts (events are streamed via event listeners)
   */
  async executeCodex(options: import('@/types/codex').CodexExecutionOptions): Promise<void> {
    try {
      return await invoke("execute_codex", { options });
    } catch (error) {
      console.error("Failed to execute Codex:", error);
      throw error;
    }
  },

  /**
   * Resumes a previous Codex session
   * @param sessionId - The session ID to resume
   * @param options - Codex execution options (prompt, mode, etc.)
   * @returns Promise resolving when execution starts
   */
  async resumeCodex(
    sessionId: string,
    options: Omit<import('@/types/codex').CodexExecutionOptions, 'sessionId'>
  ): Promise<void> {
    try {
      return await invoke("resume_codex", { sessionId, options });
    } catch (error) {
      console.error("Failed to resume Codex session:", error);
      throw error;
    }
  },

  /**
   * Resumes the last Codex session
   * @param options - Codex execution options
   * @returns Promise resolving when execution starts
   */
  async resumeLastCodex(
    options: Omit<import('@/types/codex').CodexExecutionOptions, 'resumeLast'>
  ): Promise<void> {
    try {
      return await invoke("resume_last_codex", { options });
    } catch (error) {
      console.error("Failed to resume last Codex session:", error);
      throw error;
    }
  },

  /**
   * Cancels a running Codex execution
   * @param sessionId - Optional session ID to cancel a specific session
   * @returns Promise resolving when cancellation is complete
   */
  async cancelCodex(sessionId?: string): Promise<void> {
    try {
      return await invoke("cancel_codex", { sessionId });
    } catch (error) {
      console.error("Failed to cancel Codex execution:", error);
      throw error;
    }
  },

  /**
   * Gets a list of all Codex sessions
   * @returns Promise resolving to array of Codex sessions
   */
  async listCodexSessions(): Promise<import('@/types/codex').CodexSession[]> {
    try {
      return await invoke<import('@/types/codex').CodexSession[]>("list_codex_sessions");
    } catch (error) {
      console.error("Failed to list Codex sessions:", error);
      throw error;
    }
  },

  /**
   * Deletes a Codex session
   * @param sessionId - The session ID to delete
   * @returns Promise resolving to success message
   */
  async deleteCodexSession(sessionId: string): Promise<string> {
    try {
      return await invoke<string>("delete_codex_session", { sessionId });
    } catch (error) {
      console.error("Failed to delete Codex session:", error);
      throw error;
    }
  },

  /**
   * Checks if Codex is available and properly configured
   * @returns Promise resolving to availability status
   */
  async checkCodexAvailability(): Promise<{
    available: boolean;
    version?: string;
    error?: string;
  }> {
    try {
      return await invoke("check_codex_availability");
    } catch (error) {
      console.error("Failed to check Codex availability:", error);
      return {
        available: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  },

  // ============================================================================
  // Codex Mode Configuration (WSL Support)
  // ============================================================================

  /**
   * Gets Codex mode configuration
   * @returns Promise resolving to mode configuration info
   */
  async getCodexModeConfig(): Promise<{
    mode: 'auto' | 'native' | 'wsl';
    wslDistro: string | null;
    actualMode: 'native' | 'wsl';
    nativeAvailable: boolean;
    wslAvailable: boolean;
    availableDistros: string[];
    isWindows: boolean;
  }> {
    try {
      return await invoke("get_codex_mode_config");
    } catch (error) {
      console.error("Failed to get Codex mode config:", error);
      throw error;
    }
  },

  /**
   * Sets Codex mode configuration
   * @param mode - The mode to set: 'auto', 'native', or 'wsl'
   * @param wslDistro - Optional WSL distro name
   * @param customCodexPath - Optional custom Codex path
   * @returns Promise resolving to success message
   */
  async setCodexModeConfig(
    mode: 'auto' | 'native' | 'wsl',
    wslDistro?: string | null,
    customCodexPath?: string | null
  ): Promise<string> {
    try {
      return await invoke<string>("set_codex_mode_config", {
        mode,
        wslDistro: wslDistro || null,
        customCodexPath: customCodexPath || null
      });
    } catch (error) {
      console.error("Failed to set Codex mode config:", error);
      throw error;
    }
  },

  // ============================================================================
  // Gemini WSL Mode Configuration
  // ============================================================================

  /**
   * Gets Gemini WSL mode configuration
   * @returns Promise resolving to Gemini WSL mode configuration info
   */
  async getGeminiWslModeConfig(): Promise<{
    mode: 'auto' | 'native' | 'wsl';
    wslDistro: string | null;
    wslAvailable: boolean;
    availableDistros: string[];
    wslEnabled: boolean;
    wslGeminiPath: string | null;
    wslGeminiVersion: string | null;
    nativeAvailable: boolean;
    isWindows: boolean;
  }> {
    try {
      return await invoke("get_gemini_wsl_mode_config");
    } catch (error) {
      console.error("Failed to get Gemini WSL mode config:", error);
      throw error;
    }
  },

  /**
   * Sets Gemini WSL mode configuration
   * @param mode - The mode to set: 'auto', 'native', or 'wsl'
   * @param wslDistro - Optional WSL distro name
   * @returns Promise resolving when config is saved
   */
  async setGeminiWslModeConfig(
    mode: 'auto' | 'native' | 'wsl',
    wslDistro?: string | null
  ): Promise<void> {
    try {
      await invoke("set_gemini_wsl_mode_config", {
        mode,
        wslDistro: wslDistro || null
      });
    } catch (error) {
      console.error("Failed to set Gemini WSL mode config:", error);
      throw error;
    }
  },

  // ============================================================================
  // Claude WSL Mode Configuration
  // ============================================================================

  /**
   * Gets Claude WSL mode configuration
   * @returns Promise resolving to Claude WSL mode configuration info
   */
  async getClaudeWslModeConfig(): Promise<{
    mode: 'auto' | 'native' | 'wsl';
    wslDistro: string | null;
    wslAvailable: boolean;
    availableDistros: string[];
    wslEnabled: boolean;
    wslClaudePath: string | null;
    wslClaudeVersion: string | null;
    nativeAvailable: boolean;
    actualMode: 'native' | 'wsl';
    isWindows: boolean;
  }> {
    try {
      return await invoke("get_claude_wsl_mode_config");
    } catch (error) {
      console.error("Failed to get Claude WSL mode config:", error);
      throw error;
    }
  },

  /**
   * Sets Claude WSL mode configuration
   * @param mode - The mode to set: 'auto', 'native', or 'wsl'
   * @param wslDistro - Optional WSL distro name
   * @returns Promise resolving to success message
   */
  async setClaudeWslModeConfig(
    mode: 'auto' | 'native' | 'wsl',
    wslDistro?: string | null
  ): Promise<string> {
    try {
      return await invoke("set_claude_wsl_mode_config", {
        mode,
        wslDistro: wslDistro || null
      });
    } catch (error) {
      console.error("Failed to set Claude WSL mode config:", error);
      throw error;
    }
  },

  /**
   * Get current Codex CLI path（优先自定义，其次自动检测）
   */
  async getCodexPath(): Promise<string> {
    try {
      return await invoke<string>("get_codex_path");
    } catch (error) {
      console.error("Failed to get Codex path:", error);
      throw error;
    }
  },

  /**
   * Sets custom Codex CLI path
   * @param path - Path to custom Codex CLI executable (null to clear)
   * @returns Promise resolving to success message
   */
  async setCodexCustomPath(path: string | null): Promise<void> {
    try {
      const normalizedPath = path?.trim() ?? "";

      if (normalizedPath) {
        await invoke<void>("set_custom_codex_path", { customPath: normalizedPath });
      } else {
        await invoke<void>("clear_custom_codex_path");
      }
    } catch (error) {
      console.error("Failed to set custom Codex path:", error);
      throw error;
    }
  },

  /**
   * Validates a Codex path
   * @param path - Path to validate
   * @returns Promise resolving to whether the path is valid
   */
  async validateCodexPath(path: string): Promise<boolean> {
    try {
      return await invoke<boolean>("validate_codex_path_cmd", { path: path.trim() });
    } catch (error) {
      console.error("Failed to validate Codex path:", error);
      return false;
    }
  },

  /**
   * Scans for all possible Codex installation paths
   * @returns Promise resolving to array of found paths
   */
  async scanCodexPaths(): Promise<string[]> {
    try {
      return await invoke<string[]>("scan_codex_paths");
    } catch (error) {
      console.error("Failed to scan Codex paths:", error);
      return [];
    }
  },

  // ============================================================================
  // Codex Rewind Commands
  // ============================================================================

  /**
   * Records a Codex prompt being sent (called before execution)
   * @param sessionId - The Codex session ID
   * @param projectPath - The project path
   * @param promptText - The prompt text
   * @returns Promise resolving to the prompt index
   */
  async recordCodexPromptSent(
    sessionId: string,
    projectPath: string,
    promptText: string
  ): Promise<number> {
    try {
      return await invoke<number>("record_codex_prompt_sent", {
        sessionId,
        projectPath,
        promptText
      });
    } catch (error) {
      console.error("Failed to record Codex prompt sent:", error);
      throw error;
    }
  },

  /**
   * Records a Codex prompt completion (called after AI response)
   * @param sessionId - The Codex session ID
   * @param projectPath - The project path
   * @param promptIndex - The prompt index to complete
   */
  async recordCodexPromptCompleted(
    sessionId: string,
    projectPath: string,
    promptIndex: number,
    promptText?: string
  ): Promise<void> {
    try {
      const payload: Record<string, unknown> = {
        sessionId,
        projectPath,
        promptIndex
      };
      if (promptText !== undefined) {
        payload.promptText = promptText;
      }
      await invoke("record_codex_prompt_completed", {
        ...payload
      });
    } catch (error) {
      console.error("Failed to record Codex prompt completed:", error);
      throw error;
    }
  },

  /**
   * Gets Codex prompt list for a session (used by revert picker)
   */
  async getCodexPromptList(sessionId: string): Promise<PromptRecord[]> {
    try {
      return await invoke<PromptRecord[]>("get_codex_prompt_list", { sessionId });
    } catch (error) {
      console.error("Failed to get Codex prompt list:", error);
      return [];
    }
  },

  /**
   * Checks rewind capabilities for a Codex prompt
   * @param sessionId - Codex session ID
   * @param promptIndex - Prompt index to check
   */
  async checkCodexRewindCapabilities(
    sessionId: string,
    promptIndex: number
  ): Promise<RewindCapabilities> {
    try {
      return await invoke<RewindCapabilities>("check_codex_rewind_capabilities", {
        sessionId,
        promptIndex,
      });
    } catch (error) {
      console.error("Failed to check Codex rewind capabilities:", error);
      // Fallback to conversation-only to keep UI functional
      return {
        conversation: true,
        code: false,
        both: false,
        warning: "无法获取 Codex 撤回能力，只能删除对话记录。",
        source: "cli",
      };
    }
  },

  /**
   * Reverts a Codex session to a specific prompt
   * @param sessionId - The Codex session ID
   * @param projectPath - The project path
   * @param promptIndex - The prompt index to revert to
   * @param mode - The rewind mode (conversation_only, code_only, or both)
   * @returns Promise resolving to the prompt text (for restoring to input)
   */
  async revertCodexToPrompt(
    sessionId: string,
    projectPath: string,
    promptIndex: number,
    mode: RewindMode = "both"
  ): Promise<string> {
    try {
      return await invoke<string>("revert_codex_to_prompt", {
        sessionId,
        projectPath,
        promptIndex,
        mode
      });
    } catch (error) {
      console.error("Failed to revert Codex to prompt:", error);
      throw error;
    }
  },

  // ============================================================================
  // Gemini Rewind Commands
  // ============================================================================

  /**
   * Records a Gemini prompt being sent (called before execution)
   * @param sessionId - The Gemini session ID
   * @param projectPath - The project path
   * @param promptText - The prompt text
   * @returns Promise resolving to the prompt index
   */
  async recordGeminiPromptSent(
    sessionId: string,
    projectPath: string,
    promptText: string
  ): Promise<number> {
    try {
      return await invoke<number>("record_gemini_prompt_sent", {
        sessionId,
        projectPath,
        promptText
      });
    } catch (error) {
      console.error("Failed to record Gemini prompt sent:", error);
      throw error;
    }
  },

  /**
   * Records a Gemini prompt completion (called after AI response)
   * @param sessionId - The Gemini session ID
   * @param projectPath - The project path
   * @param promptIndex - The prompt index to complete
   */
  async recordGeminiPromptCompleted(
    sessionId: string,
    projectPath: string,
    promptIndex: number,
    promptText?: string
  ): Promise<void> {
    try {
      const payload: Record<string, unknown> = {
        sessionId,
        projectPath,
        promptIndex
      };
      if (promptText !== undefined) {
        payload.promptText = promptText;
      }
      await invoke("record_gemini_prompt_completed", {
        ...payload
      });
    } catch (error) {
      console.error("Failed to record Gemini prompt completed:", error);
      throw error;
    }
  },

  /**
   * Gets Gemini prompt list for a session (used by revert picker)
   */
  async getGeminiPromptList(sessionId: string, projectPath: string): Promise<PromptRecord[]> {
    try {
      return await invoke<PromptRecord[]>("get_gemini_prompt_list", { sessionId, projectPath });
    } catch (error) {
      console.error("Failed to get Gemini prompt list:", error);
      return [];
    }
  },

  /**
   * Checks rewind capabilities for a Gemini prompt
   * @param sessionId - Gemini session ID
   * @param projectPath - The project path
   * @param promptIndex - Prompt index to check
   */
  async checkGeminiRewindCapabilities(
    sessionId: string,
    projectPath: string,
    promptIndex: number
  ): Promise<RewindCapabilities> {
    try {
      return await invoke<RewindCapabilities>("check_gemini_rewind_capabilities", {
        sessionId,
        projectPath,
        promptIndex,
      });
    } catch (error) {
      console.error("Failed to check Gemini rewind capabilities:", error);
      // Fallback to conversation-only to keep UI functional
      return {
        conversation: true,
        code: false,
        both: false,
        warning: "无法获取 Gemini 撤回能力，只能删除对话记录。",
        source: "project",
      };
    }
  },

  /**
   * Reverts a Gemini session to a specific prompt
   * @param sessionId - The Gemini session ID
   * @param projectPath - The project path
   * @param promptIndex - The prompt index to revert to
   * @param mode - The rewind mode (conversation_only, code_only, or both)
   * @returns Promise resolving to success message
   */
  async revertGeminiToPrompt(
    sessionId: string,
    projectPath: string,
    promptIndex: number,
    mode: RewindMode = "both"
  ): Promise<string> {
    try {
      return await invoke<string>("revert_gemini_to_prompt", {
        sessionId,
        projectPath,
        promptIndex,
        mode
      });
    } catch (error) {
      console.error("Failed to revert Gemini to prompt:", error);
      throw error;
    }
  },

  // ============================================================================
  // CODEX PROVIDER MANAGEMENT
  // ============================================================================

  /**
   * Gets the list of Codex provider presets
   * @returns Promise resolving to array of Codex provider configurations
   */
  async getCodexProviderPresets(): Promise<CodexProviderConfig[]> {
    try {
      return await invoke<CodexProviderConfig[]>("get_codex_provider_presets");
    } catch (error) {
      console.error("Failed to get Codex provider presets:", error);
      throw error;
    }
  },

  /**
   * Gets the current Codex provider configuration from ~/.codex directory
   * @returns Promise resolving to current Codex configuration
   */
  async getCurrentCodexConfig(): Promise<CurrentCodexConfig> {
    try {
      return await invoke<CurrentCodexConfig>("get_current_codex_config");
    } catch (error) {
      console.error("Failed to get current Codex config:", error);
      throw error;
    }
  },

  /**
   * Switches to a Codex provider configuration
   * Writes auth.json and config.toml to ~/.codex directory
   * @param config - The Codex provider configuration to switch to
   * @returns Promise resolving to success message
   */
  async switchCodexProvider(config: CodexProviderConfig): Promise<string> {
    try {
      return await invoke<string>("switch_codex_provider", { config });
    } catch (error) {
      console.error("Failed to switch Codex provider:", error);
      throw error;
    }
  },

  /**
   * Adds a new Codex provider configuration
   * @param config - The Codex provider configuration to add
   * @returns Promise resolving to success message
   */
  async addCodexProviderConfig(config: Omit<CodexProviderConfig, 'id'>): Promise<string> {
    // Generate base ID from name
    let baseId = config.name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    // Check if ID conflicts with built-in presets
    const builtInIds = codexProviderPresets.map(p => p.id);

    // Get existing custom configurations to check for conflicts
    let existingConfigs: CodexProviderConfig[] = [];
    try {
      existingConfigs = await this.getCodexProviderPresets();
    } catch (error) {
      console.warn("Failed to load existing Codex configs:", error);
    }
    const existingIds = existingConfigs.map(c => c.id);

    // Generate unique ID by adding suffix if needed
    let id = baseId;
    let suffix = 1;
    while (builtInIds.includes(id) || existingIds.includes(id)) {
      id = `${baseId}-${suffix}`;
      suffix++;
    }

    const fullConfig: CodexProviderConfig = {
      ...config,
      id,
      createdAt: Date.now(),
    };

    try {
      return await invoke<string>("add_codex_provider_config", { config: fullConfig });
    } catch (error) {
      console.error("Failed to add Codex provider config:", error);
      throw error;
    }
  },

  /**
   * Updates an existing Codex provider configuration
   * @param config - The Codex provider configuration to update (with id)
   * @returns Promise resolving to success message
   */
  async updateCodexProviderConfig(config: CodexProviderConfig): Promise<string> {
    try {
      return await invoke<string>("update_codex_provider_config", { config });
    } catch (error) {
      console.error("Failed to update Codex provider config:", error);
      throw error;
    }
  },

  /**
   * Deletes a Codex provider configuration by ID
   * @param id - The ID of the Codex provider configuration to delete
   * @returns Promise resolving to success message
   */
  async deleteCodexProviderConfig(id: string): Promise<string> {
    try {
      return await invoke<string>("delete_codex_provider_config", { id });
    } catch (error) {
      console.error("Failed to delete Codex provider config:", error);
      throw error;
    }
  },

  /**
   * Reorders Codex provider configurations
   * @param ids - Array of provider IDs in the desired order
   * @returns Promise resolving to success message
   */
  async reorderCodexProviderConfigs(ids: string[]): Promise<string> {
    try {
      return await invoke<string>("reorder_codex_provider_configs", { ids });
    } catch (error) {
      console.error("Failed to reorder Codex provider configs:", error);
      throw error;
    }
  },

  /**
   * Clears Codex provider configuration (resets to official)
   * Removes auth.json and config.toml from ~/.codex directory
   * @returns Promise resolving to success message
   */
  async clearCodexProviderConfig(): Promise<string> {
    try {
      return await invoke<string>("clear_codex_provider_config");
    } catch (error) {
      console.error("Failed to clear Codex provider config:", error);
      throw error;
    }
  },

  /**
   * Tests Codex provider connection
   * @param baseUrl - The base URL to test
   * @param apiKey - The API key to use for testing
   * @returns Promise resolving to test result message
   */
  async testCodexProviderConnection(baseUrl: string, apiKey?: string): Promise<string> {
    try {
      return await invoke<string>("test_codex_provider_connection", { baseUrl, apiKey });
    } catch (error) {
      console.error("Failed to test Codex provider connection:", error);
      throw error;
    }
  },

  /**
   * Updates Codex reasoning effort level in config.toml
   * @param level - The reasoning level: 'minimal', 'low', 'medium', 'high', or 'xhigh'
   * @returns Promise resolving to success message
   */
  async updateCodexReasoningLevel(level: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'): Promise<string> {
    try {
      return await invoke<string>("update_codex_reasoning_level", { level });
    } catch (error) {
      console.error("Failed to update Codex reasoning level:", error);
      throw error;
    }
  },

  /**
   * Gets the Codex multi-agent configuration
   */
  async getCodexMultiAgentConfig(): Promise<{ enabled: boolean; subagentModel?: string; subagentReasoningEffort?: string }> {
    try {
      return await invoke("get_codex_multi_agent_config");
    } catch (error) {
      console.error("Failed to get Codex multi-agent config:", error);
      throw error;
    }
  },

  /**
   * Sets the Codex multi-agent configuration
   */
  async setCodexMultiAgentConfig(config: { enabled: boolean; subagentModel?: string; subagentReasoningEffort?: string }): Promise<string> {
    try {
      return await invoke<string>("set_codex_multi_agent_config", { config });
    } catch (error) {
      console.error("Failed to set Codex multi-agent config:", error);
      throw error;
    }
  },

  // ============================================================================
  // GEMINI PROVIDER MANAGEMENT
  // ============================================================================

  /**
   * Gets the list of Gemini provider presets
   * @returns Promise resolving to array of Gemini provider configurations
   */
  async getGeminiProviderPresets(): Promise<GeminiProviderConfig[]> {
    try {
      return await invoke<GeminiProviderConfig[]>("get_gemini_provider_presets");
    } catch (error) {
      console.error("Failed to get Gemini provider presets:", error);
      throw error;
    }
  },

  /**
   * Gets the current Gemini provider configuration from ~/.gemini directory
   * @returns Promise resolving to current Gemini configuration
   */
  async getCurrentGeminiProviderConfig(): Promise<CurrentGeminiProviderConfig> {
    try {
      return await invoke<CurrentGeminiProviderConfig>("get_current_gemini_provider_config");
    } catch (error) {
      console.error("Failed to get current Gemini provider config:", error);
      throw error;
    }
  },

  /**
   * Switches to a Gemini provider configuration
   * Writes env to ~/.gemini/.env and updates settings.json
   * @param config - The Gemini provider configuration to switch to
   * @returns Promise resolving to success message
   */
  async switchGeminiProvider(config: GeminiProviderConfig): Promise<string> {
    try {
      return await invoke<string>("switch_gemini_provider", { config });
    } catch (error) {
      console.error("Failed to switch Gemini provider:", error);
      throw error;
    }
  },

  /**
   * Adds a new Gemini provider configuration
   * @param config - The Gemini provider configuration to add
   * @returns Promise resolving to success message
   */
  async addGeminiProviderConfig(config: Omit<GeminiProviderConfig, 'id'>): Promise<string> {
    // Generate ID from name
    const id = config.name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    const fullConfig: GeminiProviderConfig = {
      ...config,
      id,
      createdAt: Date.now(),
    };

    try {
      return await invoke<string>("add_gemini_provider_config", { config: fullConfig });
    } catch (error) {
      console.error("Failed to add Gemini provider config:", error);
      throw error;
    }
  },

  /**
   * Updates an existing Gemini provider configuration
   * @param config - The Gemini provider configuration to update (with id)
   * @returns Promise resolving to success message
   */
  async updateGeminiProviderConfig(config: GeminiProviderConfig): Promise<string> {
    try {
      return await invoke<string>("update_gemini_provider_config", { config });
    } catch (error) {
      console.error("Failed to update Gemini provider config:", error);
      throw error;
    }
  },

  /**
   * Deletes a Gemini provider configuration by ID
   * @param id - The ID of the Gemini provider configuration to delete
   * @returns Promise resolving to success message
   */
  async deleteGeminiProviderConfig(id: string): Promise<string> {
    try {
      return await invoke<string>("delete_gemini_provider_config", { id });
    } catch (error) {
      console.error("Failed to delete Gemini provider config:", error);
      throw error;
    }
  },

  /**
   * Reorders Gemini provider configurations
   * @param ids - Array of provider IDs in the desired order
   * @returns Promise resolving to success message
   */
  async reorderGeminiProviderConfigs(ids: string[]): Promise<string> {
    try {
      return await invoke<string>("reorder_gemini_provider_configs", { ids });
    } catch (error) {
      console.error("Failed to reorder Gemini provider configs:", error);
      throw error;
    }
  },

  /**
   * Clears Gemini provider configuration (resets to official OAuth)
   * Clears .env and sets auth type to oauth-personal
   * @returns Promise resolving to success message
   */
  async clearGeminiProviderConfig(): Promise<string> {
    try {
      return await invoke<string>("clear_gemini_provider_config");
    } catch (error) {
      console.error("Failed to clear Gemini provider config:", error);
      throw error;
    }
  },

  /**
   * Tests Gemini provider connection
   * @param baseUrl - The base URL to test
   * @param apiKey - The API key to use for testing
   * @returns Promise resolving to test result message
   */
  async testGeminiProviderConnection(baseUrl: string, apiKey?: string): Promise<string> {
    try {
      return await invoke<string>("test_gemini_provider_connection", { baseUrl, apiKey });
    } catch (error) {
      console.error("Failed to test Gemini provider connection:", error);
      throw error;
    }
  },

  // ============================================================================
  // Session Conversion (Claude ↔ Codex)
  // ============================================================================

  /**
   * Convert a session between Claude and Codex formats
   * @param sessionId - The source session ID
   * @param targetEngine - The target engine ('claude' | 'codex')
   * @param projectId - The project ID (directory name)
   * @param projectPath - The project path
   * @returns Promise resolving to conversion result
   */
  async convertSession(
    sessionId: string,
    targetEngine: 'claude' | 'codex',
    projectId: string,
    projectPath: string
  ): Promise<ConversionResult> {
    try {
      return await invoke<ConversionResult>("convert_session", {
        sessionId,
        targetEngine,
        projectId,
        projectPath,
      });
    } catch (error) {
      console.error("Failed to convert session:", error);
      throw error;
    }
  },

  /**
   * Convert a Claude session to Codex format
   * @param sessionId - The Claude session ID (UUID format)
   * @param projectId - The project ID (directory name)
   * @param projectPath - The project path
   * @returns Promise resolving to conversion result
   */
  async convertClaudeToCodex(
    sessionId: string,
    projectId: string,
    projectPath: string
  ): Promise<ConversionResult> {
    try {
      return await invoke<ConversionResult>("convert_claude_to_codex", {
        sessionId,
        projectId,
        projectPath,
      });
    } catch (error) {
      console.error("Failed to convert Claude to Codex:", error);
      throw error;
    }
  },

  /**
   * Convert a Codex session to Claude format
   * @param sessionId - The Codex session ID (rollout-* format)
   * @param projectId - The project ID (directory name)
   * @param projectPath - The project path
   * @returns Promise resolving to conversion result
   */
  async convertCodexToClaude(
    sessionId: string,
    projectId: string,
    projectPath: string
  ): Promise<ConversionResult> {
    try {
      return await invoke<ConversionResult>("convert_codex_to_claude", {
        sessionId,
        projectId,
        projectPath,
      });
    } catch (error) {
      console.error("Failed to convert Codex to Claude:", error);
      throw error;
    }
  },

  // ==================== Google Gemini CLI Integration ====================

  /**
   * Executes a Gemini CLI session with streaming output
   * @param options - Gemini execution options
   * @returns Promise resolving when execution starts (events are streamed via event listeners)
   */
  async executeGemini(options: import('@/types/gemini').GeminiExecutionOptions): Promise<void> {
    try {
      return await invoke("execute_gemini", { options });
    } catch (error) {
      console.error("Failed to execute Gemini:", error);
      throw error;
    }
  },

  /**
   * Cancels a running Gemini execution
   * @param sessionId - Optional session ID to cancel (cancels all if not provided)
   */
  async cancelGemini(sessionId?: string): Promise<void> {
    try {
      await invoke("cancel_gemini", { sessionId });
    } catch (error) {
      console.error("Failed to cancel Gemini:", error);
      throw error;
    }
  },

  /**
   * Checks if Gemini CLI is installed
   * @returns Promise resolving to installation status
   */
  async checkGeminiInstalled(): Promise<import('@/types/gemini').GeminiInstallStatus> {
    try {
      return await invoke("check_gemini_installed");
    } catch (error) {
      console.error("Failed to check Gemini installation:", error);
      return {
        installed: false,
        error: String(error),
      };
    }
  },

  /**
   * Gets Gemini CLI configuration
   * @returns Promise resolving to Gemini configuration
   */
  async getGeminiConfig(): Promise<import('@/types/gemini').GeminiConfig> {
    try {
      return await invoke("get_gemini_config");
    } catch (error) {
      console.error("Failed to get Gemini config:", error);
      throw error;
    }
  },

  /**
   * Updates Gemini CLI configuration
   * @param config - New configuration to apply
   */
  async updateGeminiConfig(config: import('@/types/gemini').GeminiConfig): Promise<void> {
    try {
      await invoke("update_gemini_config", { config });
    } catch (error) {
      console.error("Failed to update Gemini config:", error);
      throw error;
    }
  },

  /**
   * Gets available Gemini models
   * @returns Promise resolving to array of model information
   */
  async getGeminiModels(): Promise<import('@/types/gemini').GeminiModelInfo[]> {
    try {
      return await invoke("get_gemini_models");
    } catch (error) {
      console.error("Failed to get Gemini models:", error);
      throw error;
    }
  },

  // ============================================================================
  // Gemini Session History
  // ============================================================================

  /**
   * Gets session logs for a project (from logs.json)
   * @param projectPath - Project path to get session logs for
   * @returns Promise resolving to array of session logs
   */
  async getGeminiSessionLogs(projectPath: string): Promise<import('@/types/gemini').GeminiSessionLog[]> {
    try {
      return await invoke("get_gemini_session_logs", { projectPath });
    } catch (error) {
      console.error("Failed to get Gemini session logs:", error);
      throw error;
    }
  },

  /**
   * Lists all sessions for a project (from chats/ directory)
   * @param projectPath - Project path to list sessions for
   * @returns Promise resolving to array of session info
   */
  async listGeminiSessions(projectPath: string): Promise<import('@/types/gemini').GeminiSessionInfo[]> {
    try {
      return await invoke("list_gemini_sessions", { projectPath });
    } catch (error) {
      console.error("Failed to list Gemini sessions:", error);
      throw error;
    }
  },

  /**
   * Gets detailed session information
   * @param projectPath - Project path
   * @param sessionId - Session ID to get details for
   * @returns Promise resolving to complete session detail
   */
  async getGeminiSessionDetail(
    projectPath: string,
    sessionId: string
  ): Promise<import('@/types/gemini').GeminiSessionDetail> {
    try {
      return await invoke("get_gemini_session_detail", { projectPath, sessionId });
    } catch (error) {
      console.error("Failed to get Gemini session detail:", error);
      throw error;
    }
  },

  /**
   * Delete a Gemini session
   * @param projectPath - Project path
   * @param sessionId - Session ID to delete
   */
  async deleteGeminiSession(projectPath: string, sessionId: string): Promise<void> {
    try {
      await invoke("delete_gemini_session", { projectPath, sessionId });
    } catch (error) {
      console.error("Failed to delete Gemini session:", error);
      throw error;
    }
  },

};
