/**
 * Official Claude Token Counter Service
 *
 * 基于Claude官方Token Count API的准确token计算服务
 * 支持所有消息类型和Claude模型的精确token统计和成本计算
 *
 * 2026年最新官方定价和Claude 4.7/4.6系列模型支持
 */

import Anthropic from '@anthropic-ai/sdk';
import { api } from './api';

// ============================================================================
// Claude Model Pricing - MUST MATCH BACKEND (usage.rs)
// ⚠️ WARNING: This pricing table MUST be kept in sync with:
//    src-tauri/src/commands/usage.rs::ModelPricing
// Source: https://docs.claude.com/en/docs/about-claude/models/overview
// Last Updated: May 2026
// ============================================================================

export const CLAUDE_PRICING = {
  // Claude 4.7/4.6 Series
  'claude-opus-4-7': {
    input: 5.0,
    output: 25.0,
    cache_write: 6.25,
    cache_read: 0.50,
  },
  'claude-opus-4-6': {
    input: 5.0,
    output: 25.0,
    cache_write: 6.25,
    cache_read: 0.50,
  },
  'claude-sonnet-4-6': {
    input: 3.0,
    output: 15.0,
    cache_write: 3.75,
    cache_read: 0.30,
  },
  // Claude 4.5 Series
  'claude-opus-4-5': {
    input: 5.0,
    output: 25.0,
    cache_write: 6.25,
    cache_read: 0.50,
  },
  'claude-opus-4-5-20251101': {
    input: 5.0,
    output: 25.0,
    cache_write: 6.25,
    cache_read: 0.50,
  },
  'claude-sonnet-4-5': {
    input: 3.0,
    output: 15.0,
    cache_write: 3.75,
    cache_read: 0.30,
  },
  'claude-sonnet-4-5-20250929': {
    input: 3.0,
    output: 15.0,
    cache_write: 3.75,
    cache_read: 0.30,
  },
  'claude-haiku-4-5': {
    input: 1.0,
    output: 5.0,
    cache_write: 1.25,
    cache_read: 0.10,
  },
  'claude-haiku-4-5-20251001': {
    input: 1.0,
    output: 5.0,
    cache_write: 1.25,
    cache_read: 0.10,
  },
  // Claude 4.1 Series
  'claude-opus-4-1': {
    input: 15.0,
    output: 75.0,
    cache_write: 18.75,
    cache_read: 1.50,
  },
  'claude-opus-4-1-20250805': {
    input: 15.0,
    output: 75.0,
    cache_write: 18.75,
    cache_read: 1.50,
  },
  // 默认值 (使用最新 Sonnet 4.6 定价)
  'default': {
    input: 3.0,
    output: 15.0,
    cache_write: 3.75,
    cache_read: 0.30,
  }
} as const;

// ============================================================================
// AI Model Context Windows
// 各模型的上下文窗口大小（tokens）
// Claude: https://docs.claude.com/en/docs/about-claude/models/overview
// Codex: https://github.com/openai/codex (官方文档)
// ============================================================================

export const CLAUDE_CONTEXT_WINDOWS = {
  // Claude 4.7/4.6 Series
  'claude-opus-4-7': 200000,
  'claude-opus-4-7[1m]': 1000000,
  'claude-opus-4-6': 200000,
  'claude-opus-4-6[1m]': 1000000,
  'claude-sonnet-4-6': 200000,
  'claude-sonnet-4-6[1m]': 1000000,
  // Claude 4.5 Series
  'claude-opus-4-5': 200000,
  'claude-opus-4-5-20251101': 200000,
  'claude-sonnet-4-5': 200000,
  'claude-sonnet-4-5-20250929': 200000,
  'claude-haiku-4-5': 200000,
  'claude-haiku-4-5-20251001': 200000,
  // Claude 4.1 Series
  'claude-opus-4-1': 200000,
  'claude-opus-4-1-20250805': 200000,
  // 默认值
  'default': 200000,
} as const;

// ============================================================================
// Codex Model Context Windows
// Source: Codex CLI history token_count events expose model_context_window (e.g. 272000 for gpt-5-codex)
// ============================================================================

export const CODEX_CONTEXT_WINDOWS = {
  'gpt-5.5': 1_050_000,
  'gpt-5.5-pro': 1_050_000,
  'gpt-5-pro': 1_050_000,
  'gpt-5.4': 1_050_000,
  'gpt-5.4-pro': 1_050_000,
  'gpt-5.4-mini': 1_050_000,
  'gpt-5.4-nano': 1_050_000,
  // GPT-5.3-Codex 系列 - 最新代码模型（2026年2月发布）
  // 400K context window, 128K max output
  'gpt-5.3-codex': 400000,
  'gpt-5.3-codex-spark': 400000,
  // GPT-5.2 系列
  'gpt-5.2': 272000,
  'gpt-5.2-codex': 272000,
  // GPT-5.1-Codex 系列
  'gpt-5.1-codex': 272000,
  'gpt-5.1-codex-mini': 272000,
  'gpt-5.1-codex-max': 272000,
  'gpt-5-codex': 272000,
  'codex-mini-latest': 272000,
  // o4-mini (Codex 底层模型)
  'o4-mini': 128000,
  // 默认值
  'default': 1_050_000,
} as const;

