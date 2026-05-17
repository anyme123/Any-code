/**
 * 提示词优化服务
 * 支持多个第三方API提供商（OpenAI、Deepseek、通义千问等）
 *
 * ⚡ 使用统一的 LLMApiService 处理 API 调用
 */

import { LLMApiService, type LLMProvider } from '@/lib/services/llmApiService';


// 重新导出类型以保持向后兼容
export type PromptEnhancementProvider = LLMProvider;
export type { ApiFormat } from '@/lib/services/llmApiService';

// 重新导出 URL 规范化函数以保持向后兼容
export { detectApiFormat, normalizeApiUrl, normalizeOpenAIUrl, normalizeAnthropicUrl, normalizeGeminiUrl } from '@/lib/services/llmApiService';

/**
 * 预设提供商模板
 */
export const PRESET_PROVIDERS = {
  openai: {
    id: 'openai',
    name: 'OpenAI GPT-5.5',
    apiUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.5',
    apiFormat: 'openai' as const,
    enabled: false,
    apiKey: '',
  },
  deepseek: {
    id: 'deepseek',
    name: 'Deepseek Chat',
    apiUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    apiFormat: 'openai' as const,
    enabled: false,
    apiKey: '',
  },
  qwen: {
    id: 'qwen',
    name: '通义千问 Max',
    apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-max',
    apiFormat: 'openai' as const,
    enabled: false,
    apiKey: '',
  },
  siliconflow: {
    id: 'siliconflow',
    name: 'SiliconFlow Qwen',
    apiUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-72B-Instruct',
    apiFormat: 'openai' as const,
    enabled: false,
    apiKey: '',
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    apiUrl: 'https://generativelanguage.googleapis.com',
    model: 'gemini-2.5-flash',
    apiFormat: 'gemini' as const,
    enabled: false,
    apiKey: '',
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic Claude',
    apiUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-6',
    apiFormat: 'anthropic' as const,
    enabled: false,
    apiKey: '',
  },
};

export interface PromptEnhancementConfig {
  providers: LLMProvider[];
  lastUsedProviderId?: string;
}

const STORAGE_KEY = 'prompt_enhancement_providers';
const ENCRYPTION_KEY = 'prompt_enhancement_encryption_salt';

/**
 * 简单的XOR加密（前端基础保护，不是真正安全的加密）
 */
function simpleEncrypt(text: string, salt: string): string {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    result += String.fromCharCode(text.charCodeAt(i) ^ salt.charCodeAt(i % salt.length));
  }
  return btoa(result);
}

function simpleDecrypt(encrypted: string, salt: string): string {
  try {
    const decoded = atob(encrypted);
    let result = '';
    for (let i = 0; i < decoded.length; i++) {
      result += String.fromCharCode(decoded.charCodeAt(i) ^ salt.charCodeAt(i % salt.length));
    }
    return result;
  } catch {
    return '';
  }
}

/**
 * 获取或创建加密盐
 */
function getEncryptionSalt(): string {
  let salt = localStorage.getItem(ENCRYPTION_KEY);
  if (!salt) {
    salt = Math.random().toString(36).substring(2, 15);
    localStorage.setItem(ENCRYPTION_KEY, salt);
  }
  return salt;
}

/**
 * 加载配置
 */
export function loadConfig(): PromptEnhancementConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return { providers: [] };
    }
    
    const config = JSON.parse(stored) as PromptEnhancementConfig;
    const salt = getEncryptionSalt();
    
    // 解密API Key
    config.providers = config.providers.map(p => ({
      ...p,
      apiKey: simpleDecrypt(p.apiKey, salt),
    }));
    
    return config;
  } catch (error) {
    console.error('[PromptEnhancement] Failed to load config:', error);
    return { providers: [] };
  }
}

/**
 * 保存配置
 */
export function saveConfig(config: PromptEnhancementConfig): void {
  try {
    const salt = getEncryptionSalt();
    
    // 加密API Key后保存
    const encryptedConfig = {
      ...config,
      providers: config.providers.map(p => ({
        ...p,
        apiKey: simpleEncrypt(p.apiKey, salt),
      })),
    };
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(encryptedConfig));
  } catch (error) {
    console.error('[PromptEnhancement] Failed to save config:', error);
  }
}

/**
 * 调用提示词优化API（使用统一的 LLMApiService）
 */
