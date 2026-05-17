/**
 * 统一的 AI 模型定价模块
 * ⚠️ MUST MATCH: src-tauri/src/commands/usage.rs::ModelPricing
 *
 * Claude 定价：https://platform.claude.com/docs/en/about-claude/pricing
 * Codex 定价：https://platform.openai.com/docs/pricing (codex-mini-latest)
 * 价格单位：美元/百万 tokens
 * Last Updated: May 2026
 */

export interface ModelPricing {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

/**
 * 模型定价常量（每百万 tokens）
 * 来源：各厂商官方定价
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // ============================================================================
  // Claude Models (Anthropic)
  // ============================================================================

  // Claude 4.7/4.6 Series
  'claude-opus-4.7': {
    input: 5.0,
    output: 25.0,
    cacheWrite: 6.25,
    cacheRead: 0.50
  },
  'claude-opus-4.7-1m': {
    input: 5.0,
    output: 25.0,
    cacheWrite: 6.25,
    cacheRead: 0.50
  },
  'claude-opus-4-7': {
    input: 5.0,
    output: 25.0,
    cacheWrite: 6.25,
    cacheRead: 0.50
  },
  'claude-opus-4-7-1m': {
    input: 5.0,
    output: 25.0,
    cacheWrite: 6.25,
    cacheRead: 0.50
  },
  'claude-opus-4.6': {
    input: 5.0,
    output: 25.0,
    cacheWrite: 6.25,
    cacheRead: 0.50
  },
  'claude-opus-4.6-1m': {
    input: 5.0,
    output: 25.0,
    cacheWrite: 6.25,
    cacheRead: 0.50
  },
  // Claude Opus 4.7/4.6 Fast Mode (2.5x faster, higher cost)
  'claude-opus-4.7-fast': {
    input: 30.0,       // $30 / 1M input tokens (<200K context)
    output: 150.0,     // $150 / 1M output tokens
    cacheWrite: 37.5,
    cacheRead: 3.0
  },
  'claude-opus-4.6-fast': {
    input: 30.0,
    output: 150.0,
    cacheWrite: 37.5,
    cacheRead: 3.0
  },
  'claude-sonnet-4.6': {
    input: 3.0,
    output: 15.0,
    cacheWrite: 3.75,
    cacheRead: 0.30
  },
  'claude-sonnet-4.6-1m': {
    input: 3.0,
    output: 15.0,
    cacheWrite: 3.75,
    cacheRead: 0.30
  },

  // Claude 4.5 Series
  'claude-opus-4.5': {
    input: 5.0,
    output: 25.0,
    cacheWrite: 6.25,
    cacheRead: 0.50
  },
  'claude-sonnet-4.5': {
    input: 3.0,
    output: 15.0,
    cacheWrite: 3.75,
    cacheRead: 0.30
  },
  'claude-haiku-4.5': {
    input: 1.0,
    output: 5.0,
    cacheWrite: 1.25,
    cacheRead: 0.10
  },

  // Claude 4.1 Series
  'claude-opus-4.1': {
    input: 15.0,
    output: 75.0,
    cacheWrite: 18.75,
    cacheRead: 1.50
  },

  // ============================================================================
  // Codex Models (OpenAI)
  // Source: https://platform.openai.com/docs/pricing (2026-03 官方定价)
  // Note: Codex 使用 ChatGPT 订阅时按会话限制计费，API Key 用户按 token 计费
  // ============================================================================

  // GPT-5.5 - recommended Codex model
  'gpt-5.5': {
    input: 5.00,
    output: 30.00,
    cacheWrite: 0,
    cacheRead: 0.50
  },
  'gpt-5.5-fast': {
    input: 12.50,
    output: 75.00,
    cacheWrite: 0,
    cacheRead: 1.25
  },
  'gpt-5.5-pro': {
    input: 30.00,
    output: 180.00,
    cacheWrite: 0,
    cacheRead: 0
  },
  'gpt-5-pro': {
    input: 15.00,
    output: 120.00,
    cacheWrite: 0,
    cacheRead: 0
  },
  // GPT-5.4 - previous flagship
  // Context: 1.05M tokens, Max Output: 128K tokens, 原生计算机使用
  'gpt-5.4': {
    input: 2.50,      // $2.50 / 1M input tokens (<=272K)
    output: 15.00,    // $15.00 / 1M output tokens
    cacheWrite: 0,    // OpenAI cache write 免费
    cacheRead: 0.25   // $0.25 cached input (via OpenRouter: $0.625)
  },
  // GPT-5.4 Fast Mode - 1.5x 加速，积分消耗 2x（仅限 ChatGPT 订阅用户）
  'gpt-5.4-fast': {
    input: 5.00,      // 标准价 x2
    output: 30.00,    // 标准价 x2
    cacheWrite: 0,
    cacheRead: 0.50
  },
  // GPT-5.4 Pro - 高计算版本
  'gpt-5.4-pro': {
    input: 30.00,     // $30.00 / 1M input tokens
    output: 180.00,   // $180.00 / 1M output tokens
    cacheWrite: 0,
    cacheRead: 3.00
  },
  'gpt-5.4-mini': {
    input: 0.75,
    output: 4.50,
    cacheWrite: 0,
    cacheRead: 0.075
  },
  'gpt-5.4-nano': {
    input: 0.20,
    output: 1.25,
    cacheWrite: 0,
    cacheRead: 0.02
  },

  // GPT-5.3-Codex 系列 - 专用代码模型（2026年2月5日发布）
  // Context: 400K tokens, Max Output: 128K tokens, 25% faster than GPT-5.2-Codex
  'gpt-5.3-codex': {
    input: 2.00,      // $2.00 / 1M input tokens
    output: 16.00,    // $16.00 / 1M output tokens
    cacheWrite: 0,    // OpenAI cache write 免费
    cacheRead: 0.20   // $0.20 cached input
  },
  // GPT-5.3-Codex-Spark - 轻量快速版（Cerebras WSE-3 芯片加速）
  'gpt-5.3-codex-spark': {
    input: 1.50,      // $1.50 / 1M input tokens
    output: 12.00,    // $12.00 / 1M output tokens
    cacheWrite: 0,
    cacheRead: 0.15
  },

  // GPT-5.2 系列
  'gpt-5.2-codex': {
    input: 1.75,
    output: 14.00,
    cacheWrite: 0,
    cacheRead: 0.175
  },
  // GPT-5.2 variants
  'gpt-5.2': {
    input: 1.75,
    output: 14.00,
    cacheWrite: 0,
    cacheRead: 0.175
  },

  // GPT-5.1-Codex 系列
  'gpt-5.1-codex': {
    input: 1.25,
    output: 10.00,
    cacheWrite: 0,
    cacheRead: 0.125
  },
  'gpt-5.1-codex-mini': {
    input: 0.25,
    output: 2.00,
    cacheWrite: 0,
    cacheRead: 0.025
  },
  'gpt-5.1-codex-max': {
    input: 1.25,
    output: 10.00,
    cacheWrite: 0,
    cacheRead: 0.125
  },
  // codex-mini-latest - 默认 Codex CLI 模型
  'codex-mini-latest': {
    input: 1.50,
    output: 6.00,
    cacheWrite: 0,
    cacheRead: 0.375
  },
  'gpt-5-codex': {
    input: 1.25,
    output: 10.00,
    cacheWrite: 0,
    cacheRead: 0.125
  },

  // o4-mini (Codex 底层模型之一)
  // Source: https://platform.openai.com/docs/pricing
  'o4-mini': {
    input: 1.10,      // $1.10 / 1M input tokens (Standard tier)
    output: 4.40,     // $4.40 / 1M output tokens
    cacheWrite: 0,    // OpenAI cache write 免费
    cacheRead: 0.275  // 官方: $0.275 cached input
  },

  // ============================================================================
  // Gemini Models (Google)
  // Source: https://ai.google.dev/gemini-api/docs/pricing (Last updated 2026-02 UTC)
  // ============================================================================

  // Gemini 3.1 Pro Preview (Latest - February 2026)
  'gemini-3.1-pro-preview': {
    input: 2.50,
    output: 15.00,
    cacheWrite: 0.0,
    cacheRead: 0.25
  },

  // Gemini 3 Pro Preview
  'gemini-3-pro-preview': {
    input: 2.00,
    output: 12.00,
    cacheWrite: 0.0,
    cacheRead: 0.20
  },

  // Gemini 3 Flash Preview
  'gemini-3-flash-preview': {
    input: 0.50,
    output: 3.00,
    cacheWrite: 0.0,
    cacheRead: 0.05
  },

  // Gemini 2.5 Pro (tiered pricing; here is the <=200k tier)
  'gemini-2.5-pro': {
    input: 1.25,
    output: 10.00,
    cacheWrite: 0.0,
    cacheRead: 0.125
  },

  // Gemini 2.5 Flash
  'gemini-2.5-flash': {
    input: 0.30,
    output: 2.50,
    cacheWrite: 0.0,
    cacheRead: 0.03
  },

  // Gemini 2.5 Flash-Lite
  'gemini-2.5-flash-lite': {
    input: 0.10,
    output: 0.40,
    cacheWrite: 0.0,
    cacheRead: 0.01
  },

  // Gemini 2.0 Flash (treat -exp variants as the same family)
  'gemini-2.0-flash': {
    input: 0.10,
    output: 0.40,
    cacheWrite: 0.0,
    cacheRead: 0.025
  },

  // ============================================================================
  // Default fallback (use latest Sonnet 4.5 pricing)
  // ============================================================================
  'default': {
    input: 3.0,
    output: 15.0,
    cacheWrite: 3.75,
    cacheRead: 0.30
  }
};

/**
 * 根据模型名称获取定价
 * ⚠️ MUST MATCH: Backend logic in usage.rs::parse_model_family
 *
 * @param model - 模型名称或标识符
 * @param engine - 引擎类型（claude/codex/gemini）
 * @returns 模型定价对象
 */
export function getPricingForModel(model?: string, engine?: string): ModelPricing {
  if (!model) {
    // 根据引擎选择默认定价
    if (engine === 'codex') {
      return MODEL_PRICING['codex-mini-latest'];
    }
    if (engine === 'gemini') {
      return MODEL_PRICING['gemini-2.5-pro'];
    }
    return MODEL_PRICING['default'];
  }

  // Normalize: lowercase + remove common prefixes/suffixes
  let normalized = model.toLowerCase();
  normalized = normalized.replace('anthropic.', '');
  normalized = normalized.replace('openai.', '');
  normalized = normalized.replace('-v1:0', '');

  // Handle @ symbol for Vertex AI format
  const atIndex = normalized.indexOf('@');
  if (atIndex !== -1) {
    normalized = normalized.substring(0, atIndex);
  }

  // ============================================================================
  // Gemini Models (Google)
  // ============================================================================

  if (normalized.includes('gemini')) {
    if (normalized.includes('gemini-3.1-pro') || normalized.includes('gemini_3_1_pro') || normalized.includes('3.1-pro')) {
      return MODEL_PRICING['gemini-3.1-pro-preview'];
    }
    if (normalized.includes('auto-gemini-3')) {
      return MODEL_PRICING['gemini-3-pro-preview'];
    }
    if (normalized.includes('gemini-3-pro') || normalized.includes('gemini_3_pro')) {
      return MODEL_PRICING['gemini-3-pro-preview'];
    }
    if (normalized === 'flash' || normalized.includes('gemini-3-flash') || normalized.includes('gemini_3_flash')) {
      return MODEL_PRICING['gemini-3-flash-preview'];
    }
    if (normalized === 'flash-lite') {
      return MODEL_PRICING['gemini-2.5-flash-lite'];
    }
    if (normalized.includes('2.5-pro') || normalized.includes('2_5_pro')) {
      return MODEL_PRICING['gemini-2.5-pro'];
    }
    if (normalized.includes('2.5-flash-lite') || normalized.includes('2_5_flash_lite')) {
      return MODEL_PRICING['gemini-2.5-flash-lite'];
    }
    if (normalized.includes('2.5-flash') || normalized.includes('2_5_flash')) {
      return MODEL_PRICING['gemini-2.5-flash'];
    }
    if (normalized.includes('2.0-flash') || normalized.includes('2_0_flash')) {
      return MODEL_PRICING['gemini-2.0-flash'];
    }

    // Unknown Gemini model - default to Gemini 2.5 Pro
    return MODEL_PRICING['gemini-2.5-pro'];
  }

  // ============================================================================
  // Codex Models (OpenAI)
  // ============================================================================

  // GPT-5.5 / GPT-5 Pro 系列
  if (normalized.includes('5.5') && normalized.includes('fast')) {
    return MODEL_PRICING['gpt-5.5-fast'];
  }
  if (normalized.includes('5.5-pro') || normalized.includes('5_5_pro')) {
    return MODEL_PRICING['gpt-5.5-pro'];
  }
  if (normalized.includes('gpt-5-pro') || normalized.includes('gpt_5_pro')) {
    return MODEL_PRICING['gpt-5-pro'];
  }
  if (normalized.includes('gpt-5.5') || normalized.includes('gpt5.5') || normalized.includes('gpt_5_5')) {
    return MODEL_PRICING['gpt-5.5'];
  }

  // GPT-5.4 系列
  if (normalized.includes('5.4-pro') || normalized.includes('5_4_pro')) {
    return MODEL_PRICING['gpt-5.4-pro'];
  }
  if (normalized.includes('5.4-mini') || normalized.includes('5_4_mini')) {
    return MODEL_PRICING['gpt-5.4-mini'];
  }
  if (normalized.includes('5.4-nano') || normalized.includes('5_4_nano')) {
    return MODEL_PRICING['gpt-5.4-nano'];
  }
  if (normalized.includes('5.4') && normalized.includes('fast')) {
    return MODEL_PRICING['gpt-5.4-fast'];
  }
  if (normalized.includes('gpt-5.4') || normalized.includes('gpt5.4') || normalized.includes('gpt_5_4')) {
    return MODEL_PRICING['gpt-5.4'];
  }

  // GPT-5.3-Codex 系列
  if (normalized.includes('5.3-codex-spark') || normalized.includes('5_3_codex_spark')) {
    return MODEL_PRICING['gpt-5.3-codex-spark'];
  }
  if (normalized.includes('5.3-codex') || normalized.includes('5_3_codex')) {
    return MODEL_PRICING['gpt-5.3-codex'];
  }
  if (normalized.includes('gpt-5.3') || normalized.includes('gpt5.3') || normalized.includes('gpt_5_3')) {
    return MODEL_PRICING['gpt-5.3-codex'];
  }

  // GPT-5.2 系列
  if (normalized.includes('5.2-codex') || normalized.includes('5_2_codex')) {
    return MODEL_PRICING['gpt-5.2-codex'];
  }
  if (normalized.includes('gpt-5.2') || normalized.includes('gpt_5_2') || normalized.includes('5.2')) {
    return MODEL_PRICING['gpt-5.2'];
  }

  // GPT-5.1-Codex 系列
  if (normalized.includes('5.1-codex-max') || normalized.includes('5_1_codex_max')) {
    return MODEL_PRICING['gpt-5.1-codex-max'];
  }
  if (normalized.includes('5.1-codex-mini') || normalized.includes('5_1_codex_mini')) {
    return MODEL_PRICING['gpt-5.1-codex-mini'];
  }
  if (normalized.includes('5.1-codex') || normalized.includes('5_1_codex')) {
    return MODEL_PRICING['gpt-5.1-codex'];
  }

  // o4-mini (Codex 底层模型)
  if (normalized.includes('o4-mini') || normalized.includes('o4_mini')) {
    return MODEL_PRICING['o4-mini'];
  }

  // codex-mini-latest - 默认 CLI 模型
  if (normalized.includes('codex-mini-latest') || normalized.includes('codex_mini_latest')) {
    return MODEL_PRICING['codex-mini-latest'];
  }

  // gpt-5-codex (别名)
  if (normalized.includes('gpt-5-codex') || normalized.includes('gpt_5_codex')) {
    return MODEL_PRICING['gpt-5-codex'];
  }

  // 通用 Codex 匹配 - 默认使用 gpt-5.5
  if (normalized.includes('codex')) {
    return MODEL_PRICING['gpt-5.5'];
  }

  // ============================================================================
  // Claude Models (Anthropic)
  // ============================================================================

  // Claude 4.7 Series
  if (normalized.includes('opus') && (normalized.includes('4.7') || normalized.includes('4-7'))) {
    if (normalized.includes('fast')) {
      return MODEL_PRICING['claude-opus-4.7-fast'];
    }
    return MODEL_PRICING['claude-opus-4.7'];
  }

  // Claude 4.6 Series
  if (normalized.includes('opus') && (normalized.includes('4.6') || normalized.includes('4-6'))) {
    if (normalized.includes('fast')) {
      return MODEL_PRICING['claude-opus-4.6-fast'];
    }
    return MODEL_PRICING['claude-opus-4.6'];
  }
  if (normalized.includes('sonnet') && (normalized.includes('4.6') || normalized.includes('4-6'))) {
    return MODEL_PRICING['claude-sonnet-4.6'];
  }

  // Claude 4.5 Series
  if (normalized.includes('opus') && (normalized.includes('4.5') || normalized.includes('4-5'))) {
    return MODEL_PRICING['claude-opus-4.5'];
  }
  if (normalized.includes('haiku') && (normalized.includes('4.5') || normalized.includes('4-5'))) {
    return MODEL_PRICING['claude-haiku-4.5'];
  }
  if (normalized.includes('sonnet') && (normalized.includes('4.5') || normalized.includes('4-5'))) {
    return MODEL_PRICING['claude-sonnet-4.5'];
  }

  // Claude 4.1 Series
  if (normalized.includes('opus') && (normalized.includes('4.1') || normalized.includes('4-1'))) {
    return MODEL_PRICING['claude-opus-4.1'];
  }

  // Generic family detection (fallback - MUST match backend)
  if (normalized.includes('haiku')) {
    return MODEL_PRICING['claude-haiku-4.5']; // Default to latest
  }
  if (normalized.includes('opus')) {
    return MODEL_PRICING['claude-opus-4.7']; // Default to latest
  }
  if (normalized.includes('sonnet')) {
    return MODEL_PRICING['claude-sonnet-4.6']; // Default to latest
  }

  // Codex 引擎使用 GPT-5.5 默认定价
  if (engine === 'codex') {
    return MODEL_PRICING['gpt-5.5'];
  }

  // Gemini 引擎使用 Gemini 默认定价
  if (engine === 'gemini') {
    return MODEL_PRICING['gemini-3-pro-preview'];
  }

  // Unknown model - use default
  console.warn(`[pricing] Unknown model: '${model}'. Using default pricing.`);
  return MODEL_PRICING['default'];
}

function getGeminiTieredPricing(model: string, promptTokens: number): ModelPricing {
  const lower = model.toLowerCase();
  const isOver200k = promptTokens > 200_000;

  // Gemini 3.1 Pro Preview (Latest)
  if (lower.includes('gemini-3.1-pro') || lower.includes('gemini_3_1_pro') || lower.includes('3.1-pro')) {
    return {
      input: isOver200k ? 5.00 : 2.50,
      output: isOver200k ? 22.50 : 15.00,
      cacheWrite: 0.0,
      cacheRead: isOver200k ? 0.50 : 0.25,
    };
  }

  // Gemini 3 Pro Preview
  if (lower.includes('gemini-3-pro') || lower.includes('gemini_3_pro')) {
    return {
      input: isOver200k ? 4.00 : 2.00,
      output: isOver200k ? 18.00 : 12.00,
      cacheWrite: 0.0,
      cacheRead: isOver200k ? 0.40 : 0.20,
    };
  }

  if (lower.includes('auto-gemini-3') || lower === 'auto' || lower === 'pro') {
    return getGeminiTieredPricing('gemini-3-pro-preview', promptTokens);
  }

  if (lower === 'flash' || lower.includes('gemini-3-flash') || lower.includes('gemini_3_flash')) {
    return MODEL_PRICING['gemini-3-flash-preview'];
  }

  // Gemini 2.5 Pro
  if (lower.includes('2.5-pro') || lower.includes('2_5_pro')) {
    return {
      input: isOver200k ? 2.50 : 1.25,
      output: isOver200k ? 15.00 : 10.00,
      cacheWrite: 0.0,
      cacheRead: isOver200k ? 0.25 : 0.125,
    };
  }

  // Non-tiered Gemini models use the standard pricing table
  return getPricingForModel(model, 'gemini');
}

/**
 * 计算单个消息的成本
 * @param tokens - token 使用统计
 * @param model - 模型名称
 * @param engine - 引擎类型（claude/codex/gemini）
 * @returns 成本（美元）
 */
export function calculateMessageCost(
  tokens: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_tokens: number;
    cache_read_tokens: number;
  },
  model?: string,
  engine?: string
): number {
  const resolvedModel = model || (engine === 'gemini' ? 'auto-gemini-3' : undefined);

  // Gemini: tiered pricing depends on prompt length (<=200k vs >200k)
  const pricing =
    engine === 'gemini' && resolvedModel
      ? getGeminiTieredPricing(
          resolvedModel,
          tokens.input_tokens + tokens.cache_creation_tokens + tokens.cache_read_tokens
        )
      : getPricingForModel(resolvedModel, engine);

  const inputCost = (tokens.input_tokens / 1_000_000) * pricing.input;
  const outputCost = (tokens.output_tokens / 1_000_000) * pricing.output;
  const cacheWriteCost = (tokens.cache_creation_tokens / 1_000_000) * pricing.cacheWrite;
  const cacheReadCost = (tokens.cache_read_tokens / 1_000_000) * pricing.cacheRead;

  return inputCost + outputCost + cacheWriteCost + cacheReadCost;
}

/**
 * 格式化成本显示
 * @param amount - 成本金额（美元）
 * @returns 格式化的字符串
 */
export function formatCost(amount: number): string {
  if (amount === 0) return '$0.00';
  if (amount < 0.01) {
    // 小于 1 美分时显示为美分
    const cents = amount * 100;
    return `$${cents.toFixed(3)}¢`;
  }
  return `$${amount.toFixed(4)}`;
}

/**
 * 格式化时长
 * @param seconds - 秒数
 * @returns 格式化的时长字符串（如 "6m 19s" 或 "6h 33m"）
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);

  if (minutes < 60) {
    return remainingSeconds > 0
      ? `${minutes}m ${remainingSeconds}s`
      : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return remainingMinutes > 0
    ? `${hours}h ${remainingMinutes}m`
    : `${hours}h`;
}
