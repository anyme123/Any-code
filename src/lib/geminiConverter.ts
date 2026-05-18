import type { ClaudeStreamMessage } from '@/types/claude';
import type { GeminiSessionDetail } from '@/types/gemini';

type GeminiUsage = {
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens?: number;
};

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * Extract a Claude-compatible usage object from Gemini CLI history `tokens` or API `usageMetadata`.
 *
 * Supported shapes:
 * - Gemini API usageMetadata: promptTokenCount / candidatesTokenCount / cachedContentTokenCount / thoughtsTokenCount / toolUsePromptTokenCount
 * - Gemini CLI aggregated tokens: prompt / candidates / cached / thoughts / tool
 * - Simplified stats: input_tokens / output_tokens
 */
export function extractGeminiUsage(tokens: unknown): GeminiUsage | null {
  if (!tokens || typeof tokens !== 'object') return null;
  const t = tokens as any;

  const inputFromStats = toNumber(t.input_tokens);
  const outputFromStats = toNumber(t.output_tokens);

  const prompt =
    toNumber(t.prompt) ??
    toNumber(t.promptTokenCount) ??
    toNumber(t.prompt_token_count);

  const candidates =
    toNumber(t.candidates) ??
    toNumber(t.candidatesTokenCount) ??
    toNumber(t.candidates_token_count);

  const thoughts =
    toNumber(t.thoughts) ??
    toNumber(t.thoughtsTokenCount) ??
    toNumber(t.thoughts_token_count) ??
    0;

  const tool =
    toNumber(t.tool) ??
    toNumber(t.toolUsePromptTokenCount) ??
    toNumber(t.tool_use_prompt_token_count) ??
    0;

  const cached =
    toNumber(t.cached) ??
    toNumber(t.cachedContentTokenCount) ??
    toNumber(t.cached_content_token_count) ??
    0;

  const input_tokens = inputFromStats ?? (prompt !== null ? prompt + tool : null);
  const output_tokens = outputFromStats ?? (candidates !== null ? candidates + thoughts : null);

  if ((input_tokens ?? 0) <= 0 && (output_tokens ?? 0) <= 0 && cached <= 0) {
    return null;
  }

  const usage: GeminiUsage = {
    input_tokens: Math.max(input_tokens ?? 0, 0),
    output_tokens: Math.max(output_tokens ?? 0, 0),
  };

  if (cached > 0) {
    usage.cached_input_tokens = cached;
  }

  return usage;
}

/**
 * Gemini grounding 来源条目（统一前端结构）
 */
export interface GeminiGroundingSource {
  title: string;
  uri: string;
  snippet?: string;
}

/**
 * 从 Gemini candidates[].groundingMetadata 中提取标准化来源数组
 *
 * 支持的 shape：
 * - groundingChunks: [{ web: { uri, title } }, ...]
 * - groundingSupports: [{ segment: { text }, groundingChunkIndices: [...] }, ...]
 *
 * 同时兼容 camelCase / snake_case 字段命名差异。
 */
export function extractGeminiGroundingSources(candidate: unknown): GeminiGroundingSource[] {
  if (!candidate || typeof candidate !== 'object') return [];
  const c = candidate as any;
  const meta = c.groundingMetadata || c.grounding_metadata;
  if (!meta || typeof meta !== 'object') return [];

  const chunks: any[] = Array.isArray(meta.groundingChunks)
    ? meta.groundingChunks
    : Array.isArray(meta.grounding_chunks)
      ? meta.grounding_chunks
      : [];
  if (chunks.length === 0) return [];

  // 反向索引：chunkIndex -> 关联文本片段，用作 snippet
  const supports: any[] = Array.isArray(meta.groundingSupports)
    ? meta.groundingSupports
    : Array.isArray(meta.grounding_supports)
      ? meta.grounding_supports
      : [];
  const snippetByIndex = new Map<number, string>();
  for (const s of supports) {
    const text = s?.segment?.text;
    const indices: number[] = s?.groundingChunkIndices || s?.grounding_chunk_indices || [];
    if (typeof text === 'string' && Array.isArray(indices)) {
      for (const idx of indices) {
        // 同一 chunk 多次命中时，取首段即可，避免拼接过长
        if (!snippetByIndex.has(idx)) snippetByIndex.set(idx, text);
      }
    }
  }

  const sources: GeminiGroundingSource[] = [];
  chunks.forEach((chunk, idx) => {
    const web = chunk?.web || chunk?.retrievedContext || chunk?.retrieved_context;
    const uri: string | undefined = web?.uri || web?.url;
    const title: string | undefined = web?.title || web?.name;
    if (!uri) return;
    sources.push({
      title: title || uri,
      uri,
      snippet: snippetByIndex.get(idx),
    });
  });
  return sources;
}

