/**
 * OpenAI Codex Event Converter
 *
 * Converts Codex JSONL events to ClaudeStreamMessage format
 * for seamless integration with existing message display components.
 */

import type {
  CodexEvent,
  CodexItem,
  CodexAgentMessageItem,
  CodexReasoningItem,
  CodexCommandExecutionItem,
  CodexFileChangeItem,
  CodexWebSearchItem,
  CodexTodoListItem,
  CodexMessageMetadata,
  CodexRateLimit,
  CodexRateLimits,
} from '@/types/codex';
import type { ClaudeStreamMessage } from '@/types/claude';


/**
 * Maps Codex tool names to Claude Code tool names
 * This ensures consistent tool rendering between realtime stream and history loading
 */
const CODEX_TOOL_NAME_MAP: Record<string, string> = {
  // Command execution
  'shell_command': 'bash',
  'shell': 'bash',
  'terminal': 'bash',
  'execute': 'bash',
  'run_command': 'bash',

  // File operations
  'edit_file': 'edit',
  'modify_file': 'edit',
  'update_file': 'edit',
  'patch_file': 'edit',
  'edited': 'edit',           // Codex 文件编辑工具
  'str_replace_editor': 'edit', // Codex 字符串替换编辑器
  'apply_patch': 'edit',      // Codex 补丁应用
  'read_file': 'read',
  'view_file': 'read',
  'create_file': 'write',
  'write_file': 'write',
  'save_file': 'write',
  'delete_file': 'bash', // Usually done via shell command

  // Search operations
  'search_files': 'grep',
  'find_files': 'glob',
  'list_files': 'ls',
  'list_directory': 'ls',

  // Web operations
  'web_search': 'websearch',
  'search_web': 'websearch',
  'fetch_url': 'webfetch',
  'get_url': 'webfetch',
};

/**
 * Maps a Codex tool name to its Claude Code equivalent
 */
function mapCodexToolName(codexName: string): string {
  const lowerName = codexName.toLowerCase();
  return CODEX_TOOL_NAME_MAP[lowerName] || codexName;
}

function parseCodexRateLimitEntry(raw: any, fallbackWindowMinutes: number): CodexRateLimit | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const usedPercentValue = raw.used_percent
    ?? raw.usedPercent
    ?? raw.used_percentage
    ?? raw.usedPercentage
    ?? raw.percent_used
    ?? raw.percent
    ?? raw.percentage;
  const usedPercent = Number(usedPercentValue);

  const windowMinutesValue = raw.window_minutes
    ?? raw.windowMinutes
    ?? raw.window_min
    ?? raw.window
    ?? raw.windowMinutes;
  const windowMinutes = Number(windowMinutesValue);

  const resetsAtValue = raw.resets_at ?? raw.resetsAt ?? raw.reset_at ?? raw.resetAt;
  const resetsInSecondsValue = raw.resets_in_seconds
    ?? raw.resetsInSeconds
    ?? raw.reset_in_seconds
    ?? raw.resetInSeconds
    ?? raw.reset_seconds
    ?? raw.resetSeconds;

  return {
    usedPercent: Number.isFinite(usedPercent) ? usedPercent : 0,
    windowMinutes: Number.isFinite(windowMinutes) && windowMinutes > 0 ? windowMinutes : fallbackWindowMinutes,
    resetsAt: resetsAtValue !== undefined ? Number(resetsAtValue) : undefined,
    resetsInSeconds: resetsInSecondsValue !== undefined ? Number(resetsInSecondsValue) : undefined,
  };
}

export function parseCodexRateLimits(raw: any, updatedAt: string): CodexRateLimits | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const primaryCandidate = raw.primary
    ?? raw.primary_limit
    ?? raw.five_hour
    ?? raw.fiveHour
    ?? raw['5h'];
  const secondaryCandidate = raw.secondary
    ?? raw.secondary_limit
    ?? raw.weekly
    ?? raw.week
    ?? raw['1w']
    ?? raw['7d'];
  const hasPrimary = Boolean(primaryCandidate);
  const hasSecondary = Boolean(secondaryCandidate);

  const primary = parseCodexRateLimitEntry(hasPrimary ? primaryCandidate : (!hasSecondary ? raw : null), 299);
  const secondary = parseCodexRateLimitEntry(secondaryCandidate, 10079);

  if (!primary && !secondary) {
    return null;
  }

  const rateLimits: CodexRateLimits = { updatedAt };
  if (primary) {
    rateLimits.primary = primary;
  }
  if (secondary) {
    rateLimits.secondary = secondary;
  }

  return rateLimits;
}