// ============================================================================
// Gemini Model Context Windows
// Source: https://ai.google.dev/gemini-api/docs/models (and model cards)
// NOTE: Current app configuration uses 1M context across supported Gemini models.
// ============================================================================

export const GEMINI_CONTEXT_WINDOWS = {
  'auto-gemini-3': 1_000_000,
  'auto-gemini-2.5': 1_000_000,
  'auto': 1_000_000,
  'pro': 1_000_000,
  'flash': 1_000_000,
  'flash-lite': 1_000_000,
  'gemini-3.1-pro-preview': 2_000_000,
  'gemini-3-pro-preview': 1_000_000,
  'gemini-3-pro-image-preview': 1_000_000,
  'gemini-3-flash-preview': 1_000_000,
  'gemini-2.5-pro': 1_000_000,
  'gemini-2.5-flash': 1_000_000,
  'gemini-2.5-flash-lite': 1_000_000,
  'gemini-2.0-flash': 1_000_000,
  'gemini-2.0-flash-exp': 1_000_000,
  'default': 1_000_000,
} as const;

/**
 * 获取模型的上下文窗口大小
 * @param model - 模型名称
 * @param engine - 引擎类型（claude/codex/gemini）
 * @returns 上下文窗口大小（tokens）
 */
export function getContextWindowSize(model?: string, engine?: string): number {
  // Gemini 引擎
  if (engine === 'gemini') {
    if (!model) return GEMINI_CONTEXT_WINDOWS['default'];

    const lowerModel = model.toLowerCase();

    // 处理 Vertex AI / provider 前缀与版本后缀
    const normalized = lowerModel
      .replace('google.', '')
      .replace('vertex.', '')
      .replace('-v1:0', '')
      .split('@')[0];

    if (normalized in GEMINI_CONTEXT_WINDOWS) {
      return GEMINI_CONTEXT_WINDOWS[normalized as keyof typeof GEMINI_CONTEXT_WINDOWS];
    }

    if (normalized.startsWith('gemini-3-flash')) {
      return GEMINI_CONTEXT_WINDOWS['gemini-3-flash-preview'];
    }

    // 常见变体：-exp / -preview / 版本日期后缀等 -> 回退到家族默认 1M
    if (normalized.startsWith('gemini-')) {
      return GEMINI_CONTEXT_WINDOWS['default'];
    }

    return GEMINI_CONTEXT_WINDOWS['default'];
  }

  // Codex 引擎
  if (engine === 'codex') {
    if (!model) return CODEX_CONTEXT_WINDOWS['default'];

    const lowerModel = model.toLowerCase();

    // 尝试直接匹配
    if (lowerModel in CODEX_CONTEXT_WINDOWS) {
      return CODEX_CONTEXT_WINDOWS[lowerModel as keyof typeof CODEX_CONTEXT_WINDOWS];
    }

    if (lowerModel.includes('gpt-5.5') || lowerModel.includes('gpt5.5') || lowerModel.includes('gpt_5_5')) {
      return lowerModel.includes('pro') ? CODEX_CONTEXT_WINDOWS['gpt-5.5-pro'] : CODEX_CONTEXT_WINDOWS['gpt-5.5'];
    }
    if (lowerModel.includes('gpt-5-pro') || lowerModel.includes('gpt_5_pro')) {
      return CODEX_CONTEXT_WINDOWS['gpt-5-pro'];
    }
    if (lowerModel.includes('gpt-5.4') || lowerModel.includes('gpt5.4') || lowerModel.includes('gpt_5_4')) {
      if (lowerModel.includes('pro')) return CODEX_CONTEXT_WINDOWS['gpt-5.4-pro'];
      if (lowerModel.includes('mini')) return CODEX_CONTEXT_WINDOWS['gpt-5.4-mini'];
      if (lowerModel.includes('nano')) return CODEX_CONTEXT_WINDOWS['gpt-5.4-nano'];
      return CODEX_CONTEXT_WINDOWS['gpt-5.4'];
    }

    // GPT-5.3-Codex 系列
    if (lowerModel.includes('5.3-codex-spark') || lowerModel.includes('5_3_codex_spark')) {
      return CODEX_CONTEXT_WINDOWS['gpt-5.3-codex-spark'];
    }
    if (lowerModel.includes('5.3-codex') || lowerModel.includes('5_3_codex')) {
      return CODEX_CONTEXT_WINDOWS['gpt-5.3-codex'];
    }
    if (lowerModel.includes('gpt-5.3') || lowerModel.includes('gpt_5_3')) {
      return CODEX_CONTEXT_WINDOWS['gpt-5.3-codex'];
    }

    // GPT-5.1-Codex 系列
    if (lowerModel.includes('5.1-codex-max') || lowerModel.includes('5_1_codex_max')) {
      return CODEX_CONTEXT_WINDOWS['gpt-5.1-codex-max'];
    }
    if (lowerModel.includes('5.1-codex-mini') || lowerModel.includes('5_1_codex_mini')) {
      return CODEX_CONTEXT_WINDOWS['gpt-5.1-codex-mini'];
    }
    if (lowerModel.includes('5.1-codex') || lowerModel.includes('5_1_codex')) {
      return CODEX_CONTEXT_WINDOWS['gpt-5.1-codex'];
    }

    // GPT-5.2 系列
    if (lowerModel.includes('5.2-codex') || lowerModel.includes('5_2_codex')) {
      return CODEX_CONTEXT_WINDOWS['gpt-5.2-codex'];
    }
    if (lowerModel.includes('gpt-5.2') || lowerModel.includes('gpt_5_2') || lowerModel.includes('5.2')) {
      return CODEX_CONTEXT_WINDOWS['gpt-5.2'];
    }

    // o4-mini
    if (lowerModel.includes('o4-mini') || lowerModel.includes('o4_mini')) {
      return CODEX_CONTEXT_WINDOWS['o4-mini'];
    }

    // codex-mini-latest - 默认 CLI 模型
    if (lowerModel.includes('codex-mini-latest') || lowerModel.includes('codex_mini_latest')) {
      return CODEX_CONTEXT_WINDOWS['codex-mini-latest'];
    }

    // gpt-5-codex (别名)
    if (lowerModel.includes('gpt-5-codex') || lowerModel.includes('gpt_5_codex')) {
      return CODEX_CONTEXT_WINDOWS['gpt-5-codex'];
    }

    // 通用 Codex 匹配 - 默认使用 GPT-5.5
    if (lowerModel.includes('codex')) {
      return CODEX_CONTEXT_WINDOWS['gpt-5.5'];
    }

    return CODEX_CONTEXT_WINDOWS['default'];
  }

  // Claude 引擎（默认）
  if (!model) return CLAUDE_CONTEXT_WINDOWS['default'];

  // 尝试直接匹配
  if (model in CLAUDE_CONTEXT_WINDOWS) {
    return CLAUDE_CONTEXT_WINDOWS[model as keyof typeof CLAUDE_CONTEXT_WINDOWS];
  }

  // 尝试通过别名匹配
  const normalizedModel = MODEL_ALIASES[model as keyof typeof MODEL_ALIASES];
  if (normalizedModel && normalizedModel in CLAUDE_CONTEXT_WINDOWS) {
    return CLAUDE_CONTEXT_WINDOWS[normalizedModel as keyof typeof CLAUDE_CONTEXT_WINDOWS];
  }

  return CLAUDE_CONTEXT_WINDOWS['default'];
}

