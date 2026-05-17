/**
 * Codex 预设供应商配置模板
 * 移植自 cc-switch2 项目
 */

export type ProviderCategory =
  | "official"      // 官方
  | "cn_official"   // 国产官方
  | "aggregator"    // 聚合网站
  | "third_party"   // 第三方供应商
  | "custom";       // 自定义

export interface CodexProviderPreset {
  id: string;
  name: string;
  websiteUrl: string;
  // 第三方供应商可提供单独的获取 API Key 链接
  apiKeyUrl?: string;
  auth: Record<string, any>; // 将写入 ~/.codex/auth.json
  config: string; // 将写入 ~/.codex/config.toml（TOML 字符串）
  isOfficial?: boolean; // 标识是否为官方预设
  isPartner?: boolean; // 标识是否为商业合作伙伴
  partnerPromotionKey?: string; // 合作伙伴促销信息的 i18n key
  category?: ProviderCategory; // 分类
  isCustomTemplate?: boolean; // 标识是否为自定义模板
  // 请求地址候选列表（用于地址管理/测速）
  endpointCandidates?: string[];
  description?: string; // 描述
}

/**
 * 生成第三方供应商的 auth.json
 */
export function generateThirdPartyAuth(apiKey: string): Record<string, any> {
  return {
    OPENAI_API_KEY: apiKey || "",
  };
}

/**
 * 生成第三方供应商的 config.toml
 */
export function generateThirdPartyConfig(
  providerName: string,
  baseUrl: string,
  modelName = "gpt-5.5",
): string {
  // 清理供应商名称，确保符合TOML键名规范
  const cleanProviderName =
    providerName
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .replace(/^_+|_+$/g, "") || "custom";

  return `model_provider = "${cleanProviderName}"
model = "${modelName}"
model_reasoning_effort = "high"
plan_mode_reasoning_effort = "high"
model_verbosity = "medium"
disable_response_storage = true

[model_providers.${cleanProviderName}]
name = "${cleanProviderName}"
base_url = "${baseUrl}"
wire_api = "responses"
requires_openai_auth = true`;
}

/**
 * 从 config.toml 文本中提取 base_url
 */
export function extractBaseUrlFromConfig(configText: string): string {
  const match = configText.match(/base_url\s*=\s*"([^"]+)"/);
  return match ? match[1] : "";
}

/**
 * 从 config.toml 文本中提取 model
 */
export function extractModelFromConfig(configText: string): string {
  // 匹配顶层的 model = "xxx"，而不是 [model_providers.xxx] 下的
  const lines = configText.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('model =')) {
      const match = trimmed.match(/model\s*=\s*"([^"]+)"/);
      if (match) return match[1];
    }
  }
  return "gpt-5.5";
}

/**
 * 更新 config.toml 中的 base_url
 */
export function setBaseUrlInConfig(configText: string, newUrl: string): string {
  return configText.replace(
    /base_url\s*=\s*"[^"]*"/,
    `base_url = "${newUrl}"`
  );
}

/**
 * 更新 config.toml 中的 model
 */
export function setModelInConfig(configText: string, newModel: string): string {
  // 只更新顶层的 model = "xxx"
  const lines = configText.split('\n');
  let inModelProviders = false;
  const result = lines.map(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith('[model_providers')) {
      inModelProviders = true;
    } else if (trimmed.startsWith('[') && !trimmed.startsWith('[model_providers')) {
      inModelProviders = false;
    }
    if (!inModelProviders && trimmed.startsWith('model =')) {
      return `model = "${newModel}"`;
    }
    return line;
  });
  return result.join('\n');
}

/**
 * 从 auth.json 中提取 API Key
 */
export function extractApiKeyFromAuth(auth: Record<string, any>): string {
  return auth.OPENAI_API_KEY || auth.OPENAI_KEY || auth.API_KEY || "";
}

/**
 * 预设供应商列表
 */
export const codexProviderPresets: CodexProviderPreset[] = [
  {
    id: "openai-official",
    name: "OpenAI Official",
    websiteUrl: "https://chatgpt.com/codex",
    isOfficial: true,
    category: "official",
    auth: {},
    config: ``,
    description: "provider.codexPresets.openaiOfficial",
  },
  {
    id: "azure-openai",
    name: "Azure OpenAI",
    websiteUrl: "https://learn.microsoft.com/azure/ai-services/openai/how-to/overview",
    category: "third_party",
    isOfficial: true,
    auth: generateThirdPartyAuth(""),
    config: `model_provider = "azure"
model = "gpt-5.5"
model_reasoning_effort = "high"
plan_mode_reasoning_effort = "high"
model_verbosity = "medium"
disable_response_storage = true

[model_providers.azure]
name = "Azure OpenAI"
base_url = "https://YOUR_RESOURCE_NAME.openai.azure.com/openai"
env_key = "OPENAI_API_KEY"
query_params = { "api-version" = "2025-04-01-preview" }
wire_api = "responses"
requires_openai_auth = true`,
    endpointCandidates: ["https://YOUR_RESOURCE_NAME.openai.azure.com/openai"],
    description: "provider.codexPresets.azureOpenai",
  },
  {
    id: "custom",
    name: "provider.codexPresets.customName",
    websiteUrl: "",
    category: "custom",
    isCustomTemplate: true,
    auth: generateThirdPartyAuth(""),
    config: generateThirdPartyConfig("custom", "https://your-api-endpoint.com/v1", "gpt-5.5"),
    description: "provider.codexPresets.customDesc",
  },
];

/**
 * 根据 ID 获取预设
 */
export function getPresetById(id: string): CodexProviderPreset | undefined {
  return codexProviderPresets.find(p => p.id === id);
}

/**
 * 根据分类获取预设列表
 */
export function getPresetsByCategory(category: ProviderCategory): CodexProviderPreset[] {
  return codexProviderPresets.filter(p => p.category === category);
}

/**
 * 获取分类翻译键
 */
export function getCategoryKey(category: ProviderCategory): string {
  const keys: Record<ProviderCategory, string> = {
    official: "provider.categoryOfficial",
    cn_official: "provider.categoryCnOfficial",
    aggregator: "provider.categoryAggregator",
    third_party: "provider.categoryThirdParty",
    custom: "provider.categoryCustom",
  };
  return keys[category] || category;
}