export function extractCodexRateLimitsFromEvent(event: any): CodexRateLimits | null {
  if (!event || typeof event !== 'object') {
    return null;
  }

  const ts = typeof event.timestamp === 'string' && event.timestamp
    ? event.timestamp
    : new Date().toISOString();
  const candidates = [
    event.rate_limits,
    event.rateLimits,
    event.payload?.rate_limits,
    event.payload?.rateLimits,
    event.payload?.info?.rate_limits,
    event.payload?.info?.rateLimits,
    event.usage?.rate_limits,
    event.usage?.rateLimits,
  ];

  for (const candidate of candidates) {
    const parsed = parseCodexRateLimits(candidate, ts);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

/**
 * State manager for Codex event conversion
 * Maintains context across multiple events for proper message construction
 */
export class CodexEventConverter {
  private threadId: string | null = null;
  private currentTurnUsage: { input_tokens: number; cached_input_tokens?: number; output_tokens: number } | null = null;
  private lastTokenCountTotal: { input_tokens: number; cached_input_tokens?: number; output_tokens: number } | null = null;
  private tokenCountSeq = 0;
  private activeModel: string | null = null;
  private itemMap: Map<string, CodexItem> = new Map();
  /** Stores tool results by call_id for later matching with tool_use */
  private toolResults: Map<string, { content: string; is_error: boolean }> = new Map();
  /** Stores the latest rate limits from token_count events */
  private latestRateLimits: import('@/types/codex').CodexRateLimits | null = null;
  /** 累计 reasoning_summary_text.delta 内容，等到 .done 或下一个 turn 才 flush */
  private reasoningSummaryBuffer: string = '';
  private reasoningSummaryItemId: string | null = null;

  constructor(options?: { defaultModel?: string | null }) {
    if (options?.defaultModel && options.defaultModel.trim() !== '') {
      this.activeModel = options.defaultModel;
    }
  }

  /**
   * Sets the active model for pricing/context calculations.
   * Useful for `codex exec --json` streams where events don't include model metadata.
   */
  setActiveModel(model?: string | null): void {
    if (typeof model === 'string' && model.trim() !== '') {
      this.activeModel = model;
      return;
    }
    this.activeModel = null;
  }

  /**
   * Gets stored tool result by call_id
   * Used by UI to match tool_use with its result
   */
  getToolResult(callId: string): { content: string; is_error: boolean } | undefined {
    return this.toolResults.get(callId);
  }

  /**
   * Gets all stored tool results
   * Returns a new Map to prevent external modification
   */
  getAllToolResults(): Map<string, { content: string; is_error: boolean }> {
    return new Map(this.toolResults);
  }

  /**
   * Gets the latest rate limits from token_count events
   * Returns null if no rate limits have been received
   */
  getRateLimits(): import('@/types/codex').CodexRateLimits | null {
    return this.latestRateLimits;
  }

  /**
   * Converts a Codex JSONL event to ClaudeStreamMessage format
   * @param eventLine - Raw JSONL line from Codex output
   * @returns ClaudeStreamMessage or null if event should be skipped
   */
  convertEvent(eventLine: string): ClaudeStreamMessage | null {
    try {
      const event = JSON.parse(eventLine) as CodexEvent;
      return this.convertEventObject(event);
    } catch (error) {
      console.error('[CodexConverter] Failed to parse event:', eventLine, error);
      return null;
    }
  }

  /**
   * Converts a parsed Codex event object to ClaudeStreamMessage format
   * @param event - Parsed Codex event object
   * @returns ClaudeStreamMessage or null if event should be skipped
   */
  convertEventObject(event: CodexEvent): ClaudeStreamMessage | null {
      switch (event.type) {
        case 'thread.started':
          this.threadId = event.thread_id;
          // Return init message with session_id for frontend to track
          return {
            type: 'system',
            subtype: 'init',
            result: `Codex session started`,
            session_id: event.thread_id, // ← Important: frontend will extract this
            timestamp: (event as any).timestamp || new Date().toISOString(),
            receivedAt: (event as any).timestamp || new Date().toISOString(),
          };

        case 'turn.started':
          // Reset turn state
          this.currentTurnUsage = null;
          return null; // Don't display turn start events

        case 'turn.completed':
          this.currentTurnUsage = event.usage;
          {
            const rateLimits = extractCodexRateLimitsFromEvent(event);
            if (rateLimits) {
              this.latestRateLimits = rateLimits;
            }
            return this.createUsageMessage(event.usage, event.timestamp, rateLimits);
          }

        case 'thread_token_usage_updated':
          // 累计 token 使用量更新事件 - 这是关键的累计追踪事件
          // 参考: https://hexdocs.pm/codex_sdk/05-api-reference.html
          {
            const rateLimits = extractCodexRateLimitsFromEvent(event);
            if (rateLimits) {
              this.latestRateLimits = rateLimits;
            }
            return this.createCumulativeUsageMessage(event, event.timestamp, rateLimits);
          }

        case 'turn.failed':
          return this.createErrorMessage(event.error.message, event.timestamp);

        case 'item.started':
          this.itemMap.set(event.item.id, event.item);
          return this.convertItem(event.item, 'started', event.timestamp);

        case 'item.updated':
          this.itemMap.set(event.item.id, event.item);
          return this.convertItem(event.item, 'updated', event.timestamp);

        case 'item.completed':
          this.itemMap.set(event.item.id, event.item);
          return this.convertItem(event.item, 'completed', event.timestamp);

        case 'error':
          return this.createErrorMessage(event.error.message, event.timestamp);

        case 'session_meta':
          // Return init message
          if (typeof (event as any)?.payload?.model === 'string') {
            this.activeModel = (event as any).payload.model;
          }
          return {
            type: 'system',
            subtype: 'init',
            result: `Codex session started (ID: ${event.payload.id})`,
            session_id: event.payload.id,
            timestamp: event.payload.timestamp || event.timestamp || new Date().toISOString(),
            receivedAt: event.payload.timestamp || event.timestamp || new Date().toISOString(),
          };

        case 'response_item':
          return this.convertResponseItem(event);

        case 'event_msg':
          return this.convertEventMsg(event as import('@/types/codex').CodexEvent);

        // 处理 Codex Responses API 的 reasoning_summary_text 流式事件
        // - delta 阶段累积文本到缓冲区，前端展示打字机效果
        // - done 阶段一次性 flush，标记 source 为 codex_reasoning_summary
        // 命中条件用 startsWith('response.reasoning_summary_text') 兼容 .delta/.done/可能的子类型
        case 'response.reasoning_summary_text.delta':
        case 'response.reasoning_summary_text.done':
          return this.convertReasoningSummaryEvent(event as any);

        case 'turn_context':
          // Turn context events are metadata, don't display
          if (typeof (event as any)?.payload?.model === 'string') {
            this.activeModel = (event as any).payload.model;
          }
          return null;

        default:
          console.warn('[CodexConverter] Unknown event type:', (event as any).type, 'Full event:', event);
          return null;
      }
  }

  /**
   * Converts event_msg event to ClaudeStreamMessage
   */
  private convertEventMsg(event: import('@/types/codex').CodexEvent): ClaudeStreamMessage | null {
    const { payload } = event;

    switch (payload.type) {
      case 'agent_reasoning':
        // Skip agent_reasoning - it's duplicated by response_item.reasoning
        // Codex sends both event_msg.agent_reasoning (quick notification) and
        // response_item.reasoning (full details with encrypted content)
        // We only process response_item.reasoning to avoid duplicates
        
        return null;

      case 'token_count':
        // token_count events are the ONLY persisted usage signal in Codex history.jsonl
        // (session_meta/response_item/event_msg format). We convert them into a hidden
        // system message with a per-update (delta) usage payload so that:
        // - session cost can be recomputed from JSONL history
        // - context window/token stats can be accumulated across the session
        return this.convertTokenCountEvent(event);

      case 'user_message':
        // ⚠️ DUPLICATE DETECTION: Codex sends BOTH event_msg.user_message AND response_item (role: user)
        // These are the SAME user prompt with identical content
        // Processing both causes duplicate display with different timestamps
        //
        // Example from JSONL:
        // Line 4: {"type":"response_item","payload":{"role":"user","content":[...]}}
        // Line 5: {"type":"event_msg","payload":{"type":"user_message","message":"..."}}
        //
        // We skip event_msg.user_message to avoid duplication
        
        return null;

      default:
        return null;
    }
  }

  private convertTokenCountEvent(event: import('@/types/codex').CodexEvent): ClaudeStreamMessage | null {
    const ts = event.timestamp || new Date().toISOString();
    const payload: any = (event as any).payload;

    const info = payload?.info;
    if (!info || typeof info !== 'object') {
      return null;
    }

    const total = info.total_token_usage;
    const last = info.last_token_usage;

    const totalUsage = total && typeof total === 'object'
      ? {
        input_tokens: Number(total.input_tokens) || 0,
        cached_input_tokens: total.cached_input_tokens !== undefined ? (Number(total.cached_input_tokens) || 0) : 0,
        output_tokens: Number(total.output_tokens) || 0,
      }
      : null;

    const lastUsage = last && typeof last === 'object'
      ? {
        input_tokens: Number(last.input_tokens) || 0,
        cached_input_tokens: last.cached_input_tokens !== undefined ? (Number(last.cached_input_tokens) || 0) : 0,
        output_tokens: Number(last.output_tokens) || 0,
      }
      : null;

    // Prefer explicit delta (last_token_usage). If absent, derive delta from totals.
    let deltaUsage: { input_tokens: number; cached_input_tokens?: number; output_tokens: number } | null = null;

    if (lastUsage) {
      deltaUsage = lastUsage;
    } else if (totalUsage && this.lastTokenCountTotal) {
      deltaUsage = {
        input_tokens: Math.max(totalUsage.input_tokens - (this.lastTokenCountTotal.input_tokens || 0), 0),
        cached_input_tokens: Math.max((totalUsage.cached_input_tokens || 0) - (this.lastTokenCountTotal.cached_input_tokens || 0), 0),
        output_tokens: Math.max(totalUsage.output_tokens - (this.lastTokenCountTotal.output_tokens || 0), 0),
      };
    } else if (totalUsage) {
      deltaUsage = totalUsage;
    }

    if (totalUsage) {
      this.lastTokenCountTotal = totalUsage;
    }

    if (!deltaUsage) {
      return null;
    }

    const modelContextWindow = typeof info.model_context_window === 'number'
      ? info.model_context_window
      : undefined;

    const rateLimits = extractCodexRateLimitsFromEvent(event);
    if (rateLimits) {
      this.latestRateLimits = rateLimits;
    }

    const codexItemId = `token_count_${++this.tokenCountSeq}`;

    return {
      type: 'system',
      subtype: 'info',
      id: codexItemId,
      // Hidden meta message (used for stats/cost only)
      isMeta: true,
      timestamp: ts,
      receivedAt: ts,
      engine: 'codex' as const,
      model: this.activeModel || undefined,
      usage: deltaUsage,
      codexMetadata: {
        codexItemType: 'token_count',
        codexItemId,
        threadId: this.threadId || undefined,
        usage: totalUsage || deltaUsage,
        rateLimits,
        modelContextWindow,
      } as any,
    };
  }

  /**
   * Converts response_item event to ClaudeStreamMessage
   * Note: This handles different payload.type values including function_call, reasoning, etc.
   */
  private convertResponseItem(event: import('@/types/codex').CodexEvent): ClaudeStreamMessage | null {
    const { payload } = event;
    if (!payload) {
      console.warn('[CodexConverter] response_item missing payload:', event);
      return null;
    }

    // Handle different response_item payload types
    const payloadType = (payload as any).type;

    if (payloadType === 'function_call') {
      // Tool use (function call)
      return this.convertFunctionCall(event);
    }

    if (payloadType === 'function_call_output') {
      // Tool result (function call output)
      return this.convertFunctionCallOutput(event);
    }

    // Handle custom_tool_call (e.g., apply_patch for file editing)
    if (payloadType === 'custom_tool_call') {
      return this.convertCustomToolCall(event);
    }

    // Handle custom_tool_call_output (result of custom tool call)
    if (payloadType === 'custom_tool_call_output') {
      return this.convertCustomToolCallOutput(event);
    }

    if (payloadType === 'reasoning') {
      // Extended thinking (encrypted content)
      return this.convertReasoningPayload(event);
    }

    if (payloadType === 'ghost_snapshot') {
      // Ghost commit snapshot - skip for now
      return null;
    }

    // Handle message-type response_item (user/assistant messages)
    if (!payload.role) {
      console.warn('[CodexConverter] response_item missing role and not a recognized type:', event);
      return null;
    }

    // Filter out system environment context messages from user
    if (payload.role === 'user' && payload.content) {
      const isEnvContext = payload.content.some((c: any) =>
        c.type === 'input_text' && c.text && (
          c.text.includes('<environment_context>') ||
          c.text.includes('# AGENTS.md instructions')
        )
      );

      if (isEnvContext) {
        return null;
      }
    }

    // Map payload to Claude message structure
    // Note: Codex uses 'input_text' for user messages and 'output_text' for assistant messages
    // Claude uses 'text' for both
    const content = payload.content?.map((c: any) => ({
      ...c,
      type: c.type === 'input_text' || c.type === 'output_text' ? 'text' : c.type
    })) || [];

    // Check if content is empty or has only empty text blocks
    if (content.length === 0) {
      console.warn('[CodexConverter] response_item has empty content, skipping');
      return null;
    }

    const hasNonEmptyContent = content.some((c: any) => {
      if (c.type === 'text') {
        return c.text && c.text.trim().length > 0;
      }
      return true; // Non-text content blocks are considered valid
    });

    if (!hasNonEmptyContent) {
      console.warn('[CodexConverter] response_item has no non-empty content, skipping');
      return null;
    }

    const message: ClaudeStreamMessage = {
      type: payload.role === 'user' ? 'user' : 'assistant',
      message: {
        role: payload.role,
        content: content
      },
      timestamp: payload.timestamp || event.timestamp || new Date().toISOString(),
      receivedAt: payload.timestamp || event.timestamp || new Date().toISOString(),
      // Add Codex identifier for UI display
      engine: 'codex' as const,
    };

    

    return message;
  }

  /**
   * Converts function_call response_item to tool_use message
   */
  private convertFunctionCall(event: any): ClaudeStreamMessage {
    const payload = event.payload;
    const rawToolName = payload.name || 'unknown_tool';
    // Map Codex tool names to Claude Code equivalents for consistent rendering
    const toolName = mapCodexToolName(rawToolName);
    const toolArgs = payload.arguments ? JSON.parse(payload.arguments) : {};
    const callId = payload.call_id || `call_${Date.now()}`;

    // For shell_command, also normalize the input structure
    let normalizedInput = toolArgs;
    if (toolName === 'bash' && !toolArgs.command && toolArgs.cmd) {
      normalizedInput = { command: toolArgs.cmd, ...toolArgs };
    }

    return {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: callId,
            name: toolName,
            input: normalizedInput,
          },
        ],
      },
      timestamp: event.timestamp || new Date().toISOString(),
      receivedAt: event.timestamp || new Date().toISOString(),
      engine: 'codex' as const,
    };
  }

  /**
   * Converts function_call_output response_item to tool_result message
   *
   * Note: For Codex, function_call and function_call_output are separate events.
   * We return a message with tool_result so it gets added to toolResults Map,
   * but mark it with _toolResultOnly so UI can filter it out from display.
   */
  private convertFunctionCallOutput(event: any): ClaudeStreamMessage {
    const payload = event.payload;
    const callId = payload.call_id || `call_${Date.now()}`;
    const output = payload.output || '';

    // Parse output if it's JSON string
    let resultContent = output;
    try {
      if (typeof output === 'string' && output.trim().startsWith('[')) {
        const parsed = JSON.parse(output);
        if (Array.isArray(parsed) && parsed[0]?.text) {
          resultContent = parsed[0].text;
        }
      }
    } catch {
      // Keep original output if parsing fails
    }

    return {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_result',
            tool_use_id: callId,
            content: typeof resultContent === 'string' ? resultContent : JSON.stringify(resultContent),
          },
        ],
      },
      timestamp: event.timestamp || new Date().toISOString(),
      receivedAt: event.timestamp || new Date().toISOString(),
      engine: 'codex' as const,
      // Mark as tool_result_only so UI can filter it out from display
      _toolResultOnly: true,
    } as ClaudeStreamMessage;
  }

  /**
   * Converts custom_tool_call response_item to tool_use message
   * Handles tools like apply_patch for file editing
   *
   * Format:
   * {
   *   "type": "custom_tool_call",
   *   "status": "completed",
   *   "call_id": "call_xxx",
   *   "name": "apply_patch",
   *   "input": "*** Begin Patch\n*** Update File: path/to/file\n..."
   * }
   */
  private convertCustomToolCall(event: any): ClaudeStreamMessage {
    const payload = event.payload;
    const rawToolName = payload.name || 'unknown_tool';
    const toolName = mapCodexToolName(rawToolName);
    const callId = payload.call_id || `call_${Date.now()}`;
    const input = payload.input || '';

    // Parse apply_patch input to extract file path and changes
    let normalizedInput: Record<string, any> = { raw_input: input };

    if (rawToolName === 'apply_patch' && typeof input === 'string') {
      // Extract file path from patch format: "*** Update File: path/to/file"
      const fileMatch = input.match(/\*\*\* (?:Update|Create|Delete) File: (.+)/);
      const filePath = fileMatch ? fileMatch[1].trim() : '';

      // Extract the patch content (everything between @@ markers)
      const patchMatch = input.match(/@@\n([\s\S]*?)(?:\n\*\*\* End Patch|$)/);
      const patchContent = patchMatch ? patchMatch[1] : input;

      // Parse diff-like content for old_string/new_string
      const lines = patchContent.split('\n');
      const oldLines: string[] = [];
      const newLines: string[] = [];

      for (const line of lines) {
        if (line.startsWith('-') && !line.startsWith('---')) {
          oldLines.push(line.slice(1));
        } else if (line.startsWith('+') && !line.startsWith('+++')) {
          newLines.push(line.slice(1));
        } else if (!line.startsWith('@@') && !line.startsWith('***')) {
          // Context line - add to both
          oldLines.push(line);
          newLines.push(line);
        }
      }

      normalizedInput = {
        file_path: filePath,
        old_string: oldLines.join('\n'),
        new_string: newLines.join('\n'),
        patch: input,
      };
    }

    return {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: callId,
            name: toolName,
            input: normalizedInput,
          },
        ],
      },
      timestamp: event.timestamp || new Date().toISOString(),
      receivedAt: event.timestamp || new Date().toISOString(),
      engine: 'codex' as const,
    };
  }

  /**
   * Converts custom_tool_call_output response_item
   *
   * Format:
   * {
   *   "type": "custom_tool_call_output",
   *   "call_id": "call_xxx",
   *   "output": "{\"output\":\"Success. Updated...\",\"metadata\":{...}}"
   * }
   *
   * Similar to function_call_output, we return a message with tool_result
   * so it gets added to toolResults Map, but mark it with _toolResultOnly
   * so UI can filter it out from display.
   */
  private convertCustomToolCallOutput(event: any): ClaudeStreamMessage {
    const payload = event.payload;
    const callId = payload.call_id || `call_${Date.now()}`;
    const output = payload.output || '';

    // Parse output if it's JSON string
    let resultContent = output;
    let isError = false;

    try {
      if (typeof output === 'string' && output.trim().startsWith('{')) {
        const parsed = JSON.parse(output);
        resultContent = parsed.output || parsed.message || output;
        isError = parsed.metadata?.exit_code !== 0;
      }
    } catch {
      // Keep original output if parsing fails
    }

    return {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_result',
            tool_use_id: callId,
            content: typeof resultContent === 'string' ? resultContent : JSON.stringify(resultContent),
            is_error: isError,
          },
        ],
      },
      timestamp: event.timestamp || new Date().toISOString(),
      receivedAt: event.timestamp || new Date().toISOString(),
      engine: 'codex' as const,
      // Mark as tool_result_only so UI can filter it out from display
      _toolResultOnly: true,
    } as ClaudeStreamMessage;
  }

  /**
   * Converts reasoning response_item to thinking message
   */
  private convertReasoningPayload(event: any): ClaudeStreamMessage {
    const payload = event.payload;

    // Extract summary text if available
    const summaryText = payload.summary
      ?.map((s: any) => s.text || s.summary_text)
      .filter(Boolean)
      .join('\n') || '';

    // Note: encrypted_content is encrypted and cannot be displayed
    // We use the summary instead
    return {
      type: 'thinking',
      content: summaryText || '(Extended thinking - encrypted content)',
      timestamp: event.timestamp || new Date().toISOString(),
      receivedAt: event.timestamp || new Date().toISOString(),
      engine: 'codex' as const,
      // 标记来源便于前端 ThinkingBlock 渲染时复用
      metadata: { source: 'codex_reasoning_summary' },
    } as ClaudeStreamMessage;
  }

  /**
   * 处理 Codex Responses API 的 reasoning_summary_text 流式事件
   *
   * 行为：
   * - .delta：累积到 reasoningSummaryBuffer，并以累积值发出 thinking 消息
   * - .done：以最终 buffer 发出 thinking 消息并清空缓冲
   *
   * 复用 Claude 的 thinking 消息形态，挂 metadata.source = 'codex_reasoning_summary'
   * 让 ThinkingBlock 直接渲染。
   */
  private convertReasoningSummaryEvent(event: any): ClaudeStreamMessage | null {
    const ts = event.timestamp || new Date().toISOString();
    const eventType: string = event.type || '';
    const itemId: string | undefined = event.item_id || event.payload?.item_id;
    const delta: string = event.delta ?? event.payload?.delta ?? '';
    const fullText: string = event.text ?? event.payload?.text ?? '';

    // 不同 item_id 视作新的一段，flush 缓冲
    if (itemId && this.reasoningSummaryItemId && itemId !== this.reasoningSummaryItemId) {
      this.reasoningSummaryBuffer = '';
    }
    if (itemId) {
      this.reasoningSummaryItemId = itemId;
    }

    if (eventType.endsWith('.done')) {
      const finalText = fullText || this.reasoningSummaryBuffer;
      this.reasoningSummaryBuffer = '';
      this.reasoningSummaryItemId = null;
      if (!finalText) return null;
      return {
        type: 'thinking',
        content: finalText,
        timestamp: ts,
        receivedAt: ts,
        engine: 'codex' as const,
        metadata: { source: 'codex_reasoning_summary' },
      } as ClaudeStreamMessage;
    }

    // delta 阶段
    if (delta) {
      this.reasoningSummaryBuffer += delta;
    }
    if (!this.reasoningSummaryBuffer) return null;
    return {
      type: 'thinking',
      content: this.reasoningSummaryBuffer,
      timestamp: ts,
      receivedAt: ts,
      engine: 'codex' as const,
      metadata: { source: 'codex_reasoning_summary', streaming: true },
    } as ClaudeStreamMessage;
  }

  /**
   * Converts a Codex item to ClaudeStreamMessage
   */
  private convertItem(item: CodexItem, phase: 'started' | 'updated' | 'completed', eventTimestamp?: string): ClaudeStreamMessage | null {
    const metadata: CodexMessageMetadata = {
      codexItemType: item.type,
      codexItemId: item.id,
      threadId: this.threadId || undefined,
      usage: this.currentTurnUsage || undefined,
    };

    switch (item.type) {
      case 'agent_message':
        return this.convertAgentMessage(item, phase, metadata, eventTimestamp);

      case 'reasoning':
        return this.convertReasoning(item, phase, metadata, eventTimestamp);

      case 'command_execution':
        return this.convertCommandExecution(item, phase, metadata, eventTimestamp);

      case 'file_change':
        return this.convertFileChange(item, phase, metadata, eventTimestamp);

      case 'mcp_tool_call':
        // Only show tool calls when completed (to avoid "executing" state)
        if (phase === 'completed') {
          return this.convertMcpToolCall(item, phase, metadata, eventTimestamp);
        }
        return null;

      case 'web_search':
        return this.convertWebSearch(item, phase, metadata, eventTimestamp);

      case 'todo_list':
        return this.convertTodoList(item, phase, metadata, eventTimestamp);

      default:
        console.warn('[CodexConverter] Unknown item type:', (item as any).type, 'Full item:', item);
        return null;
    }
  }

  /**
   * Converts agent_message to assistant message
   */
  private convertAgentMessage(
    item: CodexAgentMessageItem,
    _phase: string,
    metadata: CodexMessageMetadata,
    eventTimestamp?: string
  ): ClaudeStreamMessage {
    const ts = eventTimestamp || new Date().toISOString();
    return {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: item.text,
          },
        ],
      },
      timestamp: ts,
      receivedAt: ts,
      engine: 'codex' as const,
      codexMetadata: metadata,
    };
  }

  /**
   * Converts reasoning to thinking message
   */
  private convertReasoning(
    item: CodexReasoningItem,
    _phase: string,
    metadata: CodexMessageMetadata,
    eventTimestamp?: string
  ): ClaudeStreamMessage {
    const ts = eventTimestamp || new Date().toISOString();
    return {
      type: 'thinking',
      content: item.text,
      timestamp: ts,
      receivedAt: ts,
      engine: 'codex' as const,
      codexMetadata: metadata,
      // 标记来源便于前端 ThinkingBlock 渲染时复用
      metadata: { source: 'codex_reasoning_summary' },
    } as ClaudeStreamMessage;
  }

  /**
   * Converts command_execution to tool_use message
   */
  private convertCommandExecution(
    item: CodexCommandExecutionItem,
    phase: string,
    metadata: CodexMessageMetadata,
    eventTimestamp?: string
  ): ClaudeStreamMessage {
    const isComplete = phase === 'completed';
    const toolUseId = `codex_cmd_${item.id}`;
    const ts = eventTimestamp || new Date().toISOString();

    const toolUseBlock = {
      type: 'tool_use',
      id: toolUseId,
      name: 'bash',
      input: { command: item.command },
    };

    if (!isComplete) {
      // Stream a tool_use inside an assistant message so UI renders immediately
      return {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [toolUseBlock],
        },
        timestamp: ts,
        receivedAt: ts,
        engine: 'codex' as const,
        codexMetadata: metadata,
      };
    }

    // Completed -> assistant message containing both tool_use + tool_result
    const toolResultBlock = {
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: [
        {
          type: 'text',
          text: item.aggregated_output || '',
        },
      ],
      is_error: item.status === 'failed',
    };

    return {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [toolUseBlock, toolResultBlock],
      },
      timestamp: ts,
      receivedAt: ts,
      engine: 'codex' as const,
      codexMetadata: metadata,
    };
  }

  /**
   * Converts file_change to tool_use message
   */
  private convertFileChange(
    item: CodexFileChangeItem,
    phase: string,
    metadata: CodexMessageMetadata,
    eventTimestamp?: string
  ): ClaudeStreamMessage {
    const ts = eventTimestamp || new Date().toISOString();
    const toolUseId = `codex_file_${item.id}`;
    const toolName = item.change_type === 'create' ? 'write' : item.change_type === 'delete' ? 'bash' : 'edit';

    // Collect rich input so UI can show paths & diffs
    const inputPayload: Record<string, any> = {
      file_path: item.file_path,
      change_type: item.change_type,
    };
    if (item.content) inputPayload.content = item.content;
    if ((item as any).diff) inputPayload.diff = (item as any).diff;
    if ((item as any).patch) inputPayload.patch = (item as any).patch;
    if ((item as any).lines_changed) inputPayload.lines_changed = (item as any).lines_changed;

    const toolUseBlock = {
      type: 'tool_use',
      id: toolUseId,
      name: toolName,
      input: inputPayload,
    };

    if (phase !== 'completed') {
      return {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [toolUseBlock],
        },
        timestamp: ts,
        receivedAt: ts,
        engine: 'codex' as const,
        codexMetadata: metadata,
      };
    }

    const toolResultBlock = {
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: [
        {
          type: 'text',
          text: this.buildFileChangeSummary(item),
        },
      ],
      is_error: item.status === 'failed',
    };

    return {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [toolUseBlock, toolResultBlock],
      },
      timestamp: ts,
      receivedAt: ts,
      engine: 'codex' as const,
      codexMetadata: metadata,
    };
  }

  private buildFileChangeSummary(item: CodexFileChangeItem): string {
    const header = `File ${item.change_type}: ${item.file_path}`;
    const diff = (item as any).patch || (item as any).diff || '';
    const content = item.content || '';
    const snippetSource = diff || content;
    if (!snippetSource) return header;

    const snippet = snippetSource.length > 800 ? `${snippetSource.slice(0, 800)}\n...[truncated]` : snippetSource;
    return `${header}\n${snippet}`;
  }

  /**
   * Converts mcp_tool_call to complete tool_use + tool_result message
   * Only called when phase === 'completed'
   */
  private convertMcpToolCall(
    item: any, // Use any to handle actual Codex format
    _phase: string,
    metadata: CodexMessageMetadata,
    eventTimestamp?: string
  ): ClaudeStreamMessage {
    const ts = eventTimestamp || new Date().toISOString();
    const toolUseId = `codex_mcp_${item.id}`;

    // Extract tool name from Codex format: server.tool or just tool
    const toolName = item.server ? `mcp__${item.server}__${item.tool}` : (item.tool || item.tool_name);

    // Always create a complete message with both tool_use and tool_result
    {
    // Extract actual result content from nested structure
    const output = item.result || item.tool_output;
    let resultText = '';

    if (output && typeof output === 'object') {
      // MCP result format: { content: [{ text: "..." }], ... }
      if (output.content && Array.isArray(output.content)) {
        resultText = output.content
          .filter((c: any) => c.type === 'text' || c.text)
          .map((c: any) => c.text)
          .join('\n');
      } else {
        resultText = JSON.stringify(output, null, 2);
      }
    } else {
      resultText = output ? String(output) : '';
    }

    // Return assistant message with both tool_use and tool_result in content array
    return {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: toolUseId,
            name: toolName,
            input: item.arguments || item.tool_input || {},
          },
          {
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: [{ type: 'text', text: resultText }],
            is_error: item.status === 'failed' || item.error !== null,
          }
        ]
      },
      timestamp: ts,
      receivedAt: ts,
      engine: 'codex' as const,
      codexMetadata: metadata,
    };
  }
  }

  /**
   * Converts web_search to tool_use message
   */
  private convertWebSearch(
    item: CodexWebSearchItem,
    phase: string,
    metadata: CodexMessageMetadata,
    eventTimestamp?: string
  ): ClaudeStreamMessage {
    const ts = eventTimestamp || new Date().toISOString();
    const toolUseId = `codex_search_${item.id}`;

    const toolUseBlock = {
      type: 'tool_use',
      id: toolUseId,
      name: 'web_search',
      input: { query: item.query },
    };

    if (phase !== 'completed') {
      return {
        type: 'assistant',
        message: { role: 'assistant', content: [toolUseBlock] },
        timestamp: ts,
        receivedAt: ts,
        engine: 'codex' as const,
        codexMetadata: metadata,
      };
    }

    const toolResultBlock = {
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: [
        {
          type: 'text',
          text: JSON.stringify(item.results, null, 2),
        },
      ],
      is_error: item.status === 'failed',
    };

    return {
      type: 'assistant',
      message: { role: 'assistant', content: [toolUseBlock, toolResultBlock] },
      timestamp: ts,
      receivedAt: ts,
      engine: 'codex' as const,
      codexMetadata: metadata,
    };
  }

  /**
   * Converts todo_list to system message
   */
  private convertTodoList(
    item: CodexTodoListItem,
    _phase: string,
    metadata: CodexMessageMetadata,
    eventTimestamp?: string
  ): ClaudeStreamMessage {
    const ts = eventTimestamp || new Date().toISOString();
    const todoText = item.todos
      .map(
        (todo) =>
          `${todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '⏳' : '○'} ${todo.description}`
      )
      .join('\n');

    return {
      type: 'system',
      subtype: 'info',
      result: `**Plan:**\n${todoText}`,
      timestamp: ts,
      receivedAt: ts,
      engine: 'codex' as const,
      codexMetadata: metadata,
    };
  }

  /**
   * Creates a usage statistics message
   */
  private createUsageMessage(
    usage: {
      input_tokens: number;
      cached_input_tokens?: number;
      output_tokens: number;
    },
    eventTimestamp?: string,
    rateLimits?: CodexRateLimits | null
  ): ClaudeStreamMessage {
    const ts = eventTimestamp || new Date().toISOString();
    const totalTokens = usage.input_tokens + usage.output_tokens;
    const cacheInfo = usage.cached_input_tokens ? ` (${usage.cached_input_tokens} cached)` : '';
    const resolvedRateLimits = rateLimits || this.latestRateLimits || undefined;
    const codexItemId = `turn_completed_${Date.now()}`;

    return {
      type: 'system',
      subtype: 'info',
      result: `**Token Usage:** ${totalTokens} tokens (${usage.input_tokens} input${cacheInfo}, ${usage.output_tokens} output)`,
      timestamp: ts,
      receivedAt: ts,
      engine: 'codex' as const,
      model: this.activeModel || undefined,
      usage,
      codexMetadata: {
        codexItemType: 'turn.completed',
        codexItemId,
        threadId: this.threadId || undefined,
        usage,
        rateLimits: resolvedRateLimits,
      } as CodexMessageMetadata,
    };
  }

  /**
   * Creates a cumulative usage message from thread_token_usage_updated event
   * This event provides CUMULATIVE token counts for the entire session
   * Reference: https://hexdocs.pm/codex_sdk/05-api-reference.html
   */
  private createCumulativeUsageMessage(
    event: any,
    eventTimestamp?: string,
    rateLimits?: CodexRateLimits | null
  ): ClaudeStreamMessage {
    const ts = eventTimestamp || new Date().toISOString();
    const usage = event.usage || {};
    const resolvedRateLimits = rateLimits || this.latestRateLimits || undefined;

    // 标准化 usage 数据
    const normalizedUsage = {
      input_tokens: usage.input_tokens || 0,
      cached_input_tokens: usage.cached_input_tokens || 0,
      output_tokens: usage.output_tokens || 0,
    };

    // 更新当前 turn 的 usage（用于费用计算）
    this.currentTurnUsage = normalizedUsage;

    return {
      type: 'assistant',  // 使用 assistant 类型以便被费用计算捕获
      message: {
        role: 'assistant',
        content: [],
      },
      timestamp: ts,
      receivedAt: ts,
      engine: 'codex' as const,
      usage: normalizedUsage,  // 顶层 usage 供 tokenExtractor 提取
      codexMetadata: {
        codexItemType: 'thread_token_usage_updated',
        codexItemId: `usage_${Date.now()}`,
        threadId: event.thread_id,
        usage: normalizedUsage,
        rateLimits: resolvedRateLimits,
      },
    };
  }

  /**
   * Creates an error message
   */
  private createErrorMessage(errorText: string, eventTimestamp?: string): ClaudeStreamMessage {
    const ts = eventTimestamp || new Date().toISOString();
    return {
      type: 'system',
      subtype: 'error',
      result: `**Error:** ${errorText}`,
      timestamp: ts,
      receivedAt: ts,
    };
  }

  /**
   * Resets converter state (e.g., when starting a new session)
   */
  reset(): void {
    this.threadId = null;
    this.currentTurnUsage = null;
    this.lastTokenCountTotal = null;
    this.tokenCountSeq = 0;
    this.activeModel = null;
    this.itemMap.clear();
    this.toolResults.clear();
    this.latestRateLimits = null;
  }
}

/**
 * Singleton instance for global use
 */
export const codexConverter = new CodexEventConverter();