// 标准化模型名称映射
export const MODEL_ALIASES = {
  'default': 'claude-sonnet-4-6',
  'best': 'claude-opus-4-7',
  'opus': 'claude-opus-4-7', // 默认最新版本
  'opus1m': 'claude-opus-4-7[1m]',
  'opus4.7': 'claude-opus-4-7',
  'opus-4.7': 'claude-opus-4-7',
  'opus4.6': 'claude-opus-4-6',
  'opus-4.6': 'claude-opus-4-6',
  'opus4.5': 'claude-opus-4-5',
  'opus-4.5': 'claude-opus-4-5',
  'opus4.1': 'claude-opus-4-1',
  'opus-4.1': 'claude-opus-4-1',
  'sonnet': 'claude-sonnet-4-6', // 默认最新版本
  'sonnet1m': 'claude-sonnet-4-6[1m]',
  'sonnet4.6': 'claude-sonnet-4-6',
  'sonnet-4.6': 'claude-sonnet-4-6',
  'sonnet4.5': 'claude-sonnet-4-5',
  'sonnet-4.5': 'claude-sonnet-4-5',
  'haiku': 'claude-haiku-4-5', // 默认最新版本
  'haiku4.5': 'claude-haiku-4-5',
  'haiku-4.5': 'claude-haiku-4-5',
  'opusplan': 'claude-opus-4-7',
} as const;

/**
 * ✅ Token使用统计接口
 *
 * @deprecated Consider using StandardizedTokenUsage from tokenExtractor.ts for new code.
 * This interface is kept for backward compatibility with existing code.
 *
 * For new implementations:
 * - Use `StandardizedTokenUsage` from tokenExtractor.ts (fully normalized with total_tokens)
 * - Use `RawTokenUsage` from tokenExtractor.ts (for handling various API response formats)
 * - Use `normalizeRawUsage()` from tokenExtractor.ts to convert raw data to standard format
 */
export interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation_tokens?: number;
  cache_read_input_tokens?: number;
  cache_read_tokens?: number;
}

// 消息接口
export interface ClaudeMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | Array<{
    type: 'text' | 'image' | 'document';
    text?: string;
    source?: {
      type: 'base64';
      media_type: string;
      data: string;
    };
  }>;
}

// 工具定义接口
export interface ClaudeTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

// Token计算响应接口
export interface TokenCountResponse {
  input_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

// 成本分析结果
export interface CostBreakdown {
  input_cost: number;
  output_cost: number;
  cache_write_cost: number;
  cache_read_cost: number;
  total_cost: number;
  total: number; // 向后兼容字段
}

// Token明细分析
export interface TokenBreakdown {
  total: number;
  input: number;
  output: number;
  cache_write: number;
  cache_read: number;
  cost: CostBreakdown;
  efficiency: {
    cache_hit_rate: number;
    cost_savings: number;
  };
}

export class TokenCounterService {
  private client: Anthropic | null = null;
  private apiKey: string | null = null;
  private baseURL: string | null = null;

  constructor() {
    this.initialize();
  }

  /**
   * 初始化Anthropic客户端
   */
  private async initialize() {
    try {
      // 从多个来源获取API密钥
      this.apiKey = this.getApiKey();
      this.baseURL = this.getBaseURL();

      if (this.apiKey) {
        this.client = new Anthropic({
          apiKey: this.apiKey,
          baseURL: this.baseURL || undefined,
          defaultHeaders: {
            'anthropic-beta': 'prompt-caching-2024-07-31,token-counting-2024-11-01',
          },
        });
      }
    } catch (error) {
      console.warn('[TokenCounter] 初始化失败，将使用估算方法:', error);
    }
  }

  /**
   * 获取API密钥
   */
  private getApiKey(): string | null {
    // 1. 环境变量
    if (typeof window !== 'undefined') {
      // 浏览器环境
      return null; // 浏览器中不应直接使用API密钥
    }

    // Node.js环境
    return process.env.ANTHROPIC_API_KEY ||
           process.env.ANTHROPIC_AUTH_TOKEN ||
           null;
  }

  /**
   * 获取基础URL
   */
  private getBaseURL(): string | null {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('anthropic_base_url');
    }

    return process.env.ANTHROPIC_BASE_URL ||
           process.env.CLAUDE_API_BASE_URL ||
           null;
  }

  /**
   * 标准化模型名称
   * ⚠️ MUST MATCH: src-tauri/src/commands/usage.rs::parse_model_family
   *
   * This function replicates the backend logic to ensure consistent
   * model identification and pricing across frontend and backend.
   */
  public normalizeModel(model?: string): string {
    if (!model) return 'claude-sonnet-4-6';

    // Normalize: lowercase + remove common prefixes/suffixes
    let normalized = model.toLowerCase();
    normalized = normalized.replace('anthropic.', '');
    normalized = normalized.replace('-v1:0', '');

    // Handle @ symbol for Vertex AI format
    const atIndex = normalized.indexOf('@');
    if (atIndex !== -1) {
      normalized = normalized.substring(0, atIndex);
    }

    // Priority-based matching (order matters! MUST match backend logic)

    if (normalized === 'default') {
      return 'claude-sonnet-4-6';
    }
    if (normalized === 'best' || normalized === 'opusplan') {
      return 'claude-opus-4-7';
    }

    // Claude 4.7 Series
    if (normalized.includes('opus') && (normalized.includes('4.7') || normalized.includes('4-7'))) {
      return 'claude-opus-4-7';
    }

    // Claude 4.6 Series
    if (normalized.includes('opus') && (normalized.includes('4.6') || normalized.includes('4-6'))) {
      return 'claude-opus-4-6';
    }
    if (normalized.includes('sonnet') && (normalized.includes('4.6') || normalized.includes('4-6'))) {
      return 'claude-sonnet-4-6';
    }

    // Claude 4.5 Series
    if (normalized.includes('opus') && (normalized.includes('4.5') || normalized.includes('4-5'))) {
      return 'claude-opus-4-5';
    }
    if (normalized.includes('haiku') && (normalized.includes('4.5') || normalized.includes('4-5'))) {
      return 'claude-haiku-4-5';
    }
    if (normalized.includes('sonnet') && (normalized.includes('4.5') || normalized.includes('4-5'))) {
      return 'claude-sonnet-4-5';
    }

    // Claude 4.1 Series
    if (normalized.includes('opus') && (normalized.includes('4.1') || normalized.includes('4-1'))) {
      return 'claude-opus-4-1';
    }

    // Generic family detection (fallback - MUST match backend)
    if (normalized.includes('haiku')) {
      return 'claude-haiku-4-5'; // Default to latest
    }
    if (normalized.includes('opus')) {
      return 'claude-opus-4-7'; // Default to latest
    }
    if (normalized.includes('sonnet')) {
      return 'claude-sonnet-4-6'; // Default to latest
    }

    // Unknown model - return original
    console.warn(`[TokenCounter] Unknown model: '${model}'. Using default pricing.`);
    return model;
  }

