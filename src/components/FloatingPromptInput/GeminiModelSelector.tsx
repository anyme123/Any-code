import React from "react";
import { ChevronUp, Check, Star, Sparkles, Brain, FlaskConical, Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  getCachedGeminiModelNames,
  GEMINI_MODEL_NAMES_UPDATED_EVENT,
} from "@/lib/modelNameParser";

/**
 * Gemini model configuration
 */
export interface GeminiModelConfig {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  isDefault?: boolean;
}

/**
 * Default Gemini models used as fallback when no cached data is available.
 * Intentionally kept as the known baseline; dynamically discovered models
 * from stream init messages will merge/override these.
 * Updated: May 2026
 */
const DEFAULT_GEMINI_MODELS: GeminiModelConfig[] = [
  {
    id: 'auto-gemini-3',
    name: 'Auto (Gemini 3)',
    description: '推荐：在 Gemini 3 Pro/Flash Preview 间自动路由',
    icon: <Sparkles className="h-4 w-4 text-blue-500" />,
    isDefault: true,
  },
  {
    id: 'pro',
    name: 'Pro',
    description: 'Gemini CLI Pro alias for complex reasoning',
    icon: <Star className="h-4 w-4 text-amber-500" />,
    isDefault: false,
  },
  {
    id: 'flash',
    name: 'Flash',
    description: 'Gemini CLI Flash alias for fast everyday coding',
    icon: <Gauge className="h-4 w-4 text-yellow-500" />,
    isDefault: false,
  },
  {
    id: 'flash-lite',
    name: 'Flash-Lite',
    description: 'Gemini CLI Flash-Lite alias for lightweight tasks',
    icon: <Gauge className="h-4 w-4 text-cyan-500" />,
    isDefault: false,
  },
  {
    id: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro (Preview)',
    description: '旗舰预览模型，逐步开放中',
    icon: <Star className="h-4 w-4 text-amber-500" />,
    isDefault: false,
  },
  {
    id: 'gemini-3-pro-preview',
    name: 'Gemini 3 Pro (Preview)',
    description: 'Gemini 3 Pro preview for complex reasoning',
    icon: <FlaskConical className="h-4 w-4 text-purple-500" />,
    isDefault: false,
  },
  {
    id: 'gemini-3-flash-preview',
    name: 'Gemini 3 Flash (Preview)',
    description: 'Gemini 3 fast preview model',
    icon: <Gauge className="h-4 w-4 text-yellow-500" />,
    isDefault: false,
  },
  {
    id: 'auto-gemini-2.5',
    name: 'Auto (Gemini 2.5)',
    description: 'Stable auto routing between Gemini 2.5 Pro and Flash',
    icon: <Sparkles className="h-4 w-4 text-blue-500" />,
    isDefault: false,
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    description: 'Stable Pro model',
    icon: <Sparkles className="h-4 w-4 text-blue-500" />,
    isDefault: false,
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    description: 'Stable Flash model',
    icon: <Gauge className="h-4 w-4 text-yellow-500" />,
    isDefault: false,
  },
  {
    id: 'gemini-2.5-flash-lite',
    name: 'Gemini 2.5 Flash-Lite',
    description: 'Stable lightweight model',
    icon: <Gauge className="h-4 w-4 text-cyan-500" />,
    isDefault: false,
  },
];

/**
 * Icon assignment for dynamically discovered Gemini models.
 * Falls back to a generic icon if no pattern matches.
 */
function getGeminiModelIcon(modelId: string): React.ReactNode {
  const lower = modelId.toLowerCase();
  if (lower.startsWith('auto') || lower === 'pro') {
    return <Sparkles className="h-4 w-4 text-blue-500" />;
  }
  if (lower.includes('thinking')) {
    return <Brain className="h-4 w-4 text-green-500" />;
  }
  if (lower.includes('flash-lite')) {
    return <Gauge className="h-4 w-4 text-cyan-500" />;
  }
  if (lower.includes('preview') || lower.includes('exp')) {
    return <FlaskConical className="h-4 w-4 text-purple-500" />;
  }
  if (lower.includes('flash')) {
    return <Gauge className="h-4 w-4 text-yellow-500" />;
  }
  if (lower.includes('pro') || lower.includes('ultra')) {
    return <Sparkles className="h-4 w-4 text-blue-500" />;
  }
  return <Sparkles className="h-4 w-4 text-blue-400" />;
}

/**
 * Build the Gemini model list by merging defaults with cached model names.
 * Cached entries update display names of known models and can add new ones.
 */
export function getGeminiModels(): GeminiModelConfig[] {
  const cached = getCachedGeminiModelNames();
  const cachedIds = new Set(Object.keys(cached));

  // Start from defaults, updating display names from cache
  const models: GeminiModelConfig[] = DEFAULT_GEMINI_MODELS.map((model) => {
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
      icon: getGeminiModelIcon(modelId),
      isDefault: false,
    });
  }

  return models;
}

/**
 * Static export for backward compatibility.
 * Prefer using getGeminiModels() for dynamic names.
 */
export const GEMINI_MODELS: GeminiModelConfig[] = getGeminiModels();

interface GeminiModelSelectorProps {
  selectedModel: string | undefined;
  onModelChange: (model: string) => void;
  disabled?: boolean;
  availableModels?: GeminiModelConfig[];
}

/**
 * GeminiModelSelector component - Dropdown for selecting Gemini model.
 * Supports dynamic model discovery via localStorage cache and custom events,
 * following the same pattern as Claude's ModelSelector.
 */
export const GeminiModelSelector: React.FC<GeminiModelSelectorProps> = ({
  selectedModel,
  onModelChange,
  disabled = false,
  availableModels: availableModelsProp,
}) => {
  const [open, setOpen] = React.useState(false);
  const [dynamicModels, setDynamicModels] = React.useState<GeminiModelConfig[]>(() => getGeminiModels());

  // Listen for Gemini model name updates from stream init messages
  React.useEffect(() => {
    const handleUpdate = () => {
      setDynamicModels(getGeminiModels());
    };

    window.addEventListener(GEMINI_MODEL_NAMES_UPDATED_EVENT, handleUpdate);
    return () => {
      window.removeEventListener(GEMINI_MODEL_NAMES_UPDATED_EVENT, handleUpdate);
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
            Select Gemini Model
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
