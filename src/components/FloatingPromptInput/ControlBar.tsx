import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Wand2, ChevronDown, DollarSign, Info, Settings, Code2, Zap } from "lucide-react";
import { motion } from "framer-motion";
import { formatDuration } from "@/lib/pricing";
import { ExecutionEngineSelector, type ExecutionEngineConfig } from "@/components/ExecutionEngineSelector";
import { ModelSelector } from "./ModelSelector";
import { CodexModelSelector } from "./CodexModelSelector";
import { CodexReasoningLevelSelector, type CodexReasoningLevel } from "./CodexReasoningLevelSelector";
import { CodexRateLimitBadge } from "./CodexRateLimitBadge";
import { GeminiModelSelector } from "./GeminiModelSelector";
import { ThinkingModeToggle } from "./ThinkingModeToggle";
import { PlanModeToggle } from "./PlanModeToggle";
import { SessionToolbar } from "@/components/SessionToolbar";
import { ContextWindowIndicator } from "@/components/widgets/ContextWindowIndicator";
import { ModelType, ModelConfig, ThinkingEffort } from "./types";
import type { CodexRateLimits } from "@/types/codex";

interface ControlBarProps {
  disabled?: boolean;
  isLoading: boolean;
  prompt: string;
  hasAttachments?: boolean;
  executionEngineConfig: ExecutionEngineConfig;
  setExecutionEngineConfig: (config: ExecutionEngineConfig) => void;
  selectedModel: ModelType;
  setSelectedModel: (model: ModelType) => void;
  availableModels: ModelConfig[];
  selectedThinkingMode: string;
  selectedThinkingEffort?: ThinkingEffort;
  handleToggleThinkingMode: () => void;
  isPlanMode?: boolean;
  onTogglePlanMode?: () => void;
  hasMessages: boolean;
  sessionCost?: string;
  sessionStats?: any;
  showCostPopover: boolean;
  setShowCostPopover: (show: boolean) => void;
  messages?: any[];
  session?: any;
  codexRateLimits?: CodexRateLimits | null;
  isEnhancing: boolean;
  projectPath?: string;
  enableProjectContext: boolean;
  setEnableProjectContext: (enable: boolean) => void;
  enableDualAPI: boolean;
  setEnableDualAPI: (enable: boolean) => void;
  getEnabledProviders: () => any[];
  handleEnhancePromptWithAPI: (id: string) => void;
  onCancel: () => void;
  onSend: () => void;
}