  /**
   * 使用官方API计算token数量
   */
  async countTokens(
    messages: ClaudeMessage[],
    model?: string,
    tools?: ClaudeTool[],
    systemPrompt?: string
  ): Promise<TokenCountResponse> {
    const normalizedModel = this.normalizeModel(model);

    // 如果客户端不可用，使用估算方法
    if (!this.client) {
      return this.estimateTokens(messages, tools, systemPrompt);
    }

    try {
      const requestData: any = {
        model: normalizedModel,
        messages: messages.map(msg => ({
          role: msg.role,
          content: msg.content,
        })),
      };

      if (tools && tools.length > 0) {
        requestData.tools = tools;
      }

      if (systemPrompt) {
        requestData.system = systemPrompt;
      }

      const response = await this.client.messages.countTokens(requestData);

      return {
        input_tokens: response.input_tokens,
        cache_creation_input_tokens: (response as any).cache_creation_input_tokens,
        cache_read_input_tokens: (response as any).cache_read_input_tokens,
      };
    } catch (error) {
      console.warn('[TokenCounter] API调用失败，使用估算方法:', error);
      return this.estimateTokens(messages, tools, systemPrompt);
    }
  }

  /**
   * 降级估算方法（当API不可用时）
   */
  private estimateTokens(
    messages: ClaudeMessage[],
    tools?: ClaudeTool[],
    systemPrompt?: string
  ): TokenCountResponse {
    let totalTokens = 0;

    // 估算消息token
    for (const message of messages) {
      if (typeof message.content === 'string') {
        totalTokens += Math.ceil(message.content.length / 4); // 粗略估算：4字符=1token
      } else if (Array.isArray(message.content)) {
        for (const content of message.content) {
          if (content.type === 'text' && content.text) {
            totalTokens += Math.ceil(content.text.length / 4);
          } else if (content.type === 'image') {
            totalTokens += 1551; // 基于官方文档的图像token估算
          } else if (content.type === 'document') {
            totalTokens += 2188; // 基于官方文档的PDF token估算
          }
        }
      }
    }

    // 估算系统提示token
    if (systemPrompt) {
      totalTokens += Math.ceil(systemPrompt.length / 4);
    }

    // 估算工具定义token
    if (tools && tools.length > 0) {
      const toolsJson = JSON.stringify(tools);
      totalTokens += Math.ceil(toolsJson.length / 4);
    }

    return {
      input_tokens: totalTokens,
    };
  }

  /**
   * 批量计算token（并行处理）
   */
  async batchCountTokens(
    requests: Array<{
      messages: ClaudeMessage[];
      model?: string;
      tools?: ClaudeTool[];
      systemPrompt?: string;
    }>
  ): Promise<TokenCountResponse[]> {
    try {
      const promises = requests.map(req =>
        this.countTokens(req.messages, req.model, req.tools, req.systemPrompt)
      );
      return await Promise.all(promises);
    } catch (error) {
      console.error('[TokenCounter] 批量计算失败:', error);
      // 降级到逐个计算
      const results: TokenCountResponse[] = [];
      for (const req of requests) {
        try {
          const result = await this.countTokens(req.messages, req.model, req.tools, req.systemPrompt);
          results.push(result);
        } catch (err) {
          results.push({ input_tokens: 0 });
        }
      }
      return results;
    }
  }

  /**
   * 计算成本
   */
  calculateCost(usage: TokenUsage, model?: string): CostBreakdown {
    const normalizedModel = this.normalizeModel(model);
    const pricing = CLAUDE_PRICING[normalizedModel as keyof typeof CLAUDE_PRICING];

    if (!pricing) {
      console.warn(`[TokenCounter] 未知模型定价: ${normalizedModel}`);
      return {
        input_cost: 0,
        output_cost: 0,
        cache_write_cost: 0,
        cache_read_cost: 0,
        total_cost: 0,
        total: 0, // 向后兼容字段
      };
    }

    const input_tokens = usage.input_tokens || 0;
    const output_tokens = usage.output_tokens || 0;
    const cache_write_tokens = usage.cache_creation_input_tokens || usage.cache_creation_tokens || 0;
    const cache_read_tokens = usage.cache_read_input_tokens || usage.cache_read_tokens || 0;

    const input_cost = (input_tokens * pricing.input) / 1_000_000;
    const output_cost = (output_tokens * pricing.output) / 1_000_000;
    const cache_write_cost = (cache_write_tokens * pricing.cache_write) / 1_000_000;
    const cache_read_cost = (cache_read_tokens * pricing.cache_read) / 1_000_000;

    const total_cost = input_cost + output_cost + cache_write_cost + cache_read_cost;
    return {
      input_cost,
      output_cost,
      cache_write_cost,
      cache_read_cost,
      total_cost,
      total: total_cost, // 向后兼容字段
    };
  }