/**
 * Convert Gemini CLI `get_gemini_session_detail` payload into unified ClaudeStreamMessage array.
 *
 * Goal: keep history-loaded messages consistent with stream-json output:
 * - user/assistant/tool_use/tool_result content blocks
 * - per-turn `result` messages carrying `usage` for cost + context window calculations
 */
export function convertGeminiSessionDetailToClaudeMessages(
  detail: GeminiSessionDetail
): ClaudeStreamMessage[] {
  const converted: ClaudeStreamMessage[] = [];

  for (const msg of detail.messages) {
    if (msg.type === 'user') {
      converted.push({
        type: 'user',
        message: {
          content: msg.content ? [{ type: 'text', text: msg.content }] : [],
          role: 'user',
        },
        timestamp: msg.timestamp,
        engine: 'gemini',
      });
      continue;
    }

    // Gemini assistant message
    const assistantContent: any[] = [];

    // Add tool calls if present
    if (Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0) {
      for (const toolCall of msg.toolCalls) {
        assistantContent.push({
          type: 'tool_use',
          id: toolCall.id,
          name: toolCall.name,
          input: toolCall.args,
        });

        // If there's a result, add it as a separate user message (tool_result)
        if (toolCall.result !== undefined) {
          // Prefer the actual output data over `resultDisplay` (which can be an abbreviated summary)
          let resultContent: unknown = toolCall.result;

          // Extract Gemini functionResponse format: [{ functionResponse: { response: { output }}}]
          if (Array.isArray(toolCall.result)) {
            const first = toolCall.result[0] as any;
            if (first?.functionResponse?.response?.output !== undefined) {
              resultContent = first.functionResponse.response.output;
            }
          }

          converted.push({
            type: 'user',
            message: {
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: toolCall.id,
                  content:
                    toolCall.resultDisplay ||
                    (typeof resultContent === 'string' ? resultContent : JSON.stringify(resultContent)),
                  is_error: toolCall.status === 'error',
                },
              ],
              role: 'user',
            },
            timestamp: toolCall.timestamp || msg.timestamp,
            engine: 'gemini',
          });
        }
      }
    }

    if (msg.content) {
      assistantContent.push({ type: 'text', text: msg.content });
    }

    // 兼容性提取 groundingMetadata：CLI 历史目前不带 candidates，
    // 但若后端在 message 上挂了 candidates / groundingMetadata 字段则照样能识别
    const rawMsg = msg as any;
    const groundingSources = (() => {
      if (Array.isArray(rawMsg.candidates) && rawMsg.candidates.length > 0) {
        return extractGeminiGroundingSources(rawMsg.candidates[0]);
      }
      if (rawMsg.groundingMetadata || rawMsg.grounding_metadata) {
        return extractGeminiGroundingSources({ groundingMetadata: rawMsg.groundingMetadata || rawMsg.grounding_metadata });
      }
      return [];
    })();

    const assistantMessage: ClaudeStreamMessage = {
      type: 'assistant',
      message: {
        content: assistantContent.length > 0 ? assistantContent : [{ type: 'text', text: '' }],
        role: 'assistant',
      },
      timestamp: msg.timestamp,
      engine: 'gemini',
      model: msg.model,
    };
    if (groundingSources.length > 0) {
      // 解耦方案：直接挂 metadata，由前端 StreamMessageV2 检测后渲染
      (assistantMessage as any).groundingSources = groundingSources;
    }
    converted.push(assistantMessage);

    const usage = extractGeminiUsage(msg.tokens);
    if (usage) {
      converted.push({
        type: 'result',
        subtype: 'success',
        usage,
        timestamp: msg.timestamp,
        engine: 'gemini',
        model: msg.model,
      });
    }
  }

  return converted;
}