export async function callEnhancementAPI(
  provider: PromptEnhancementProvider,
  prompt: string,
  context?: string[]
): Promise<string> {
  const systemPrompt = `你是一个专业的提示词优化助手，专门为 Claude Code 编程助手优化用户的提示词。

【优化目标】
1. 保持用户的原始意图和所有具体信息不变
2. 使提示词更清晰、更可执行、更结构化
3. 基于对话上下文补充必要的技术细节
4. 使用准确的技术术语，避免歧义

【优化原则】
- ✅ 保持技术性和实用性
- ✅ 只优化表达方式，不改变核心需求
- ✅ 如果用户的意图已经很明确，只需微调即可
- ✅ 必须完整保留所有文件路径（C:\\Users\\...、/home/...、~/...）原样不变
- ✅ 必须保留所有项目引用和对比目标及其路径信息
- ✅ 必须保留具体技术细节：URL、路径、版本号、文件名等
- ❌ 不要添加角色扮演（如"请你扮演..."）
- ❌ 不要添加过多的礼貌用语或客套话
- ❌ 不要改变用户的问题类型（如把技术问题改成分析报告）
- ❌ 不要添加用户没有要求的额外任务
- ❌ 不要删除或抽象化具体的路径、URL 或技术标识符

${context && context.length > 0 ? `\n【当前对话上下文】\n${context.join('\n')}\n` : ''}

【关键：信息保留规则】
当用户提供以下信息时，必须原样保留：
- 文件路径（如"路径为C:\\Users\\Admin\\project"）→ 必须保留 "C:\\Users\\Admin\\project"
- 项目引用（如"对比XX项目"）→ 必须保留项目名称和路径
- URL（如 https://...）→ 必须保持不变
- 版本号、配置值 → 必须保持不变

【示例】
❌ 错误示例：
  输入："优化登录功能 对比某某项目，路径为C:\\code\\app"
  输出："优化登录功能，参考其他项目的实现"  ← 路径信息丢失！

✅ 正确示例：
  输入："优化登录功能 对比某某项目，路径为C:\\code\\app"
  输出："优化当前项目的登录功能，参考 C:\\code\\app 项目的登录实现方式，对比两者的认证流程和安全措施，提供改进建议"

【输出要求】
直接返回优化后的提示词，不要添加任何解释、评论或元信息。`;

  const userPrompt = `请优化以下提示词：\n\n${prompt}`;
  try {
    // 使用统一的 LLM API 服务
    const response = await LLMApiService.call(provider, {
      systemPrompt,
      userPrompt,
    });

    return response.content;
  } catch (error) {
    console.error('[PromptEnhancement] API call failed:', error);
    throw error;
  }
}

/**
 * 测试API连接
 */
export async function testAPIConnection(provider: PromptEnhancementProvider): Promise<{
  success: boolean;
  message: string;
  latency?: number;
}> {
  const startTime = Date.now();
  
  try {
    const testPrompt = 'Hello';
    await callEnhancementAPI(provider, testPrompt);
    
    const latency = Date.now() - startTime;
    return {
      success: true,
      message: `连接成功！延迟: ${latency}ms`,
      latency,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : '连接失败',
    };
  }
}

/**
 * 获取所有启用的提供商
 */
export function getEnabledProviders(): PromptEnhancementProvider[] {
  const config = loadConfig();
  return config.providers.filter(p => p.enabled);
}

/**
 * 添加提供商
 */
export function addProvider(provider: PromptEnhancementProvider): void {
  const config = loadConfig();
  config.providers.push(provider);
  saveConfig(config);
}

/**
 * 更新提供商
 */
export function updateProvider(id: string, updates: Partial<PromptEnhancementProvider>): void {
  const config = loadConfig();
  const index = config.providers.findIndex(p => p.id === id);
  if (index >= 0) {
    config.providers[index] = { ...config.providers[index], ...updates };
    saveConfig(config);
  }
}

/**
 * 删除提供商
 */
export function deleteProvider(id: string): void {
  const config = loadConfig();
  config.providers = config.providers.filter(p => p.id !== id);
  saveConfig(config);
}

/**
 * 获取提供商
 */
export function getProvider(id: string): PromptEnhancementProvider | undefined {
  const config = loadConfig();
  return config.providers.find(p => p.id === id);
}

