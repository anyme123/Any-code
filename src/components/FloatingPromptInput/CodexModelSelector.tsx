import React from "react";
import { ChevronUp, Check, Star, Brain, Cpu, Rocket, Zap, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  getCachedCodexModelNames,
  CODEX_MODEL_NAMES_UPDATED_EVENT,
} from "@/lib/modelNameParser";

/**
 * Codex model configuration
 */
export interface CodexModelConfig {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  isDefault?: boolean;
}

/**
 * Default Codex models used as fallback when no cached data is available.
 * Intentionally kept as the known baseline; dynamically discovered models
 * from stream init messages will merge/override these.
 * Updated: March 2026
 */
const DEFAULT_CODEX_MODELS: CodexModelConfig[] = [
  {
    id: 'gpt-5.4',
    name: 'GPT-5.4',
    description: '最强旗舰模型，1M 上下文，支持 /fast（2026年3月）',
    icon: <Star className="h-4 w-4 text-purple-500" />,
    isDefault: true,
  },
  {
    id: 'gpt-5.3-codex',
    name: 'GPT-5.3 Codex',
    description: '专用代码模型，比 5.2 快 25%（2026年2月）',
    icon: <Rocket className="h-4 w-4 text-emerald-500" />,
    isDefault: false,
  },
  {
    id: 'gpt-5.3-codex-spark',
    name: 'GPT-5.3 Codex Spark',
    description: '轻量快速版，Cerebras WSE-3 芯片加速',
    icon: <Zap className="h-4 w-4 text-amber-500" />,
    isDefault: false,
  },
  {
    id: 'gpt-5.2-codex',
    name: 'GPT-5.2 Codex',
    description: '上一代代码模型（2025年12月）',
    icon: <Star className="h-4 w-4 text-yellow-500" />,
    isDefault: false,
  },
  {
    id: 'gpt-5.2',
    name: 'GPT 5.2',
    description: '上一代旗舰模型',
    icon: <Star className="h-4 w-4 text-yellow-500" />,
    isDefault: false,
  },
  {
    id: 'gpt-5.1-codex-max',
    name: 'GPT 5.1 Codex Max',
    description: 'Balanced speed and quality for code',
    icon: <Rocket className="h-4 w-4 text-green-500" />,
    isDefault: false,
  },
  {
    id: 'gpt-5.1-codex',
    name: 'GPT 5.1 Codex',
    description: 'Code generation baseline',
    icon: <Cpu className="h-4 w-4 text-blue-500" />,
    isDefault: false,
  },
  {
    id: 'gpt-5.1',
    name: 'GPT 5.1',
    description: 'General-purpose LLM',
    icon: <Brain className="h-4 w-4 text-orange-500" />,
    isDefault: false,
  },
  // ========== 2026-05 新增模型 ==========
  {
    id: 'gpt-5.5',
    name: 'GPT-5.5',
    description: 'Frontier reasoning，2026 年 4 月旗舰',
    icon: <Sparkles className="h-4 w-4 text-red-500" />,
    isDefault: false,
  },
  {
    id: 'gpt-5',
    name: 'GPT-5',
    description: '通用推理旗舰',
    icon: <Brain className="h-4 w-4 text-blue-500" />,
    isDefault: false,
  },
  {
    id: 'gpt-5-codex',
    name: 'GPT-5 Codex',
    description: '代码专用，2025-09 发布',
    icon: <Rocket className="h-4 w-4 text-emerald-500" />,
    isDefault: false,
  },
  {
    id: 'gpt-5-mini',
    name: 'GPT-5 Mini',
    description: '低延迟低成本',
    icon: <Zap className="h-4 w-4 text-amber-500" />,
    isDefault: false,
  },
  {
    id: 'gpt-5-nano',
    name: 'GPT-5 Nano',
    description: '超低成本',
    icon: <Cpu className="h-4 w-4 text-cyan-500" />,
    isDefault: false,
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI o3 推理模型',
    icon: <Brain className="h-4 w-4 text-purple-500" />,
    isDefault: false,
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'o4-mini 低成本推理',
    icon: <Brain className="h-4 w-4 text-purple-500" />,
    isDefault: false,
  },
];

/**
 * Icon assignment for dynamically discovered Codex models.
 * Falls back to a generic icon if no pattern matches.
 */
