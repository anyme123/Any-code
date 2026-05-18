/**
 * Model name parser and cache utility
 *
 * Parses Claude model IDs (e.g., "claude-sonnet-4-5-20250514") into
 * human-readable display names (e.g., "Claude Sonnet 4.5").
 *
 * Also supports caching model names for Codex and Gemini engines,
 * enabling dynamic model discovery across all providers.
 *
 * Caches parsed names in localStorage so the model selector can show
 * up-to-date display names without hardcoding version numbers.
 */

const CACHE_KEY = 'model_display_names';
const CODEX_CACHE_KEY = 'codex_model_display_names';
const GEMINI_CACHE_KEY = 'gemini_model_display_names';

/**
 * 各 family 的最低可接受版本号（防陈旧缓存）
 * - 历史会话的 init 消息会把更早版本（如 Sonnet 4.5）写进 localStorage
 *   并永久覆盖默认显示名；这里设最低门槛，低于此版本的缓存条目读取时直接丢弃
 * - 当 Anthropic 升级模型时，把这里的版本号往上提即可让旧缓存自动失效
 */
const MIN_FAMILY_VERSIONS: Record<string, number> = {
  sonnet: 4.6,
  opus: 4.7,
  haiku: 4.5,
};

/**
 * 从显示名（如 "Claude Sonnet 4.6"）提取数值版本号
 * 失败时返回 null
 */
function extractVersionFromDisplayName(displayName: string): number | null {
  const m = displayName.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return Number.isFinite(v) ? v : null;
}

/**
 * 判断显示名是否陈旧（低于该 family 的最低门槛）
 */
function isStaleDisplayName(family: string, displayName: string): boolean {
  const minVersion = MIN_FAMILY_VERSIONS[family.toLowerCase()];
  if (minVersion === undefined) return false;
  const version = extractVersionFromDisplayName(displayName);
  if (version === null) return false;
  return version < minVersion;
}

/**
 * 纯函数结果缓存：避免对相同 modelId 重复执行 split / regex / map
 * - 上限 256 条；溢出时按插入顺序淘汰最早的 64 条
 * - 仅模块内使用，不导出
 */
const PARSE_CACHE_LIMIT = 256;
const PARSE_CACHE_EVICT = 64;

const parseModelDisplayNameCache = new Map<string, string | null>();
const formatCodexModelNameCache = new Map<string, string>();
const formatGeminiModelNameCache = new Map<string, string>();

function evictIfNeeded<V>(cache: Map<string, V>): void {
  if (cache.size <= PARSE_CACHE_LIMIT) return;
  let i = 0;
  for (const key of cache.keys()) {
    cache.delete(key);
    if (++i >= PARSE_CACHE_EVICT) break;
  }
}

/**
 * Custom event name dispatched when model names are updated in cache.
 * Components can listen for this to refresh their model display names.
 */
export const MODEL_NAMES_UPDATED_EVENT = 'model-names-updated';

/**
 * Custom event dispatched when Codex model names are updated in cache.
 */
export const CODEX_MODEL_NAMES_UPDATED_EVENT = 'codex-model-names-updated';

/**
 * Custom event dispatched when Gemini model names are updated in cache.
 */
export const GEMINI_MODEL_NAMES_UPDATED_EVENT = 'gemini-model-names-updated';

/**
 * Parse a Claude model ID into a human-readable display name.
 *
 * @example
 * parseModelDisplayName("claude-sonnet-4-5-20250514")  // "Claude Sonnet 4.5"
 * parseModelDisplayName("claude-opus-4-6-20260101")    // "Claude Opus 4.6"
 * parseModelDisplayName("claude-sonnet-4-20250514")    // "Claude Sonnet 4"
 * parseModelDisplayName("claude-haiku-3-5-20241022")   // "Claude Haiku 3.5"
 */
export function parseModelDisplayName(modelId: string): string | null {
  if (!modelId || typeof modelId !== 'string') return null;

  // 命中缓存直接返回
  if (parseModelDisplayNameCache.has(modelId)) {
    return parseModelDisplayNameCache.get(modelId)!;
  }

  // Pattern: claude-{family}-{major}[-{minor}[...]]-{date}
  // The date is always 8 digits at the end
  const match = modelId.match(/^claude-(\w+)-([\d]+(?:-[\d]+)*)-\d{8}/);
  let result: string | null = null;
  if (match) {
    const family = match[1]; // "sonnet", "opus", "haiku"
    const versionParts = match[2].split('-'); // ["4", "5"] or ["4"]
    const version = versionParts.join('.');
    const familyName = family.charAt(0).toUpperCase() + family.slice(1);
    result = `Claude ${familyName} ${version}`;
  }

  parseModelDisplayNameCache.set(modelId, result);
  evictIfNeeded(parseModelDisplayNameCache);
  return result;
}

