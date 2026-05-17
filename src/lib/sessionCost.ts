import { tokenExtractor, type StandardizedTokenUsage } from '@/lib/tokenExtractor';
import { calculateMessageCost } from '@/lib/pricing';
import type { ClaudeStreamMessage } from '@/types/claude';

export interface BillingEvent {
  key: string;
  tokens: StandardizedTokenUsage;
  model: string;
  cost: number;
  timestamp?: string;
  timestampMs?: number;
  message: ClaudeStreamMessage;
}

export interface SessionCostTotals {
  totalCost: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface SessionCostAggregation {
  totals: SessionCostTotals;
  events: BillingEvent[];
  assistantMessageCount: number;
  firstEventTimestampMs?: number;
  lastEventTimestampMs?: number;
}

interface MutableBillingEvent extends BillingEvent {
  totalTokenCount: number;
  order: number;
}

const MODEL_FALLBACK = 'claude-sonnet-4-6';
const CODEX_MODEL_FALLBACK = 'gpt-5.5';
const GEMINI_MODEL_FALLBACK = 'auto-gemini-3';

/**
 * 检测消息的引擎类型
 */
function getEngineType(message: ClaudeStreamMessage): string {
  // 检查消息上的 engine 字段
  const engine = (message as any).engine;
  if (engine) return engine;

  // 检查 codexMetadata 字段（Codex 特有）
  if ((message as any).codexMetadata) return 'codex';

  // 检查 geminiMetadata 字段（Gemini 特有）
  if ((message as any).geminiMetadata?.provider === 'gemini') return 'gemini';

  // 默认为 Claude
  return 'claude';
}

export function aggregateSessionCost(messages: ClaudeStreamMessage[]): SessionCostAggregation {
  const eventMap = new Map<string, MutableBillingEvent>();

  messages.forEach((message, index) => {
    const engine = getEngineType(message);

    // Claude: 只处理 assistant 消息
    // Codex: 只处理 token_count/turn.completed 等 system usage 消息（增量 usage）
    // Gemini: 只处理 result 消息（usage 快照，按 turn 计费）
    const isClaudeBillable = engine === 'claude' && message.type === 'assistant';
    const isCodexBillable = engine === 'codex' && message.type === 'system' && (message as any).usage;
    const isGeminiBillable = engine === 'gemini' && message.type === 'result' && (message as any).usage;

    // 对于 Codex 引擎，需要特殊处理以避免重复计算：
    // - thread_token_usage_updated (assistant 类型): 累计值，跳过（不应累加）
    // - turn.completed (system 类型，无 codexMetadata): 单次 turn 增量，允许（实时对话）
    // - token_count (system 类型，有 codexMetadata.codexItemType): 增量值，允许（历史加载）
    if (engine === 'codex') {
      const codexItemType = (message as any).codexMetadata?.codexItemType;

      // 跳过 thread_token_usage_updated（累计值，不应累加到费用统计）
      if (codexItemType === 'thread_token_usage_updated') {
        return;
      }
    }

    if (!isClaudeBillable && !isCodexBillable && !isGeminiBillable) {
      return;
    }

    const tokens = tokenExtractor.extract(message);
    const totalTokenCount = calculateTotalTokens(tokens);

    if (totalTokenCount === 0) {
      return;
    }

    const key = getBillingKey(message, index);
    const { timestamp, timestampMs } = extractTimestamp(message);
    const model = getModelName(message, engine);
    const cost = calculateMessageCost(tokens, model, engine);

    const existing = eventMap.get(key);
    if (
      !existing ||
      totalTokenCount > existing.totalTokenCount ||
      (totalTokenCount === existing.totalTokenCount && (timestampMs ?? 0) >= (existing.timestampMs ?? 0))
    ) {
      eventMap.set(key, {
        key,
        tokens,
        model,
        cost,
        timestamp,
        timestampMs,
        message,
        totalTokenCount,
        order: index,
      });
    }
  });

  const events = Array.from(eventMap.values()).sort((a, b) => {
    if (a.timestampMs !== undefined && b.timestampMs !== undefined && a.timestampMs !== b.timestampMs) {
      return a.timestampMs - b.timestampMs;
    }

    if (a.timestampMs !== undefined) {
      return -1;
    }

    if (b.timestampMs !== undefined) {
      return 1;
    }

    return a.order - b.order;
  });

  const totals: SessionCostTotals = {
    totalCost: 0,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };

  events.forEach(event => {
    totals.totalCost += event.cost;
    totals.inputTokens += event.tokens.input_tokens;
    totals.outputTokens += event.tokens.output_tokens;
    totals.cacheReadTokens += event.tokens.cache_read_tokens;
    totals.cacheWriteTokens += event.tokens.cache_creation_tokens;
    totals.totalTokens += calculateTotalTokens(event.tokens);
  });

  const timestampValues = events
    .map(event => event.timestampMs)
    .filter((value): value is number => typeof value === 'number' && !Number.isNaN(value));

  const firstEventTimestampMs = timestampValues.length > 0 ? Math.min(...timestampValues) : undefined;
  const lastEventTimestampMs = timestampValues.length > 0 ? Math.max(...timestampValues) : undefined;

  return {
    totals,
    events,
    assistantMessageCount: events.length,
    firstEventTimestampMs,
    lastEventTimestampMs,
  };
}

function calculateTotalTokens(tokens: StandardizedTokenUsage): number {
  return (
    tokens.input_tokens +
    tokens.output_tokens +
    tokens.cache_creation_tokens +
    tokens.cache_read_tokens
  );
}

function getBillingKey(message: ClaudeStreamMessage, index: number): string {
  const nestedId = (message as any)?.message?.id;
  if (typeof nestedId === 'string' && nestedId.trim() !== '') {
    return `message:${nestedId}`;
  }

  const messageId = (message as any).id;
  if (typeof messageId === 'string' && messageId.trim() !== '') {
    return `message:${messageId}`;
  }

  const uuid = (message as any).uuid;
  if (typeof uuid === 'string' && uuid.trim() !== '') {
    return `uuid:${uuid}`;
  }

  const timestamp = (message as any).timestamp ?? (message as any).receivedAt;
  if (typeof timestamp === 'string' && timestamp.trim() !== '') {
    return `time:${timestamp}`;
  }

  return `index:${index}`;
}

function extractTimestamp(message: ClaudeStreamMessage): { timestamp?: string; timestampMs?: number } {
  const candidates = [
    (message as any).timestamp,
    (message as any).receivedAt,
    (message as any).sentAt,
    (message as any)?.message?.timestamp,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate.trim() === '') {
      continue;
    }

    const parsed = Date.parse(candidate);
    if (!Number.isNaN(parsed)) {
      return {
        timestamp: candidate,
        timestampMs: parsed,
      };
    }
  }

  return {};
}

function getModelName(message: ClaudeStreamMessage, engine?: string): string {
  const candidates = [
    (message as any).model,
    (message as any)?.message?.model,
    (message as any)?.codexMetadata?.model, // Codex 可能在 metadata 中存储模型
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      return candidate;
    }
  }

  // 根据引擎返回对应的默认模型
  if (engine === 'codex') return CODEX_MODEL_FALLBACK;
  if (engine === 'gemini') return GEMINI_MODEL_FALLBACK;
  return MODEL_FALLBACK;
}