function getCodexModelIcon(modelId: string): React.ReactNode {
  const lower = modelId.toLowerCase();
  // GPT-5.5 旗舰
  if (lower.includes('5.5')) {
    return <Sparkles className="h-4 w-4 text-red-500" />;
  }
  if (lower.includes('5.4-pro')) {
    return <Star className="h-4 w-4 text-red-500" />;
  }
  if (lower.includes('5.4')) {
    return <Star className="h-4 w-4 text-purple-500" />;
  }
  if (lower.includes('codex') && lower.includes('max')) {
    return <Rocket className="h-4 w-4 text-green-500" />;
  }
  // GPT-5 系列轻量子型号（必须在 codex / gpt-5 通用匹配之前）
  if (lower.includes('nano')) {
    return <Cpu className="h-4 w-4 text-cyan-500" />;
  }
  if (lower.includes('mini') && lower.includes('5')) {
    return <Zap className="h-4 w-4 text-amber-500" />;
  }
  if (lower.includes('codex')) {
    return <Rocket className="h-4 w-4 text-emerald-500" />;
  }
  if (lower.includes('o3') || lower.includes('o4')) {
    return <Brain className="h-4 w-4 text-purple-500" />;
  }
  // 通用 GPT-5 (gpt-5 旗舰)
  if (lower.includes('gpt-5')) {
    return <Brain className="h-4 w-4 text-blue-500" />;
  }
  return <Cpu className="h-4 w-4 text-blue-500" />;
}

/**
 * Build the Codex model list by merging defaults with cached model names.
 * Cached entries update display names of known models and can add new ones.
 */
export function getCodexModels(): CodexModelConfig[] {
  const cached = getCachedCodexModelNames();
  const cachedIds = new Set(Object.keys(cached));

  // Start from defaults, updating display names from cache
  const models: CodexModelConfig[] = DEFAULT_CODEX_MODELS.map((model) => {
    if (cached[model.id]) {
      cachedIds.delete(model.id);
      return { ...model, name: cached[model.id] };
    }
    return model;
  });

  // Add any new models discovered from the stream that are not in defaults
  for (const modelId of cachedIds) {
    models.push({
      id: modelId,
      name: cached[modelId],
      description: 'Discovered from stream',
      icon: getCodexModelIcon(modelId),
      isDefault: false,
    });
  }

  return models;
}

/**
 * Static export for backward compatibility.
 * Prefer using getCodexModels() for dynamic names.
 */
export const CODEX_MODELS: CodexModelConfig[] = getCodexModels();

interface CodexModelSelectorProps {
  selectedModel: string | undefined;
  onModelChange: (model: string) => void;
  disabled?: boolean;
  availableModels?: CodexModelConfig[];
}

/**
 * CodexModelSelector component - Dropdown for selecting Codex model.
 * Supports dynamic model discovery via localStorage cache and custom events,
 * following the same pattern as Claude's ModelSelector.
 */
export const CodexModelSelector: React.FC<CodexModelSelectorProps> = ({
  selectedModel,
  onModelChange,
  disabled = false,
  availableModels: availableModelsProp,
}) => {
  const [open, setOpen] = React.useState(false);
  const [dynamicModels, setDynamicModels] = React.useState<CodexModelConfig[]>(() => getCodexModels());

  // Listen for Codex model name updates from stream init messages
  React.useEffect(() => {
    const handleUpdate = () => {
      setDynamicModels(getCodexModels());
    };

    window.addEventListener(CODEX_MODEL_NAMES_UPDATED_EVENT, handleUpdate);
    return () => {
      window.removeEventListener(CODEX_MODEL_NAMES_UPDATED_EVENT, handleUpdate);
    };
  }, []);

  // Allow prop override (same pattern as Claude's ModelSelector)
  const models = availableModelsProp || dynamicModels;

  // Find selected model or default
  const selectedModelData = models.find(m => m.id === selectedModel)
    || models.find(m => m.isDefault)
    || models[0];

  return (
    <Popover
      trigger={
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          className="h-8 gap-2 min-w-[160px] justify-start border-border/50 bg-background/50 hover:bg-accent/50"
        >
          {selectedModelData.icon}
          <span className="flex-1 text-left">{selectedModelData.name}</span>
          {selectedModelData.isDefault && (
            <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
          )}
          <ChevronUp className="h-4 w-4 opacity-50" />
        </Button>
      }
      content={
        <div className="w-[320px] p-1">
          <div className="px-3 py-2 text-xs text-muted-foreground border-b border-border/50 mb-1">
            Select Codex Model
          </div>
          {models.map((model) => {
            const isSelected = selectedModel === model.id ||
              (!selectedModel && model.isDefault);
            return (
              <button
                key={model.id}
                onClick={() => {
                  onModelChange(model.id);
                  setOpen(false);
                }}
                className={cn(
                  "w-full flex items-start gap-3 p-3 rounded-md transition-colors text-left group",
                  "hover:bg-accent",
                  isSelected && "bg-accent"
                )}
              >
                <div className="mt-0.5">{model.icon}</div>
                <div className="flex-1 space-y-1">
                  <div className="font-medium text-sm flex items-center gap-2">
                    {model.name}
                    {isSelected && (
                      <Check className="h-3.5 w-3.5 text-primary" />
                    )}
                    {model.isDefault && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                        Default
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {model.description}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      }
      open={open}
      onOpenChange={setOpen}
      align="start"
      side="top"
    />
  );
};