/**
 * Extract the model family from a full model ID.
 *
 * @example
 * extractModelFamily("claude-sonnet-4-5-20250514")  // "sonnet"
 * extractModelFamily("claude-opus-4-6-20260101")    // "opus"
 */
export function extractModelFamily(modelId: string): string | null {
  if (!modelId || typeof modelId !== 'string') return null;

  const match = modelId.match(/^claude-(\w+)-/);
  return match ? match[1] : null;
}

/**
 * Get all cached model display names from localStorage.
 * Keys are model family names ("sonnet", "opus", etc.).
 * Values are display names ("Claude Sonnet 4.5", etc.).
 */
export function getCachedModelNames(): Record<string, string> {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed && typeof parsed === 'object') {
        // 🔧 过滤陈旧条目：低于 MIN_FAMILY_VERSIONS 的缓存视为失效
        // 例：升级到 Sonnet 4.6 后，旧的 "Claude Sonnet 4.5" 自动让位给默认值
        let mutated = false;
        const filtered: Record<string, string> = {};
        for (const [family, displayName] of Object.entries(parsed)) {
          if (typeof displayName !== 'string') continue;
          if (isStaleDisplayName(family, displayName)) {
            mutated = true;
            continue;
          }
          filtered[family] = displayName;
        }
        // 顺手把陈旧条目从 localStorage 中清理掉，避免下次再读
        if (mutated) {
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(filtered));
          } catch {
            // 静默忽略写入失败
          }
        }
        return filtered;
      }
    }
  } catch {
    // Ignore parse errors
  }
  return {};
}

/**
 * Cache a model display name for a given family.
 * Dispatches a custom event to notify listening components.
 *
 * @param family - Model family ("sonnet", "opus", etc.)
 * @param displayName - Human-readable display name ("Claude Sonnet 4.5")
 */
export function cacheModelName(family: string, displayName: string): void {
  try {
    // 🔧 拒绝写入陈旧版本：浏览历史会话时，旧 init 消息（如 Sonnet 4.5）
    // 不应覆盖已升级到的新版本（如 Sonnet 4.6）
    if (isStaleDisplayName(family, displayName)) return;

    const cached = getCachedModelNames();

    // 若缓存已有更高版本，不让低版本覆盖
    const existing = cached[family];
    if (existing) {
      const existingVersion = extractVersionFromDisplayName(existing);
      const incomingVersion = extractVersionFromDisplayName(displayName);
      if (
        existingVersion !== null &&
        incomingVersion !== null &&
        incomingVersion < existingVersion
      ) {
        return;
      }
    }

    // Only update and notify if the name actually changed
    if (cached[family] === displayName) return;

    cached[family] = displayName;
    localStorage.setItem(CACHE_KEY, JSON.stringify(cached));

    // Notify components that model names have been updated
    window.dispatchEvent(new CustomEvent(MODEL_NAMES_UPDATED_EVENT, {
      detail: { family, displayName, allNames: cached }
    }));
  } catch {
    // Ignore localStorage errors
  }
}

/**
 * Process a stream message's model field and cache the parsed display name.
 * Call this when processing init messages from the Claude stream.
 *
 * @param modelId - The full model ID from the init message (e.g., "claude-sonnet-4-5-20250514")
 */
export function cacheModelFromInitMessage(modelId: string): void {
  if (!modelId) return;

  const displayName = parseModelDisplayName(modelId);
  const family = extractModelFamily(modelId);

  if (displayName && family) {
    cacheModelName(family, displayName);
  }
}

// ─── Codex Model Name Caching ──────────────────────────────────────────

/**
 * Get all cached Codex model display names from localStorage.
 * Keys are model IDs (e.g., "gpt-5.2-codex").
 * Values are display names (e.g., "GPT-5.2 Codex").
 */
export function getCachedCodexModelNames(): Record<string, string> {
  try {
    const cached = localStorage.getItem(CODEX_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    }
  } catch {
    // Ignore parse errors
  }
  return {};
}

/**
 * Cache a Codex model display name.
 * Dispatches a custom event to notify listening components.
 *
 * @param modelId - The model ID (e.g., "gpt-5.2-codex")
 * @param displayName - Human-readable display name (e.g., "GPT-5.2 Codex")
 */
export function cacheCodexModelName(modelId: string, displayName: string): void {
  try {
    const cached = getCachedCodexModelNames();
    // Only update and notify if the name actually changed
    if (cached[modelId] === displayName) return;

    cached[modelId] = displayName;
    localStorage.setItem(CODEX_CACHE_KEY, JSON.stringify(cached));

    // Notify components that Codex model names have been updated
    window.dispatchEvent(new CustomEvent(CODEX_MODEL_NAMES_UPDATED_EVENT, {
      detail: { modelId, displayName, allNames: cached }
    }));
  } catch {
    // Ignore localStorage errors
  }
}

