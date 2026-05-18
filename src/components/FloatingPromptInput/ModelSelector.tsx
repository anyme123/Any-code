import React from "react";
import { ChevronUp, Check, Star, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ModelType, ModelConfig } from "./types";
import { MODELS } from "./constants";
import { getDefaultModel, setDefaultModel } from "./defaultModelStorage";
import { CustomModelManagerDialog } from "./CustomModelManagerDialog";

interface ModelSelectorProps {
  selectedModel: ModelType;
  onModelChange: (model: ModelType) => void;
  disabled?: boolean;
  availableModels?: ModelConfig[];
}

/**
 * ModelSelector component - Dropdown for selecting AI model
 */
export const ModelSelector: React.FC<ModelSelectorProps> = ({
  selectedModel,
  onModelChange,
  disabled = false,
  availableModels = MODELS
}) => {
  const [open, setOpen] = React.useState(false);
  const [managerOpen, setManagerOpen] = React.useState(false);
  const [currentDefaultModel, setCurrentDefaultModel] = React.useState<ModelType | null>(() => getDefaultModel());

  // 内置模型 vs 自定义模型分组
  const builtInModels = availableModels.filter((m) => !m.isCustom);
  const customModels = availableModels.filter((m) => m.isCustom);

  const selectedModelData = availableModels.find(m => m.id === selectedModel) || availableModels[0];

  const handleSetDefault = (e: React.MouseEvent, modelId: ModelType) => {
    e.stopPropagation();
    setDefaultModel(modelId);
    setCurrentDefaultModel(modelId);
  };

  const renderModelRow = (model: ModelConfig) => (
    <button
      key={model.id}
      onClick={() => {
        onModelChange(model.id);
        setOpen(false);
      }}
      className={cn(
        "w-full flex items-start gap-3 p-3 rounded-md transition-colors text-left group",
        "hover:bg-accent",
        selectedModel === model.id && "bg-accent"
      )}
    >
      <div className="mt-0.5">{model.icon}</div>
      <div className="flex-1 space-y-1 min-w-0">
        <div className="font-medium text-sm flex items-center gap-2">
          <span className="truncate">{model.name}</span>
          {selectedModel === model.id && (
            <Check className="h-3.5 w-3.5 text-primary flex-shrink-0" />
          )}
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {model.description}
        </div>
      </div>
      <button
        onClick={(e) => handleSetDefault(e, model.id)}
        className={cn(
          "mt-0.5 p-1 rounded hover:bg-muted transition-colors flex-shrink-0",
          currentDefaultModel === model.id
            ? "text-yellow-500"
            : "text-muted-foreground/50 hover:text-muted-foreground opacity-0 group-hover:opacity-100"
        )}
        title={currentDefaultModel === model.id ? "当前默认模型" : "设为默认模型"}
      >
        <Star className={cn(
          "h-4 w-4",
          currentDefaultModel === model.id && "fill-yellow-500"
        )} />
      </button>
    </button>
  );

  return (
    <>
      <Popover
        trigger={
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            className="h-8 gap-2 min-w-[160px] max-w-[260px] justify-start border-border/50 bg-background/50 hover:bg-accent/50"
          >
            {selectedModelData.icon}
            <span className="flex-1 text-left truncate">{selectedModelData.name}</span>
            {currentDefaultModel === selectedModel && (
              <Star className="h-3 w-3 text-yellow-500 fill-yellow-500 flex-shrink-0" />
            )}
            <ChevronUp className="h-4 w-4 opacity-50 flex-shrink-0" />
          </Button>
        }
        content={
          <div className="w-[340px] p-1 max-h-[480px] overflow-y-auto">
            <div className="px-3 py-2 text-xs text-muted-foreground border-b border-border/50 mb-1">
              选择模型（点击星标设为新会话默认）
            </div>

            {builtInModels.map(renderModelRow)}

            {customModels.length > 0 && (
              <>
                <div className="px-3 py-1.5 mt-1 text-[11px] uppercase tracking-wider text-muted-foreground/70 border-t border-border/40">
                  自定义模型
                </div>
                {customModels.map(renderModelRow)}
              </>
            )}

            <div className="border-t border-border/40 mt-1 pt-1">
              <button
                onClick={() => {
                  setOpen(false);
                  setManagerOpen(true);
                }}
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-md text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <Settings2 className="h-4 w-4" />
                <span>管理自定义模型</span>
              </button>
            </div>
          </div>
        }
        open={open}
        onOpenChange={setOpen}
        align="start"
        side="top"
      />

      <CustomModelManagerDialog open={managerOpen} onOpenChange={setManagerOpen} />
    </>
  );
};