export const ControlBar: React.FC<ControlBarProps> = ({
  disabled,
  isLoading,
  prompt,
  hasAttachments = false,
  executionEngineConfig,
  setExecutionEngineConfig,
  selectedModel,
  setSelectedModel,
  availableModels,
  selectedThinkingMode,
  selectedThinkingEffort,
  handleToggleThinkingMode,
  isPlanMode,
  onTogglePlanMode,
  hasMessages,
  sessionCost,
  sessionStats,
  showCostPopover,
  setShowCostPopover,
  messages,
  session,
  codexRateLimits: providedCodexRateLimits,
  isEnhancing,
  projectPath,
  enableProjectContext,
  setEnableProjectContext,
  enableDualAPI,
  setEnableDualAPI,
  getEnabledProviders,
  handleEnhancePromptWithAPI,
  onCancel,
  onSend
}) => {
  const { t } = useTranslation();

  const contextWindowModel =
    executionEngineConfig.engine === 'codex'
      ? (executionEngineConfig.codexFastMode && (session?.model || executionEngineConfig.codexModel)?.includes('gpt-5.5')
        ? 'gpt-5.5-fast'
        : (session?.model || executionEngineConfig.codexModel))
      : executionEngineConfig.engine === 'gemini'
        ? (executionEngineConfig.geminiModel || session?.model)
        : (executionEngineConfig.claudeFastMode ? 'claude-opus-4-7-fast' : selectedModel);

  // Extract latest Codex rate limits from messages
  const codexRateLimits = useMemo<CodexRateLimits | null>(() => {
    if (executionEngineConfig.engine !== 'codex') {
      return null;
    }

    if (providedCodexRateLimits) {
      return providedCodexRateLimits;
    }

    if (!messages || messages.length === 0) {
      return null;
    }

    // Find the latest message with rate limits in codexMetadata
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const rateLimits = (msg as any)?.codexMetadata?.rateLimits;
      if (rateLimits && (rateLimits.primary || rateLimits.secondary)) {
        return rateLimits;
      }
    }

    return null;
  }, [executionEngineConfig.engine, messages, providedCodexRateLimits]);
  
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Execution Engine Selector */}
      <ExecutionEngineSelector
        value={executionEngineConfig}
        onChange={setExecutionEngineConfig}
      />

      {/* Claude-specific controls */}
      {executionEngineConfig.engine === 'claude' && (
        <>
          <ModelSelector
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
            disabled={disabled}
            availableModels={availableModels}
          />

          <ThinkingModeToggle
            isEnabled={selectedThinkingMode === "adaptive"}
            effort={selectedThinkingEffort}
            onToggle={handleToggleThinkingMode}
            disabled={disabled}
          />

          {onTogglePlanMode && (
            <PlanModeToggle
              isPlanMode={isPlanMode || false}
              onToggle={onTogglePlanMode}
              disabled={disabled}
            />
          )}
        </>
      )}

      {/* Codex-specific controls */}
      {executionEngineConfig.engine === 'codex' && (
        <>
          <CodexModelSelector
            selectedModel={executionEngineConfig.codexModel}
            onModelChange={(model) => setExecutionEngineConfig({
              ...executionEngineConfig,
              codexModel: model,
            })}
            disabled={disabled}
          />
          <CodexReasoningLevelSelector
            selectedLevel={executionEngineConfig.codexReasoningLevel}
            onLevelChange={(level: CodexReasoningLevel) => setExecutionEngineConfig({
              ...executionEngineConfig,
              codexReasoningLevel: level,
            })}
            disabled={disabled}
          />
          {/* Codex Rate Limit Badge */}
          {codexRateLimits && (
            <CodexRateLimitBadge rateLimits={codexRateLimits} />
          )}
        </>
      )}

      {/* Gemini-specific controls */}
      {executionEngineConfig.engine === 'gemini' && (
        <GeminiModelSelector
          selectedModel={executionEngineConfig.geminiModel}
          onModelChange={(model) => setExecutionEngineConfig({
            ...executionEngineConfig,
            geminiModel: model,
          })}
          disabled={disabled}
        />
      )}

      {/* Session Cost with Details */}
      {hasMessages && sessionCost && sessionStats && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.2 }}
          onMouseEnter={() => setShowCostPopover(true)}
          onMouseLeave={() => setShowCostPopover(false)}
        >
          <Popover
            open={showCostPopover}
            onOpenChange={setShowCostPopover}
            trigger={
              <Badge variant="outline" className="flex items-center gap-1 px-2 py-1 h-8 cursor-default hover:bg-accent transition-colors border-border/50">
                <DollarSign className="h-3 w-3 text-green-600 dark:text-green-400" />
                <span className="font-mono text-xs">{sessionCost}</span>
                <Info className="h-3 w-3 text-muted-foreground ml-1" />
              </Badge>
            }
            content={
              <div className="space-y-2">
                <div className="font-medium text-sm border-b pb-1">{t('promptInput.sessionStats')}</div>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">{t('promptInput.totalCost')}:</span>
                    <span className="font-mono font-medium">{sessionCost}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">{t('promptInput.totalTokens')}:</span>
                    <span className="font-mono">{sessionStats.totalTokens.toLocaleString()}</span>
                  </div>
                  {/* ... other stats ... */}
                  {sessionStats.durationSeconds > 0 && (
                    <>
                      <div className="border-t pt-1 mt-1"></div>
                      <div className="flex justify-between gap-4">
                        <span className="text-muted-foreground">{t('promptInput.sessionDuration')}:</span>
                        <span className="font-mono">{formatDuration(sessionStats.durationSeconds)}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            }
            side="top"
            align="center"
            className="w-80"
          />
        </motion.div>
      )}

      {/* Context Window Indicator - Claude / Codex / Gemini 引擎显示 */}
      {(executionEngineConfig.engine === 'claude' || executionEngineConfig.engine === 'codex' || executionEngineConfig.engine === 'gemini') && hasMessages && messages && (
        <ContextWindowIndicator
          messages={messages}
          model={contextWindowModel}
          engine={executionEngineConfig.engine}
          show={true}
        />
      )}

      {/* Loading Indicator - 移至 SessionMessages 中显示为 CLI 风格 */}

      <div className="flex-1" />

      {/* Session Export Toolbar */}
      {messages && messages.length > 0 && (
        <SessionToolbar
          messages={messages}
          session={session}
          isStreaming={isLoading}
        />
      )}

      {/* Enhance Button */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="default"
            disabled={disabled || isEnhancing}
            className="gap-2 h-8 border-border/50 bg-background/50 hover:bg-accent/50"
          >
            <Wand2 className="h-3.5 w-3.5" />
            <span className="text-xs">{isEnhancing ? t('promptInput.enhancing') : t('promptInput.enhance')}</span>
            <ChevronDown className="h-3 w-3 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 bg-background/95 backdrop-blur-md border-border/50">
          {/* Project Context Switch */}
          {projectPath && (
            <>
              <div className="px-2 py-1.5">
                <label className="flex items-center justify-between cursor-pointer hover:bg-accent/50 rounded px-2 py-1.5 transition-colors">
                  <div className="flex items-center gap-2">
                    <Code2 className={`h-4 w-4 ${enableProjectContext ? 'text-primary' : 'text-muted-foreground'}`} />
                    <div>
                      <div className={`text-sm font-medium ${enableProjectContext ? 'text-primary' : ''}`}>
                        {t('promptInput.enableProjectContext')}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t('promptInput.useAcemcpSearch')}
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={enableProjectContext}
                    onCheckedChange={setEnableProjectContext}
                  />
                </label>
              </div>
              <DropdownMenuSeparator className="bg-border/50" />
            </>
          )}

          {/* Smart Context Switch */}
          <div className="px-2 py-1.5">
            <label className="flex items-center justify-between cursor-pointer hover:bg-accent/50 rounded px-2 py-1.5 transition-colors">
              <div className="flex items-center gap-2">
                <Zap className={`h-4 w-4 ${enableDualAPI ? 'text-primary' : 'text-muted-foreground'}`} />
                <div>
                  <div className={`text-sm font-medium ${enableDualAPI ? 'text-primary' : ''}`}>
                    {t('promptInput.smartContextExtraction')}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t('promptInput.aiFilterMessages')}
                  </p>
                </div>
              </div>
              <Switch
                checked={enableDualAPI}
                onCheckedChange={(checked) => {
                  setEnableDualAPI(checked);
                  localStorage.setItem('enable_dual_api_enhancement', String(checked));
                }}
              />
            </label>
          </div>
          <DropdownMenuSeparator className="bg-border/50" />

          {/* Third-party API Providers */}
          {(() => {
            const enabledProviders = getEnabledProviders();
            if (enabledProviders.length > 0) {
              return (
                <>
                  {enabledProviders.map((provider) => (
                    <DropdownMenuItem
                      key={provider.id}
                      onClick={() => handleEnhancePromptWithAPI(provider.id)}
                      className="cursor-pointer"
                    >
                      {provider.name}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator className="bg-border/50" />
                </>
              );
            }
            return null;
          })()}

          <DropdownMenuItem onClick={() => window.dispatchEvent(new CustomEvent('open-prompt-api-settings'))} className="cursor-pointer">
            <Settings className="h-3 w-3 mr-2" />
            {t('promptInput.manageApiConfig')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Send/Cancel Button */}
      {isLoading ? (
        <Button
          onClick={onCancel}
          variant="destructive"
          size="default"
          disabled={disabled}
          className="h-8 shadow-md bg-red-500 hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-700 text-white font-medium"
        >
          {t('buttons.cancel')}
        </Button>
      ) : (
        <Button
          onClick={onSend}
          disabled={(!prompt.trim() && !hasAttachments) || disabled}
          size="default"
          className="h-8 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-sm transition-all duration-200"
        >
          {t('promptInput.send')}
        </Button>
      )}
    </div>
  );
};