/**
 * Process a Codex stream message's model field and cache it.
 * For Codex, the model ID itself is used as both key and display name basis.
 *
 * @param modelId - The model ID from the Codex stream (e.g., "gpt-5.2-codex")
 */
export function cacheCodexModelFromStream(modelId: string): void {
  if (!modelId || typeof modelId !== 'string') return;

  // Use the raw model ID as the display name (Codex model IDs are already human-readable)
  // e.g., "gpt-5.2-codex" -> "GPT-5.2 Codex"
  const displayName = formatCodexModelName(modelId);
  cacheCodexModelName(modelId, displayName);
}

/**
 * Format a Codex model ID into a human-readable display name.
 *
 * @example
 * formatCodexModelName("gpt-5.2-codex")      // "GPT-5.2 Codex"
 * formatCodexModelName("gpt-5.1-codex-max")   // "GPT-5.1 Codex Max"
 * formatCodexModelName("o3-pro")              // "O3 Pro"
 */
export function formatCodexModelName(modelId: string): string {
  if (!modelId) return modelId;

  // 命中缓存直接返回
  const cached = formatCodexModelNameCache.get(modelId);
  if (cached !== undefined) return cached;

  const result = modelId
    .split('-')
    .map(part => {
      // Keep version numbers as-is (e.g., "5.2")
      if (/^\d/.test(part)) return part;
      // Uppercase known abbreviations
      if (part.toLowerCase() === 'gpt') return 'GPT';
      // Capitalize first letter of other parts
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ')
    // Clean up double spaces
    .replace(/\s+/g, ' ')
    .trim();

  formatCodexModelNameCache.set(modelId, result);
  evictIfNeeded(formatCodexModelNameCache);
  return result;
}

// ─── Gemini Model Name Caching ─────────────────────────────────────────

/**
 * Get all cached Gemini model display names from localStorage.
 * Keys are model IDs (e.g., "gemini-3-flash").
 * Values are display names (e.g., "Gemini 3 Flash").
 */
export function getCachedGeminiModelNames(): Record<string, string> {
  try {
    const cached = localStorage.getItem(GEMINI_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    }
  } catch {
    // Ignore parse errors
  }
  return {};
}

/**
 * Cache a Gemini model display name.
 * Dispatches a custom event to notify listening components.
 *
 * @param modelId - The model ID (e.g., "gemini-3-flash")
 * @param displayName - Human-readable display name (e.g., "Gemini 3 Flash")
 */
export function cacheGeminiModelName(modelId: string, displayName: string): void {
  try {
    const cached = getCachedGeminiModelNames();
    // Only update and notify if the name actually changed
    if (cached[modelId] === displayName) return;

    cached[modelId] = displayName;
    localStorage.setItem(GEMINI_CACHE_KEY, JSON.stringify(cached));

    // Notify components that Gemini model names have been updated
    window.dispatchEvent(new CustomEvent(GEMINI_MODEL_NAMES_UPDATED_EVENT, {
      detail: { modelId, displayName, allNames: cached }
    }));
  } catch {
    // Ignore localStorage errors
  }
}

/**
 * Process a Gemini stream message's model field and cache it.
 *
 * @param modelId - The model ID from the Gemini stream (e.g., "gemini-3-flash")
 */
export function cacheGeminiModelFromStream(modelId: string): void {
  if (!modelId || typeof modelId !== 'string') return;

  const displayName = formatGeminiModelName(modelId);
  cacheGeminiModelName(modelId, displayName);
}

/**
 * Format a Gemini model ID into a human-readable display name.
 *
 * @example
 * formatGeminiModelName("gemini-3-flash")            // "Gemini 3 Flash"
 * formatGeminiModelName("gemini-3-pro")              // "Gemini 3 Pro"
 * formatGeminiModelName("gemini-3-flash-thinking")   // "Gemini 3 Flash Thinking"
 * formatGeminiModelName("gemini-3-pro-preview")      // "Gemini 3 Pro Preview"
 */
export function formatGeminiModelName(modelId: string): string {
  if (!modelId) return modelId;

  // 命中缓存直接返回
  const cached = formatGeminiModelNameCache.get(modelId);
  if (cached !== undefined) return cached;

  const result = modelId
    .split('-')
    .map(part => {
      // Keep version numbers as-is
      if (/^\d/.test(part)) return part;
      // Capitalize first letter
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  formatGeminiModelNameCache.set(modelId, result);
  evictIfNeeded(formatGeminiModelNameCache);
  return result;
}
