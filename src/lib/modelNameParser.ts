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

  // Pattern: claude-{family}-{major}[-{minor}[...]]-{date}
  // The date is always 8 digits at the end
  const match = modelId.match(/^claude-(\w+)-([\d]+(?:-[\d]+)*)(?:-\d{8})?$/);
  if (!match) return null;

  const family = match[1]; // "sonnet", "opus", "haiku"
  const versionParts = match[2].split('-'); // ["4", "5"] or ["4"]
  const version = versionParts.join('.');

  const familyName = family.charAt(0).toUpperCase() + family.slice(1);
  return `Claude ${familyName} ${version}`;
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
        return parsed;
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
    const cached = getCachedModelNames();
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

  return modelId
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
}

// ─── Gemini Model Name Caching ─────────────────────────────────────────

/**
 * Get all cached Gemini model display names from localStorage.
 * Keys are model IDs (e.g., "gemini-3-flash-preview").
 * Values are display names (e.g., "Gemini 3 Flash Preview").
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
 * @param modelId - The model ID (e.g., "gemini-3-flash-preview")
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
 * @param modelId - The model ID from the Gemini stream (e.g., "gemini-3-flash-preview")
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
 * formatGeminiModelName("gemini-3-flash-preview")    // "Gemini 3 Flash Preview"
 * formatGeminiModelName("gemini-3-pro-preview")      // "Gemini 3 Pro Preview"
 * formatGeminiModelName("auto-gemini-3")             // "Auto Gemini 3"
 */
export function formatGeminiModelName(modelId: string): string {
  if (!modelId) return modelId;

  return modelId
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
}