  /**
   * 获取详细的token明细分析
   */
  calculateBreakdown(usage: TokenUsage, model?: string): TokenBreakdown {
    const normalized = this.normalizeUsage(usage);
    const cost = this.calculateCost(normalized, model);

    const total = normalized.input_tokens + normalized.output_tokens +
                 (normalized.cache_creation_tokens || 0) + (normalized.cache_read_tokens || 0);

    const cache_hit_rate = total > 0 ? ((normalized.cache_read_tokens || 0) / total) * 100 : 0;

    // 计算缓存节约的成本
    const standard_cost = ((normalized.cache_read_tokens || 0) *
                          (CLAUDE_PRICING[this.normalizeModel(model) as keyof typeof CLAUDE_PRICING]?.input || 3)) / 1_000_000;
    const actual_cache_cost = cost.cache_read_cost;
    const cost_savings = standard_cost - actual_cache_cost;

    return {
      total,
      input: normalized.input_tokens,
      output: normalized.output_tokens,
      cache_write: normalized.cache_creation_tokens || 0,
      cache_read: normalized.cache_read_tokens || 0,
      cost,
      efficiency: {
        cache_hit_rate,
        cost_savings,
      },
    };
  }

  /**
   * 标准化token使用数据
   *
   * ⚠️ This method now delegates to tokenExtractor.ts for unified token normalization.
   * All token standardization logic is centralized in tokenExtractor.ts
   */
  normalizeUsage(usage: TokenUsage): Required<TokenUsage> {
    // Import from tokenExtractor for unified normalization
    const { normalizeRawUsage } = require('./tokenExtractor');
    const standardized = normalizeRawUsage(usage);

    // Return in the expected TokenUsage format
    return {
      input_tokens: standardized.input_tokens,
      output_tokens: standardized.output_tokens,
      cache_creation_input_tokens: standardized.cache_creation_tokens,
      cache_creation_tokens: standardized.cache_creation_tokens,
      cache_read_input_tokens: standardized.cache_read_tokens,
      cache_read_tokens: standardized.cache_read_tokens,
    };
  }

  /**
   * 格式化token数量显示
   */
  formatCount(count: number): string {
    if (count >= 1_000_000) {
      return `${(count / 1_000_000).toFixed(2)}M`;
    } else if (count >= 1_000) {
      return `${(count / 1_000).toFixed(1)}K`;
    }
    return count.toLocaleString();
  }

  /**
   * 格式化成本显示
   */
  formatCost(cost: number): string {
    if (cost >= 1) {
      return `$${cost.toFixed(2)}`;
    } else if (cost >= 0.01) {
      return `$${cost.toFixed(3)}`;
    } else if (cost >= 0.001) {
      return `$${cost.toFixed(4)}`;
    } else if (cost > 0) {
      return `$${cost.toFixed(6)}`;
    }
    return '$0.00';
  }

  /**
   * 格式化token明细显示
   */
  formatBreakdown(
    usage: TokenUsage,
    model?: string,
    options: {
      compact?: boolean;
      includeCost?: boolean;
      includeEfficiency?: boolean
    } = {}
  ): string {
    const breakdown = this.calculateBreakdown(usage, model);

    if (options.compact) {
      const parts: string[] = [];

      if (breakdown.input > 0) parts.push(`${this.formatCount(breakdown.input)} in`);
      if (breakdown.output > 0) parts.push(`${this.formatCount(breakdown.output)} out`);
      if (breakdown.cache_read > 0) parts.push(`${this.formatCount(breakdown.cache_read)} read`);

      let result = parts.join(', ');

      if (options.includeCost && breakdown.cost.total_cost > 0) {
        result += ` • ${this.formatCost(breakdown.cost.total_cost)}`;
      }

      if (options.includeEfficiency && breakdown.efficiency.cache_hit_rate > 0) {
        result += ` (${breakdown.efficiency.cache_hit_rate.toFixed(1)}% cached)`;
      }

      return result || `${this.formatCount(breakdown.total)} tokens`;
    }

    return `${this.formatCount(breakdown.total)} tokens`;
  }

