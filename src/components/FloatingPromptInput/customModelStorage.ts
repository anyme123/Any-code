/**
 * Custom Model Storage
 *
 * 管理用户自定义的 Claude 模型列表（手动输入 + API 拉取）。
 * 全局多条，存 localStorage，支持增删改。
 */

const STORAGE_KEY = "claude_custom_models";

/**
 * 自定义模型列表变更事件名。
 * UI 组件订阅此事件以在增删改后实时刷新可选模型列表。
 */
export const CUSTOM_MODELS_UPDATED_EVENT = "custom_models_updated";

function emitChange() {
  try {
    window.dispatchEvent(new CustomEvent(CUSTOM_MODELS_UPDATED_EVENT));
  } catch {
    // SSR 或测试环境无 window，安全忽略
  }
}

export interface CustomModel {
  /** 内部 id，形如 "custom:claude-3-5-sonnet-20241022" */
  id: string;
  /** 模型显示名称 */
  name: string;
  /** 实际传给 CLI 的模型字符串（ANTHROPIC_MODEL） */
  modelId: string;
  /** 来源标识：手动输入 / API 拉取 */
  source: "manual" | "api";
  /** 添加时间戳 */
  addedAt: number;
}

/**
 * 获取所有自定义模型（按添加时间倒序）
 */
export function getCustomModels(): CustomModel[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list
      .filter((m: any): m is CustomModel =>
        m &&
        typeof m.id === "string" &&
        typeof m.name === "string" &&
        typeof m.modelId === "string"
      )
      .sort((a, b) => b.addedAt - a.addedAt);
  } catch (error) {
    console.warn("[customModelStorage] Failed to read custom models:", error);
    return [];
  }
}

/**
 * 添加一个自定义模型；如 modelId 已存在则更新名称。
 */
export function addCustomModel(input: {
  name: string;
  modelId: string;
  source: "manual" | "api";
}): CustomModel {
  const list = getCustomModels();
  const trimmedId = input.modelId.trim();
  const trimmedName = (input.name || trimmedId).trim();

  const existing = list.find((m) => m.modelId === trimmedId);
  if (existing) {
    existing.name = trimmedName;
    existing.source = input.source;
    saveAll(list);
    emitChange();
    return existing;
  }

  const created: CustomModel = {
    id: `custom:${trimmedId}`,
    name: trimmedName,
    modelId: trimmedId,
    source: input.source,
    addedAt: Date.now(),
  };
  saveAll([created, ...list]);
  emitChange();
  return created;
}

/**
 * 按 id 删除自定义模型
 */
export function removeCustomModel(id: string): void {
  const list = getCustomModels().filter((m) => m.id !== id);
  saveAll(list);
  emitChange();
}

/**
 * 清空全部自定义模型
 */
export function clearCustomModels(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    emitChange();
  } catch (error) {
    console.error("[customModelStorage] Failed to clear:", error);
  }
}

function saveAll(list: CustomModel[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (error) {
    console.error("[customModelStorage] Failed to save:", error);
  }
}

/**
 * 判断给定 model id 是否为自定义模型 id（"custom:xxx"）
 */
export function isCustomModelId(id: string): boolean {
  return id.startsWith("custom:");
}
