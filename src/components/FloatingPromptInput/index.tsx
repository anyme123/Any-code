import React, { useState, useRef, forwardRef, useImperativeHandle, useEffect, useReducer, useCallback, useMemo } from "react";
import { AnimatePresence } from "framer-motion";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { FloatingPromptInputProps, FloatingPromptInputRef, ThinkingMode, ThinkingEffort, ModelType, ModelConfig } from "./types";
import { getModels } from "./constants";
import { MODEL_NAMES_UPDATED_EVENT } from "@/lib/modelNameParser";
import { useImageHandling } from "./hooks/useImageHandling";
import { useFileSelection } from "./hooks/useFileSelection";
import { usePromptEnhancement } from "./hooks/usePromptEnhancement";
import { usePromptSuggestion } from "./hooks/usePromptSuggestion";
import { useDraftPersistence } from "./hooks/useDraftPersistence";
import { useSlashCommandMenu } from "./hooks/useSlashCommandMenu";
import { useCustomSlashCommands } from "./hooks/useCustomSlashCommands";
import { usePluginSlashCommands } from "./hooks/usePluginSlashCommands";
import { api } from "@/lib/api";
import { getEnabledProviders } from "@/lib/promptEnhancementService";
import { inputReducer, initialState } from "./reducer";
import { getDefaultModel } from "./defaultModelStorage";

// Import sub-components
import { InputArea } from "./InputArea";
import { AttachmentPreview } from "./AttachmentPreview";
import { ControlBar } from "./ControlBar";
import { ExpandedModal } from "./ExpandedModal";

// Re-export types for external use
export type { FloatingPromptInputRef, FloatingPromptInputProps, ThinkingMode, ModelType } from "./types";

/**
 * FloatingPromptInput - Refactored modular component
 */