  /**
   * 创建详细的工具提示内容
   */
  createTooltip(usage: TokenUsage, model?: string): string {
    const breakdown = this.calculateBreakdown(usage, model);
    const normalizedModel = this.normalizeModel(model);
    const pricing = CLAUDE_PRICING[normalizedModel as keyof typeof CLAUDE_PRICING];

    const lines: string[] = [];

    lines.push(`模型: ${normalizedModel}`);
    lines.push(`总Token: ${breakdown.total.toLocaleString()}`);
    lines.push('');

    // Token明细
    if (breakdown.input > 0) {
      lines.push(`输入Token: ${breakdown.input.toLocaleString()}`);
    }
    if (breakdown.output > 0) {
      lines.push(`输出Token: ${breakdown.output.toLocaleString()}`);
    }
    if (breakdown.cache_write > 0) {
      lines.push(`缓存写入: ${breakdown.cache_write.toLocaleString()}`);
    }
    if (breakdown.cache_read > 0) {
      lines.push(`缓存读取: ${breakdown.cache_read.toLocaleString()}`);
    }

    // 成本明细
    if (breakdown.cost.total_cost > 0) {
      lines.push('');
      lines.push(`总成本: ${this.formatCost(breakdown.cost.total_cost)}`);

      if (breakdown.cost.input_cost > 0) {
        lines.push(`输入成本: ${this.formatCost(breakdown.cost.input_cost)}`);
      }
      if (breakdown.cost.output_cost > 0) {
        lines.push(`输出成本: ${this.formatCost(breakdown.cost.output_cost)}`);
      }
      if (breakdown.cost.cache_write_cost > 0) {
        lines.push(`缓存写入成本: ${this.formatCost(breakdown.cost.cache_write_cost)}`);
      }
      if (breakdown.cost.cache_read_cost > 0) {
        lines.push(`缓存读取成本: ${this.formatCost(breakdown.cost.cache_read_cost)}`);
      }
    }

    // 效率指标
    if (breakdown.efficiency.cache_hit_rate > 0) {
      lines.push('');
      lines.push(`缓存命中率: ${breakdown.efficiency.cache_hit_rate.toFixed(1)}%`);
      if (breakdown.efficiency.cost_savings > 0) {
        lines.push(`成本节约: ${this.formatCost(breakdown.efficiency.cost_savings)}`);
      }
    }

    // 定价信息
    if (pricing) {
      lines.push('');
      lines.push('定价 (每百万token):');
      lines.push(`输入: $${pricing.input}`);
      lines.push(`输出: $${pricing.output}`);
      lines.push(`缓存写入: $${pricing.cache_write}`);
      lines.push(`缓存读取: $${pricing.cache_read}`);
    }

    return lines.join('\n');
  }

  /**
   * 获取支持的模型列表
   */
  getSupportedModels(): string[] {
    return Object.keys(CLAUDE_PRICING);
  }

