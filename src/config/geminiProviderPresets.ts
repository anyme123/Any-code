/**
 * Gemini 预设供应商配置模板
 * 参考 cc-switch2 项目的实现
 */

export type ProviderCategory =
  | "official"      // 官方
  | "third_party"   // 第三方供应商
  | "custom";       // 自定义

/**
 * Gemini 供应商预设配置
 */
export interface GeminiProviderPreset {
  id: string;
  name: string;
  websiteUrl: string;
  apiKeyUrl?: string;
  // 环境变量配置，将写入 ~/.gemini/.env
  env: Record<string, string>;
  baseURL?: string;
  model?: string;
  description?: string;
  category?: ProviderCategory;
  isPartner?: boolean;
  partnerPromotionKey?: string;
  endpointCandidates?: string[];
  isCustomTemplate?: boolean;
}

/**
 * Gemini 供应商配置（用于 API 调用）
 */
export interface GeminiProviderConfig {
  id: string;
  name: string;
  description?: string;
  websiteUrl?: string;
  category?: ProviderCategory;
  env: Record<string, string>;  // 环境变量，写入 ~/.gemini/.env
  isOfficial?: boolean;
  isPartner?: boolean;
  createdAt?: number;
}

/**
 * 当前 Gemini 配置（从 ~/.gemini 目录读取）
 */
export interface CurrentGeminiConfig {
  env: Record<string, string>;  // ~/.gemini/.env 内容
  settings: Record<string, any>;  // ~/.gemini/settings.json 内容
  apiKey?: string;  // 从 env 中提取的 API Key
  baseUrl?: string;  // 从 env 中提取的 Base URL
  model?: string;  // 从 env 中提取的模型
  selectedAuthType?: string;  // 认证类型
}

/**
 * 生成第三方供应商的环境变量
 */
export function generateThirdPartyEnv(
  apiKey: string,
  baseUrl: string,
  model = "auto-gemini-3"
): Record<string, string> {
  return {
    GEMINI_API_KEY: apiKey || "",
    GOOGLE_GEMINI_BASE_URL: baseUrl || "",
    GEMINI_MODEL: model,
  };
}

/**
 * 从环境变量中提取 API Key
 */
export function extractApiKeyFromEnv(env: Record<string, string>): string {
  return env.GEMINI_API_KEY || env.GOOGLE_API_KEY || "";
}

/**
 * 从环境变量中提取 Base URL
 */
export function extractBaseUrlFromEnv(env: Record<string, string>): string {
  return env.GOOGLE_GEMINI_BASE_URL || "";
}

/**
 * 从环境变量中提取模型
 */
export function extractModelFromEnv(env: Record<string, string>): string {
  return env.GEMINI_MODEL || "auto-gemini-3";
}

/**
 * 预设供应商列表
 */
export const geminiProviderPresets: GeminiProviderPreset[] = [
  {
    id: "google-official",
    name: "Google Official",
    websiteUrl: "https://ai.google.dev/",
    apiKeyUrl: "https://aistudio.google.com/apikey",
    env: {},  // 官方使用 OAuth，无需环境变量
    description: "provider.geminiPresets.googleOfficial",
    category: "official",
    partnerPromotionKey: "google-official",
  },
  {
    id: "custom",
    name: "provider.geminiPresets.customName",
    websiteUrl: "",
    env: {
      GOOGLE_GEMINI_BASE_URL: "",
      GEMINI_MODEL: "auto-gemini-3",
    },
    model: "auto-gemini-3",
    description: "provider.geminiPresets.customDesc",
    category: "custom",
    isCustomTemplate: true,
  },
];

/**
 * 根据 ID 获取预设
 */
export function getPresetById(id: string): GeminiProviderPreset | undefined {
  return geminiProviderPresets.find(p => p.id === id);
}

/**
 * 根据分类获取预设列表
 */
export function getPresetsByCategory(category: ProviderCategory): GeminiProviderPreset[] {
  return geminiProviderPresets.filter(p => p.category === category);
}

/**
 * 获取分类翻译键
 */
export function getCategoryKey(category: ProviderCategory): string {
  const keys: Record<ProviderCategory, string> = {
    official: "provider.categoryOfficial",
    third_party: "provider.categoryThirdParty",
    custom: "provider.categoryCustom",
  };
  return keys[category] || category;
}

/**
 * 根据 Base URL 检测供应商
 */
export function detectProviderByBaseUrl(baseUrl: string): GeminiProviderPreset | undefined {
  if (!baseUrl) return undefined;
  return geminiProviderPresets.find(
    preset =>
      preset.baseURL &&
      baseUrl.toLowerCase().includes(preset.baseURL.toLowerCase())
  );
}

/**
 * 检查是否为官方供应商（使用 OAuth）
 */
export function isOfficialProvider(provider: GeminiProviderConfig): boolean {
  // 官方供应商没有 baseUrl 和 apiKey
  return provider.category === "official" ||
         (!provider.env.GOOGLE_GEMINI_BASE_URL && !provider.env.GEMINI_API_KEY);
}