const FloatingPromptInputInner = (
  {
    onSend,
    isLoading = false,
    disabled = false,
    defaultModel = "default",
    sessionModel,
    projectPath,
    sessionId,
    projectId,
    className,
    onCancel,
    getConversationContext,
    messages,
    isPlanMode = false,
    onTogglePlanMode,
    sessionCost,
    sessionStats,
    hasMessages = false,
    session,
    codexRateLimits,
    executionEngineConfig: externalEngineConfig,
    onExecutionEngineConfigChange,
  }: FloatingPromptInputProps,
  ref: React.Ref<FloatingPromptInputRef>,
) => {
  // Helper function to convert backend model string to frontend ModelType
  const parseSessionModel = (modelStr?: string): ModelType | null => {
    if (!modelStr) return null;

    const lowerModel = modelStr.toLowerCase();
    if (lowerModel === "default") return "default";
    if (lowerModel === "best") return "best";
    if (lowerModel.includes("opusplan")) return "opusplan";
    if (lowerModel.includes("opus")) return "opus";
    if (lowerModel.includes("sonnet")) return "sonnet";
    if (lowerModel.includes("haiku")) return "haiku";

    return null;
  };

  // Determine initial model:
  // 1. Historical session: use sessionModel
  // 2. New session: use user's default model or fallback to Claude Code default
  const getInitialModel = (): ModelType => {
    // If this is a historical session with saved model, use it
    const parsedSessionModel = parseSessionModel(sessionModel);
    if (parsedSessionModel) {
      return parsedSessionModel;
    }
    // For new sessions, use user's default model setting
    const userDefaultModel = getDefaultModel();
    if (userDefaultModel) {
      return userDefaultModel;
    }
    // Fall back to prop default or Claude Code default
    return defaultModel;
  };

  // Use Reducer for state management
  const [state, dispatch] = useReducer(inputReducer, {
    ...initialState,
    selectedModel: getInitialModel(),
    executionEngineConfig: externalEngineConfig || initialState.executionEngineConfig,
  });

  // 草稿持久化 Hook - 确保输入内容在页面切换后不丢失
  const { saveDraft, clearDraft } = useDraftPersistence({
    sessionId,
    onRestore: useCallback((draft: string) => {
      // 恢复草稿时更新 prompt 状态
      dispatch({ type: "SET_PROMPT", payload: draft });
    }, []),
  });

  // Initialize enableProjectContext from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('enable_project_context');
      if (stored === 'true') {
        dispatch({ type: "SET_ENABLE_PROJECT_CONTEXT", payload: true });
      }
    } catch {
      // Ignore error
    }
  }, []);

  // Initialize thinking mode from settings.json (source of truth)
  // Read Claude Code effort settings from settings.json env
  useEffect(() => {
    const initThinkingMode = async () => {
      try {
        const settings = await api.getClaudeSettings();
        const envVars = settings?.data?.env || settings?.env;
        const effort = envVars?.CLAUDE_CODE_EFFORT_LEVEL || envVars?.CLAUDE_CODE_THINKING_EFFORT;
        if (effort && ['low', 'medium', 'high', 'xhigh', 'max'].includes(effort)) {
          dispatch({ type: "SET_THINKING_MODE", payload: { mode: 'adaptive', effort: effort as ThinkingEffort } });
          localStorage.setItem('thinking_mode', 'adaptive');
          localStorage.setItem('thinking_effort', effort);
        } else {
          // Check legacy MAX_THINKING_TOKENS for backward compatibility
          const hasLegacy = envVars?.MAX_THINKING_TOKENS !== undefined;
          if (hasLegacy) {
            dispatch({ type: "SET_THINKING_MODE", payload: { mode: 'adaptive', effort: 'high' } });
            localStorage.setItem('thinking_mode', 'adaptive');
            localStorage.setItem('thinking_effort', 'high');
          } else {
            dispatch({ type: "SET_THINKING_MODE", payload: { mode: 'off' } });
            localStorage.setItem('thinking_mode', 'off');
          }
        }
      } catch (error) {
        console.error('[ThinkingMode] Failed to read settings, falling back to localStorage:', error);
        try {
          const stored = localStorage.getItem('thinking_mode');
          const storedEffort = localStorage.getItem('thinking_effort');
          if (stored === 'adaptive' && storedEffort) {
            dispatch({ type: "SET_THINKING_MODE", payload: { mode: 'adaptive', effort: storedEffort as ThinkingEffort } });
          } else {
            dispatch({ type: "SET_THINKING_MODE", payload: { mode: 'off' } });
          }
        } catch {
          // Ignore error
        }
      }
    };

    initThinkingMode();
  }, []);

  // Sync external config changes
  useEffect(() => {
    if (externalEngineConfig && JSON.stringify(externalEngineConfig) !== JSON.stringify(state.executionEngineConfig)) {
      dispatch({ type: "SET_EXECUTION_ENGINE_CONFIG", payload: externalEngineConfig });
    }
  }, [externalEngineConfig]);

  // Persist execution engine config
  useEffect(() => {
    try {
      localStorage.setItem('execution_engine_config', JSON.stringify(state.executionEngineConfig));
      onExecutionEngineConfigChange?.(state.executionEngineConfig);
    } catch (error) {
      console.error('[ExecutionEngine] Failed to save config to localStorage:', error);
    }
  }, [state.executionEngineConfig, onExecutionEngineConfigChange]);

  // Dynamic model list - initialized with dynamic names from cache
  const [availableModels, setAvailableModels] = useState<ModelConfig[]>(() => getModels());

  // Listen for model name updates from stream init messages
  useEffect(() => {
    const handleModelNamesUpdated = () => {
      setAvailableModels(prev => {
        const updated = getModels();
        // Preserve any custom model that was dynamically added
        const customModel = prev.find(m => m.id === 'custom');
        if (customModel) {
          return [...updated, customModel];
        }
        return updated;
      });
    };

    window.addEventListener(MODEL_NAMES_UPDATED_EVENT, handleModelNamesUpdated);
    return () => {
      window.removeEventListener(MODEL_NAMES_UPDATED_EVENT, handleModelNamesUpdated);
    };
  }, []);

  // 🔧 Mac 输入法兼容：追踪 IME 组合输入状态
  const [isComposing, setIsComposing] = useState(false);
  // 记录 compositionend 时间戳，用于冷却期检测
  const compositionEndTimeRef = useRef(0);

  // Refs
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const expandedTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Custom hooks
  const {
    imageAttachments,
    embeddedImages,
    dragActive,
    handlePaste,
    handleRemoveImageAttachment,
    handleRemoveEmbeddedImage,
    handleDrag,
    handleDrop,
    addImage,
    setImageAttachments,
    setEmbeddedImages,
  } = useImageHandling({
    prompt: state.prompt,
    projectPath,
    isExpanded: state.isExpanded,
    onPromptChange: (p) => dispatch({ type: "SET_PROMPT", payload: p }),
    textareaRef,
    expandedTextareaRef,
  });

  const {
    showFilePicker,
    filePickerQuery,
    detectAtSymbol,
    updateFilePickerQuery,
    handleFileSelect,
    handleFilePickerClose,
    setShowFilePicker,
    setFilePickerQuery,
  } = useFileSelection({
    prompt: state.prompt,
    projectPath,
    cursorPosition: state.cursorPosition,
    isExpanded: state.isExpanded,
    onPromptChange: (p) => dispatch({ type: "SET_PROMPT", payload: p }),
    onCursorPositionChange: (p) => dispatch({ type: "SET_CURSOR_POSITION", payload: p }),
    textareaRef,
    expandedTextareaRef,
  });


  const {
    isEnhancing,
    handleEnhancePromptWithAPI,
    enableDualAPI,
    setEnableDualAPI,
  } = usePromptEnhancement({
    prompt: state.prompt,
    isExpanded: state.isExpanded,
    onPromptChange: (p) => dispatch({ type: "SET_PROMPT", payload: p }),
    getConversationContext,
    messages,
    textareaRef,
    expandedTextareaRef,
    projectPath,
    sessionId,
    projectId,
    enableProjectContext: state.enableProjectContext,
    enableMultiRound: true,
  });

  // 🆕 Prompt Suggestions Hook
  const [enablePromptSuggestion, setEnablePromptSuggestion] = useState(() => {
    try {
      const stored = localStorage.getItem('enable_prompt_suggestion');
      return stored !== null ? stored === 'true' : true; // 默认启用
    } catch {
      return true;
    }
  });

  // Listen for setting changes from GeneralSettings
  useEffect(() => {
    const handleToggle = (e: CustomEvent<{ enabled: boolean }>) => {
      setEnablePromptSuggestion(e.detail.enabled);
    };
    window.addEventListener('prompt-suggestion-toggle', handleToggle as EventListener);
    return () => {
      window.removeEventListener('prompt-suggestion-toggle', handleToggle as EventListener);
    };
  }, []);

  const {
    suggestion,
    isLoading: isSuggestionLoading,
    acceptSuggestion,
    dismissSuggestion,
  } = usePromptSuggestion({
    messages: messages || [],
    currentPrompt: state.prompt,
    enabled: enablePromptSuggestion && !state.isExpanded && !isLoading && !disabled,
    debounceMs: 600,
  });

  // 🆕 斜杠命令支持 Claude 和 Gemini 引擎（Codex 暂不支持非交互式斜杠命令）
  const currentEngine = state.executionEngineConfig.engine;
  const isSlashCommandSupported = currentEngine === 'claude' || currentEngine === 'gemini';

  // 🆕 自定义斜杠命令 Hook - 从后端获取用户和项目命令
  // Claude: ~/.claude/commands/*.md
  // Gemini: ~/.gemini/commands/*.toml
  const { customCommands } = useCustomSlashCommands({
    projectPath,
    enabled: isSlashCommandSupported && !state.isExpanded && !disabled,
    engine: currentEngine,
  });

  // 🆕 插件斜杠命令 Hook - 从后端获取插件技能和命令
  const { pluginCommands } = usePluginSlashCommands({
    projectPath,
    enabled: isSlashCommandSupported && !state.isExpanded && !disabled,
  });

  // 合并自定义命令和插件命令
  const allCustomCommands = useMemo(() => {
    return [...customCommands, ...pluginCommands];
  }, [customCommands, pluginCommands]);

  // 🆕 斜杠命令菜单 Hook
  const {
    isOpen: showSlashCommandMenu,
    query: slashCommandQuery,
    selectedIndex: slashCommandSelectedIndex,
    setSelectedIndex: setSlashCommandSelectedIndex,
    selectCommand: handleSlashCommandSelect,
    closeMenu: closeSlashCommandMenu,
    handleKeyDown: handleSlashCommandKeyDown,
  } = useSlashCommandMenu({
    prompt: state.prompt,
    onCommandSelect: (command) => {
      // 替换当前输入为选中的命令
      dispatch({ type: "SET_PROMPT", payload: command });
    },
    customCommands: allCustomCommands,
    // Claude 和 Gemini 都支持斜杠命令菜单
    disabled: !isSlashCommandSupported || state.isExpanded || disabled,
    engine: currentEngine,
  });

  // Persist project context switch
  useEffect(() => {
    try {
      localStorage.setItem('enable_project_context', state.enableProjectContext.toString());
    } catch (error) {
      console.warn('Failed to save enable_project_context to localStorage:', error);
    }
  }, [state.enableProjectContext]);

  // Restore session model
  useEffect(() => {
    const parsedSessionModel = parseSessionModel(sessionModel);
    if (parsedSessionModel) {
      dispatch({ type: "SET_MODEL", payload: parsedSessionModel });
    }
  }, [sessionModel]);

  // Load custom models
  useEffect(() => {
    const loadCustomModel = async () => {
      try {
        const settings = await api.getClaudeSettings();
        const envVars = settings?.data?.env || settings?.env;

        if (envVars && typeof envVars === 'object') {
          const customModel = envVars.ANTHROPIC_MODEL ||
                             envVars.ANTHROPIC_DEFAULT_SONNET_MODEL ||
                             envVars.ANTHROPIC_DEFAULT_OPUS_MODEL ||
                             envVars.ANTHROPIC_CUSTOM_MODEL_OPTION;

          if (customModel && typeof customModel === 'string') {
            const normalizedCustomModel = customModel.toLowerCase();
            const isBuiltInModel = [
              'default',
              'best',
              'sonnet',
              'opus',
              'haiku',
              'opusplan',
              'sonnet[1m]',
              'opus[1m]',
            ].includes(normalizedCustomModel);

            if (!isBuiltInModel) {
              // This is a custom model - add it to the list
              const customModelConfig: ModelConfig = {
                id: "custom" as ModelType,
                name: customModel,
                description: "Custom model from environment variables",
                icon: <Sparkles className="h-4 w-4" />
              };

              setAvailableModels(prev => {
                const hasCustom = prev.some(m => m.id === "custom");
                if (!hasCustom) return [...prev, customModelConfig];
                // Update existing custom model if name changed
                return prev.map(m => m.id === "custom" ? customModelConfig : m);
              });
            }
          }
        }
      } catch (error) {
        console.error('[FloatingPromptInput] Failed to load custom model:', error);
      }
    };

    loadCustomModel();
  }, []);

  // Imperative handle
  useImperativeHandle(ref, () => ({
    addImage,
    setPrompt: (text: string) => dispatch({ type: "SET_PROMPT", payload: text }),
  }));

  // Toggle thinking mode - cycle through: off → high → xhigh → max → low → medium → off
  const EFFORT_CYCLE: (ThinkingEffort | 'off')[] = ['off', 'high', 'xhigh', 'max', 'low', 'medium'];

  const handleToggleThinkingMode = useCallback(async () => {
    const currentMode = state.selectedThinkingMode;
    const currentEffort = state.selectedThinkingEffort;

    // Find current position in cycle
    const currentKey = currentMode === 'off' ? 'off' : (currentEffort || 'high');
    const currentIndex = EFFORT_CYCLE.indexOf(currentKey);
    const nextIndex = (currentIndex + 1) % EFFORT_CYCLE.length;
    const nextKey = EFFORT_CYCLE[nextIndex];

    const newMode: ThinkingMode = nextKey === 'off' ? 'off' : 'adaptive';
    const newEffort: ThinkingEffort | undefined = nextKey === 'off' ? undefined : nextKey as ThinkingEffort;

    dispatch({ type: "SET_THINKING_MODE", payload: { mode: newMode, effort: newEffort } });

    // Persist to localStorage
    try {
      localStorage.setItem('thinking_mode', newMode);
      if (newEffort) localStorage.setItem('thinking_effort', newEffort);
      else localStorage.removeItem('thinking_effort');
    } catch {
      // Ignore localStorage errors
    }

    try {
      await api.updateThinkingMode(newMode === 'adaptive', newEffort);
    } catch (error) {
      console.error("Failed to update thinking mode:", error);
      // Revert on error
      dispatch({ type: "SET_THINKING_MODE", payload: { mode: currentMode, effort: currentEffort } });
      try {
        localStorage.setItem('thinking_mode', currentMode);
        if (currentEffort) localStorage.setItem('thinking_effort', currentEffort);
      } catch {
        // Ignore localStorage errors
      }
    }
  }, [state.selectedThinkingMode, state.selectedThinkingEffort]);

  // Focus management
  useEffect(() => {
    if (state.isExpanded && expandedTextareaRef.current) {
      expandedTextareaRef.current.focus();
    } else if (!state.isExpanded && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [state.isExpanded]);

  // Auto-resize textarea
  const adjustTextareaHeight = (textarea: HTMLTextAreaElement | null) => {
    if (!textarea) return;
    textarea.style.height = 'auto';
    const maxHeight = state.isExpanded ? 600 : 300;
    const newHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${newHeight}px`;
    if (textarea.scrollHeight > maxHeight) {
      textarea.scrollTop = textarea.scrollHeight;
    }
  };

  useEffect(() => {
    const textarea = state.isExpanded ? expandedTextareaRef.current : textareaRef.current;
    adjustTextareaHeight(textarea);
  }, [state.prompt, state.isExpanded]);

  // Tab key listener - 🆕 只在没有建议时切换 thinking mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const activeElement = document.activeElement;
        const isInTextarea = activeElement?.tagName === 'TEXTAREA';
        // 🆕 在 textarea 中且有建议时，不处理（由组件内部 handleKeyDown 处理）
        if (isInTextarea && suggestion) {
          return;
        }
        if (!isInTextarea && !disabled) {
          e.preventDefault();
          handleToggleThinkingMode();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [disabled, handleToggleThinkingMode, suggestion]);

  // Event handlers
  const handleSend = () => {
    // Allow sending if there's text content OR image attachments
    if ((state.prompt.trim() || imageAttachments.length > 0) && !disabled) {
      let finalPrompt = state.prompt.trim();
      if (imageAttachments.length > 0) {
        // Codex CLI doesn't recognize @ prefix syntax, use direct paths instead
        // Claude Code CLI uses @ prefix to reference files
        const isCodex = state.executionEngineConfig.engine === 'codex';
        const imagePathMentions = imageAttachments.map(attachment => {
          if (isCodex) {
            // For Codex: use direct path without @ prefix
            return attachment.filePath.includes(' ') ? `"${attachment.filePath}"` : attachment.filePath;
          } else {
            // For Claude Code: use @ prefix for file reference
            return attachment.filePath.includes(' ') ? `@"${attachment.filePath}"` : `@${attachment.filePath}`;
          }
        }).join(' ');

        finalPrompt = finalPrompt + (finalPrompt.endsWith(' ') || finalPrompt === '' ? '' : ' ') + imagePathMentions;
      }

      // When custom model is selected, pass the actual model name instead of "custom"
      let modelToSend = state.selectedModel;
      if (state.selectedModel === 'custom') {
        const customModelConfig = availableModels.find(m => m.id === 'custom');
        if (customModelConfig) {
          modelToSend = customModelConfig.name as ModelType;
        }
      }

      onSend(finalPrompt, modelToSend, undefined);
      dispatch({ type: "RESET_INPUT" });
      setImageAttachments([]);
      setEmbeddedImages([]);
      // 发送成功后清除草稿
      clearDraft();
      setTimeout(() => {
        const textarea = state.isExpanded ? expandedTextareaRef.current : textareaRef.current;
        if (textarea) textarea.style.height = 'auto';
      }, 0);
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const newCursorPosition = e.target.selectionStart || 0;
    detectAtSymbol(newValue, newCursorPosition);
    updateFilePickerQuery(newValue, newCursorPosition);
    dispatch({ type: "SET_PROMPT", payload: newValue });
    dispatch({ type: "SET_CURSOR_POSITION", payload: newCursorPosition });
    // 保存草稿
    saveDraft(newValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // 🆕 优先处理斜杠命令菜单的键盘事件
    if (handleSlashCommandKeyDown(e)) {
      return;
    }

    if (showFilePicker && e.key === 'Escape') {
      e.preventDefault();
      setShowFilePicker(false);
      setFilePickerQuery("");
      return;
    }

    // 🆕 Tab 键接受建议 (斜杠命令菜单未打开时)
    if (e.key === 'Tab' && !e.shiftKey && suggestion && !showFilePicker && !showSlashCommandMenu) {
      e.preventDefault();
      const accepted = acceptSuggestion();
      if (accepted) {
        dispatch({ type: "SET_PROMPT", payload: accepted });
      }
      return;
    }

    // 🆕 Escape 键取消建议
    if (e.key === 'Escape' && suggestion && !showFilePicker) {
      e.preventDefault();
      dismissSuggestion();
      return;
    }

    // 🔧 输入法兼容：组合输入时忽略 Enter 键
    // 支持：Mac 中文输入法、Windows 注音/倉頡/拼音、Linux IBus/Fcitx 等
    if (e.key === "Enter" && !e.shiftKey && !state.isExpanded && !showFilePicker) {
      // 多重检查确保不在 IME 组合输入中：
      // 1. React 状态追踪的 isComposing
      // 2. 原生事件的 isComposing 属性
      // 3. keyCode === 229 是 IME 处理中的标准信号（兼容各种输入法）
      // 4. compositionend 后的冷却期（某些输入法需要较长时间）
      const timeSinceCompositionEnd = Date.now() - compositionEndTimeRef.current;
      const inCooldown = timeSinceCompositionEnd < 200; // 200ms 冷却期（增加以兼容更多输入法）
      const isIMEProcessing = e.nativeEvent.keyCode === 229 || (e.nativeEvent as any).which === 229;

      if (!isComposing && !e.nativeEvent.isComposing && !isIMEProcessing && !inCooldown) {
        e.preventDefault();
        dismissSuggestion(); // 🆕 发送时清除建议
        handleSend();
      }
    }
  };

  return (
    <>
      {/* Expanded Modal */}
      <AnimatePresence>
        {state.isExpanded && (
          <ExpandedModal
            ref={expandedTextareaRef}
            prompt={state.prompt}
            disabled={disabled}
            imageAttachments={imageAttachments}
            embeddedImages={embeddedImages}
            executionEngineConfig={state.executionEngineConfig}
            setExecutionEngineConfig={(config) => dispatch({ type: "SET_EXECUTION_ENGINE_CONFIG", payload: config })}
            selectedModel={state.selectedModel}
            setSelectedModel={(model) => dispatch({ type: "SET_MODEL", payload: model })}
            availableModels={availableModels}
            selectedThinkingMode={state.selectedThinkingMode}
            selectedThinkingEffort={state.selectedThinkingEffort}
            handleToggleThinkingMode={handleToggleThinkingMode}
            isPlanMode={isPlanMode}
            onTogglePlanMode={onTogglePlanMode}
            isEnhancing={isEnhancing}
            projectPath={projectPath}
            enableProjectContext={state.enableProjectContext}
            setEnableProjectContext={(enable) => dispatch({ type: "SET_ENABLE_PROJECT_CONTEXT", payload: enable })}
            enableDualAPI={enableDualAPI}
            setEnableDualAPI={setEnableDualAPI}
            getEnabledProviders={getEnabledProviders}
            handleEnhancePromptWithAPI={handleEnhancePromptWithAPI}
            onClose={() => dispatch({ type: "SET_EXPANDED", payload: false })}
            onRemoveAttachment={handleRemoveImageAttachment}
            onRemoveEmbedded={handleRemoveEmbeddedImage}
            onTextChange={handleTextChange}
            onPaste={handlePaste}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onSend={handleSend}
          />
        )}
      </AnimatePresence>

      {/* ✅ 重构布局: 输入区域不再使用 fixed 定位，作为 Flex 容器的一部分 */}
      <div className={cn(
        "flex-shrink-0 border-t border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-[var(--glass-blur)] shadow-[var(--glass-shadow)]",
        className
      )}>
        <AttachmentPreview
          imageAttachments={imageAttachments}
          embeddedImages={embeddedImages}
          onRemoveAttachment={handleRemoveImageAttachment}
          onRemoveEmbedded={handleRemoveEmbeddedImage}
          className="border-b border-border/50 p-4"
        />

        <div className="p-4 space-y-2">
          <InputArea
            ref={textareaRef}
            prompt={state.prompt}
            disabled={disabled}
            dragActive={dragActive}
            showFilePicker={showFilePicker}
            projectPath={projectPath}
            filePickerQuery={filePickerQuery}
            onTextChange={handleTextChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onExpand={() => dispatch({ type: "SET_EXPANDED", payload: true })}
            onFileSelect={handleFileSelect}
            onFilePickerClose={handleFilePickerClose}
            // 🔧 Mac 输入法兼容
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => {
              setIsComposing(false);
              compositionEndTimeRef.current = Date.now(); // 记录时间戳用于冷却期
            }}
            // 🆕 Prompt Suggestions
            suggestion={suggestion}
            isSuggestionLoading={isSuggestionLoading}
            enableSuggestion={enablePromptSuggestion}
            // 🆕 斜杠命令菜单
            showSlashCommandMenu={showSlashCommandMenu}
            slashCommandQuery={slashCommandQuery}
            slashCommandSelectedIndex={slashCommandSelectedIndex}
            onSlashCommandSelect={handleSlashCommandSelect}
            onSlashCommandMenuClose={closeSlashCommandMenu}
            onSlashCommandSelectedIndexChange={setSlashCommandSelectedIndex}
            customSlashCommands={allCustomCommands}
            engine={currentEngine}
          />

          <ControlBar
            disabled={disabled}
            isLoading={isLoading}
            prompt={state.prompt}
            hasAttachments={imageAttachments.length > 0}
            executionEngineConfig={state.executionEngineConfig}
            setExecutionEngineConfig={(config) => dispatch({ type: "SET_EXECUTION_ENGINE_CONFIG", payload: config })}
            selectedModel={state.selectedModel}
            setSelectedModel={(model) => dispatch({ type: "SET_MODEL", payload: model })}
            availableModels={availableModels}
            selectedThinkingMode={state.selectedThinkingMode}
            selectedThinkingEffort={state.selectedThinkingEffort}
            handleToggleThinkingMode={handleToggleThinkingMode}
            isPlanMode={isPlanMode}
            onTogglePlanMode={onTogglePlanMode}
            hasMessages={hasMessages}
            sessionCost={sessionCost}
            sessionStats={sessionStats}
            showCostPopover={state.showCostPopover}
            setShowCostPopover={(show) => dispatch({ type: "SET_SHOW_COST_POPOVER", payload: show })}
            messages={messages}
            session={session}
            codexRateLimits={codexRateLimits}
            isEnhancing={isEnhancing}
            projectPath={projectPath}
            enableProjectContext={state.enableProjectContext}
            setEnableProjectContext={(enable) => dispatch({ type: "SET_ENABLE_PROJECT_CONTEXT", payload: enable })}
            enableDualAPI={enableDualAPI}
            setEnableDualAPI={setEnableDualAPI}
            getEnabledProviders={getEnabledProviders}
            handleEnhancePromptWithAPI={handleEnhancePromptWithAPI}
            onCancel={onCancel || (() => {})}
            onSend={handleSend}
          />
        </div>
      </div>
    </>
  );
};

export const FloatingPromptInput = forwardRef(FloatingPromptInputInner);