  /**
   * 聚合多个token使用数据
   */
  aggregateUsage(usages: TokenUsage[]): TokenUsage {
    return usages.reduce(
      (total, usage) => {
        const normalized = this.normalizeUsage(usage);
        return {
          input_tokens: (total.input_tokens || 0) + (normalized.input_tokens || 0),
          output_tokens: (total.output_tokens || 0) + (normalized.output_tokens || 0),
          cache_creation_tokens: (total.cache_creation_tokens || 0) + (normalized.cache_creation_tokens || 0),
          cache_read_tokens: (total.cache_read_tokens || 0) + (normalized.cache_read_tokens || 0),
          cache_creation_input_tokens: (total.cache_creation_input_tokens || 0) + (normalized.cache_creation_input_tokens || 0),
          cache_read_input_tokens: (total.cache_read_input_tokens || 0) + (normalized.cache_read_input_tokens || 0),
        };
      },
      { input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
    );
  }

  /**
   * 检查API是否可用
   */
  isApiAvailable(): boolean {
    return this.client !== null;
  }
}

/**
 * Session-level token statistics
 */
export interface SessionTokenStats {
  total_tokens: number;
  total_cost: number;
  message_count: number;
  average_tokens_per_message: number;
  cache_efficiency: number;
  breakdown: TokenBreakdown;
  trend: {
    tokens_per_hour: number;
    cost_per_hour: number;
    peak_usage_time?: string;
  };
}

// 导出单例实例
export const tokenCounter = new TokenCounterService();

// 便利函数导出
export const countTokens = (messages: ClaudeMessage[], model?: string, tools?: ClaudeTool[], systemPrompt?: string) =>
  tokenCounter.countTokens(messages, model, tools, systemPrompt);

export const calculateCost = (usage: TokenUsage, model?: string) =>
  tokenCounter.calculateCost(usage, model);

/**
 * 向后兼容的函数保留
 * Normalize usage data from different API response formats
 */
export function normalizeTokenUsage(usage: any): TokenUsage {
  return tokenCounter.normalizeUsage(usage);
}

/**
 * 向后兼容的函数保留
 * Get model pricing configuration
 */
export function getModelPricing(model?: string) {
  const normalizedModel = tokenCounter.normalizeModel(model);
  return CLAUDE_PRICING[normalizedModel as keyof typeof CLAUDE_PRICING] || CLAUDE_PRICING.default;
}

/**
 * Calculate detailed token breakdown with cost analysis
 */
export function calculateTokenBreakdown(
  usage: TokenUsage,
  model?: string
): TokenBreakdown {
  return tokenCounter.calculateBreakdown(usage, model);
}

/**
 * Format token count for display with appropriate units
 */
export function formatTokenCount(tokens: number): string {
  return tokenCounter.formatCount(tokens);
}

/**
 * Format cost for display with appropriate precision
 */
export function formatCost(cost: number): string {
  return tokenCounter.formatCost(cost);
}

/**
 * Create a detailed usage summary string
 */
export function formatUsageBreakdown(
  usage: TokenUsage,
  model?: string,
  options: {
    includeTotal?: boolean;
    includeCost?: boolean;
    includeEfficiency?: boolean;
    compact?: boolean;
  } = {}
): string {
  return tokenCounter.formatBreakdown(usage, model, {
    compact: options.compact,
    includeCost: options.includeCost,
    includeEfficiency: options.includeEfficiency
  });
}

/**
 * Create a detailed tooltip with comprehensive token information
 */
export function createTokenTooltip(
  usage: TokenUsage,
  model?: string
): string {
  return tokenCounter.createTooltip(usage, model);
}

/**
 * Aggregate tokens from multiple messages (e.g., for session totals)
 */
export function aggregateTokenUsage(usages: TokenUsage[]): TokenUsage {
  return usages.reduce(
    (total, usage) => {
      const normalized = normalizeTokenUsage(usage);
      return {
        input_tokens: (total.input_tokens || 0) + (normalized.input_tokens || 0),
        output_tokens: (total.output_tokens || 0) + (normalized.output_tokens || 0),
        cache_creation_tokens: (total.cache_creation_tokens || 0) + (normalized.cache_creation_tokens || 0),
        cache_read_tokens: (total.cache_read_tokens || 0) + (normalized.cache_read_tokens || 0),
      };
    },
    { input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0 }
  );
}

/**
 * Calculate session-level statistics with trends
 */
export function calculateSessionStats(
  messages: Array<{ usage?: any; timestamp?: string; receivedAt?: string }>,
  model?: string
): SessionTokenStats {
  // Extract valid usage data from messages
  const usages = messages
    .filter(msg => msg.usage)
    .map(msg => normalizeTokenUsage(msg.usage));

  if (usages.length === 0) {
    return {
      total_tokens: 0,
      total_cost: 0,
      message_count: messages.length,
      average_tokens_per_message: 0,
      cache_efficiency: 0,
      breakdown: calculateTokenBreakdown({ input_tokens: 0, output_tokens: 0 }, model),
      trend: {
        tokens_per_hour: 0,
        cost_per_hour: 0,
      }
    };
  }

  const aggregated = aggregateTokenUsage(usages);
  const breakdown = calculateTokenBreakdown(aggregated, model);

  // Calculate time-based trends
  const timestampedMessages = messages.filter(msg => msg.timestamp || msg.receivedAt);
  let tokensPerHour = 0;
  let costPerHour = 0;
  let peakUsageTime: string | undefined;

  if (timestampedMessages.length >= 2) {
    const firstTime = new Date(timestampedMessages[0].timestamp || timestampedMessages[0].receivedAt!);
    const lastTime = new Date(timestampedMessages[timestampedMessages.length - 1].timestamp || timestampedMessages[timestampedMessages.length - 1].receivedAt!);
    const hoursElapsed = (lastTime.getTime() - firstTime.getTime()) / (1000 * 60 * 60);

    if (hoursElapsed > 0) {
      tokensPerHour = breakdown.total / hoursElapsed;
      costPerHour = breakdown.cost.total_cost / hoursElapsed;
    }
  }

  return {
    total_tokens: breakdown.total,
    total_cost: breakdown.cost.total_cost,
    message_count: messages.length,
    average_tokens_per_message: breakdown.total / messages.length,
    cache_efficiency: breakdown.efficiency.cache_hit_rate,
    breakdown,
    trend: {
      tokens_per_hour: tokensPerHour,
      cost_per_hour: costPerHour,
      peak_usage_time: peakUsageTime,
    }
  };
}

/**
 * Get cached session token data from the API
 */
export async function getSessionCacheTokens(sessionId: string): Promise<{ cache_creation: number; cache_read: number }> {
  try {
    const cacheData = await api.getSessionCacheTokens(sessionId);
    return {
      cache_creation: cacheData.total_cache_creation_tokens,
      cache_read: cacheData.total_cache_read_tokens
    };
  } catch (error) {
    console.warn('Failed to fetch session cache tokens:', error);
    return { cache_creation: 0, cache_read: 0 };
  }
}

export default tokenCounter;
