import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronDown,
  ChevronUp,
  X,
  List
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, type Session, type Project } from "@/lib/api";
import { cn } from "@/lib/utils";
import { type UnlistenFn } from "@tauri-apps/api/event";
import { FloatingPromptInput, type FloatingPromptInputRef, type ModelType } from "./FloatingPromptInput";
import { ErrorBoundary } from "./ErrorBoundary";
import { RevertPromptPicker } from "./RevertPromptPicker";
import { PromptNavigator } from "./PromptNavigator";
import { SplitPane } from "@/components/ui/split-pane";
import { WebviewPreview } from "./WebviewPreview";
import { type TranslationResult } from '@/lib/translationMiddleware';
import { useSessionCostCalculation } from '@/hooks/useSessionCostCalculation';
import { useDisplayableMessages } from '@/hooks/useDisplayableMessages';
import { useGroupedMessages } from '@/hooks/useGroupedMessages';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useSmartAutoScroll } from '@/hooks/useSmartAutoScroll';
import { useMessageTranslation } from '@/hooks/useMessageTranslation';
import { useSessionStream } from '@/hooks/useSessionStream';
import { usePromptExecution } from '@/hooks/usePromptExecution';
import { MessagesProvider, useMessagesContext } from '@/contexts/MessagesContext';
import { SessionProvider } from '@/contexts/SessionContext';
import { PlanModeProvider, usePlanMode } from '@/contexts/PlanModeContext';
import { PlanApprovalDialog } from '@/components/dialogs/PlanApprovalDialog';
import { PlanModeStatusBar } from '@/components/widgets/system/PlanModeStatusBar';
import { UserQuestionProvider, useUserQuestion } from '@/contexts/UserQuestionContext';
import { AskUserQuestionDialog } from '@/components/dialogs/AskUserQuestionDialog';
import { codexConverter } from '@/lib/codexConverter';
import { convertGeminiSessionDetailToClaudeMessages } from '@/lib/geminiConverter';
import { SessionHeader } from "./session/SessionHeader";
import { SessionMessages, type SessionMessagesRef } from "./session/SessionMessages";

import * as SessionHelpers from '@/lib/sessionHelpers';

import type { ClaudeStreamMessage } from '@/types/claude';
import type { CodexRateLimits } from '@/types/codex';

interface ClaudeCodeSessionProps {
  /**
   * Optional session to resume (when clicking from SessionList)
   */
  session?: Session;
  /**
   * Initial project path (for new sessions)
   */
  initialProjectPath?: string;
  /**
   * Optional className for styling
   */
  className?: string;
  /**
   * Callback when streaming state changes
   */
  onStreamingChange?: (isStreaming: boolean, sessionId: string | null) => void;
  /**
   * Callback when project path changes (for updating tab title)
   */
  onProjectPathChange?: (newPath: string) => void;
  /**
   * 🆕 Callback when execution engine changes (for updating tab icon)
   */
  onEngineChange?: (engine: 'claude' | 'codex' | 'gemini') => void;
  /**
   * 🔧 FIX: Callback when session info is extracted (for persisting new session to tab)
   * Called when a new session receives its sessionId and projectId from backend
   */
  onSessionInfoChange?: (info: { sessionId: string; projectId: string; projectPath: string; engine?: 'claude' | 'codex' | 'gemini' }) => void;
  /**
   * Whether this session is currently active (for event listener management)
   */
  isActive?: boolean;
}

/**
 * ClaudeCodeSession component for interactive Claude Code sessions
 * 
 * @example
 * <ClaudeCodeSession onBack={() => setView('projects')} />
 */
const ClaudeCodeSessionInner: React.FC<ClaudeCodeSessionProps> = ({
  session,
  initialProjectPath = "",
  className,
  onStreamingChange,
  onProjectPathChange,
  onEngineChange,
  onSessionInfoChange,
  isActive = true, // 默认为活跃状态，保持向后兼容
}) => {
  const { t } = useTranslation();
  const [projectPath, setProjectPath] = useState(initialProjectPath || session?.project_path || "");
  const [recentProjects, setRecentProjects] = useState<Project[]>([]);
  const {
    messages,
    setMessages,
    isStreaming,
    setIsStreaming,
    filterConfig,
    setFilterConfig
  } = useMessagesContext();
  const isLoading = isStreaming;
  const setIsLoading = setIsStreaming;
  const [error, setError] = useState<string | null>(null);
  const [_rawJsonlOutput, setRawJsonlOutput] = useState<string[]>([]); // Kept for hooks, not directly used
  const [isFirstPrompt, setIsFirstPrompt] = useState(!session); // Key state for session continuation
  const [extractedSessionInfo, setExtractedSessionInfo] = useState<{ sessionId: string; projectId: string; engine?: 'claude' | 'codex' | 'gemini' } | null>(null);
  // 🔧 FIX: 标记会话是否不存在（历史记录文件未找到）
  // 当为 true 时，effectiveSession 应返回 null，显示路径选择界面
  const [sessionNotFound, setSessionNotFound] = useState(false);
  const [claudeSessionId, setClaudeSessionId] = useState<string | null>(null);
  const [codexRateLimits, setCodexRateLimits] = useState<CodexRateLimits | null>(null);

  // 🔧 FIX: Track whether this component instance was created as a "new session" (no session prop).
  // When true, we must NOT auto-load/resume any session even if the session prop later
  // becomes defined (due to TabSessionWrapper memo allowing re-render on isActive change
  // after the tab's session was upgraded via updateTabSession).
  const wasCreatedAsNewSessionRef = useRef(!session);

  // Plan Mode state - 使用 Context（方案 B-1）
  const {
    isPlanMode,
    setIsPlanMode,
    showApprovalDialog,
    pendingApproval,
    approvePlan,
    rejectPlan,
    closeApprovalDialog,
    setSendPromptCallback,
  } = usePlanMode();

  // 🆕 UserQuestion Context - 用户问答交互
  const {
    pendingQuestion,
    showQuestionDialog,
    submitAnswers,
    closeQuestionDialog,
    setSendMessageCallback,
  } = useUserQuestion();

  // 🆕 Execution Engine Config (Codex integration)
  // Load from localStorage to remember user's settings
  const [executionEngineConfig, setExecutionEngineConfig] = useState<import('@/components/FloatingPromptInput/types').ExecutionEngineConfig>(() => {
    try {
      const stored = localStorage.getItem('execution_engine_config');
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      console.error('[ClaudeCodeSession] Failed to load engine config from localStorage:', error);
    }
    // Default config
    return {
      engine: 'claude',
      codexMode: 'read-only',
      codexModel: 'gpt-5.5',
      geminiModel: 'auto-gemini-3',
    };
  });

  // Queued prompts state
  const [queuedPrompts, setQueuedPrompts] = useState<Array<{ id: string; prompt: string; model: ModelType }>>([]);

  // State for revert prompt picker (defined early for useKeyboardShortcuts)
  const [showRevertPicker, setShowRevertPicker] = useState(false);

  // State for prompt navigator
  const [showPromptNavigator, setShowPromptNavigator] = useState(false);

  // Settings state to avoid repeated loading in StreamMessage components
  const [claudeSettings, setClaudeSettings] = useState<{ 
    showSystemInitialization?: boolean;
    hideWarmupMessages?: boolean;
  }>({});

  // ✅ Refactored: Use custom Hook for session cost calculation
  const { stats: costStats, formatCost } = useSessionCostCalculation(messages, executionEngineConfig.engine);

  // ✅ Refactored: Use custom Hook for message filtering
  useEffect(() => {
    setFilterConfig(prev => {
      const hideWarmup = claudeSettings?.hideWarmupMessages !== false;
      if (prev.hideWarmupMessages === hideWarmup) {
        return prev;
      }
      return {
        ...prev,
        hideWarmupMessages: hideWarmup
      };
    });
  }, [claudeSettings?.hideWarmupMessages, setFilterConfig]);

  // 🆕 Notify parent when execution engine changes (for tab icon update)
  useEffect(() => {
    if (onEngineChange) {
      onEngineChange(executionEngineConfig.engine);
    }
  }, [executionEngineConfig.engine, onEngineChange]);

  // 🔧 FIX: Notify parent when session info is extracted (for new session persistence)
  // This fixes the issue where new session messages are lost after route switch
  useEffect(() => {
    if (extractedSessionInfo && onSessionInfoChange && projectPath) {
      console.debug('[ClaudeCodeSession] Session info extracted, notifying parent:', extractedSessionInfo);
      onSessionInfoChange({
        sessionId: extractedSessionInfo.sessionId,
        projectId: extractedSessionInfo.projectId,
        projectPath: projectPath,
        engine: extractedSessionInfo.engine,
      });
    }
  }, [extractedSessionInfo, projectPath, onSessionInfoChange]);

  const displayableMessages = useDisplayableMessages(messages, {
    hideWarmupMessages: filterConfig.hideWarmupMessages
  });

  // 🆕 将消息分组（处理子代理消息）
  const messageGroups = useGroupedMessages(displayableMessages, {
    enableSubagentGrouping: true
  });

  // Stable callback for toggling plan mode (prevents unnecessary event listener re-registration)
  const handleTogglePlanMode = useCallback(() => {
    setIsPlanMode(!isPlanMode);
  }, [isPlanMode, setIsPlanMode]);

  // Stable callback for showing revert dialog
  const handleShowRevertDialog = useCallback(() => {
    setShowRevertPicker(true);
  }, []);

  // ✅ Refactored: Use custom Hook for keyboard shortcuts
  useKeyboardShortcuts({
    isActive,
    onTogglePlanMode: handleTogglePlanMode,
    onShowRevertDialog: handleShowRevertDialog,
    hasDialogOpen: showRevertPicker
  });

  // ✅ Refactored: Use custom Hook for smart auto-scroll
  const { parentRef, userScrolled, setUserScrolled, setShouldAutoScroll } =
    useSmartAutoScroll({
      displayableMessages,
      isLoading
    });

  // Fix: Scroll to bottom when session history is loaded
  // Also re-trigger when message count changes significantly (e.g., streaming adds many messages)
  const hasScrolledToBottomRef = useRef<string | null>(null);
  const lastScrolledMessageCountRef = useRef(0);

  useEffect(() => {
    // Check if we have messages and parentRef is attached
    if (displayableMessages.length > 0 && parentRef.current) {
      const currentSessionId = session?.id || 'new_session';
      const currentCount = displayableMessages.length;

      // Determine if we should scroll:
      // 1. First time for this session (initial history load)
      const isFirstTimeForSession = hasScrolledToBottomRef.current !== currentSessionId;
      // 2. Message count jumped significantly (e.g., streaming added many messages at once)
      const countDelta = currentCount - lastScrolledMessageCountRef.current;
      const significantCountChange = lastScrolledMessageCountRef.current > 0 && countDelta >= 5;

      if (isFirstTimeForSession || significantCountChange) {
        // Use a small delay to ensure virtualizer has calculated sizes
        const timer = setTimeout(() => {
          if (parentRef.current) {
            // Force scroll to bottom
            parentRef.current.scrollTop = parentRef.current.scrollHeight;

            // Sync with smart auto-scroll state
            setUserScrolled(false);
            setShouldAutoScroll(true);

            // Mark as done for this session
            hasScrolledToBottomRef.current = currentSessionId;
            lastScrolledMessageCountRef.current = currentCount;

            // Schedule a follow-up scroll to handle virtualizer re-measurements
            setTimeout(() => {
              if (parentRef.current) {
                parentRef.current.scrollTop = parentRef.current.scrollHeight;
              }
            }, 200);
          }
        }, 150); // 150ms delay for stability

        return () => clearTimeout(timer);
      }
    }
  }, [displayableMessages.length, session?.id, setUserScrolled, setShouldAutoScroll]);

  // ============================================================================
  // MESSAGE-LEVEL OPERATIONS (Fine-grained Undo/Redo)
  // ============================================================================
  // Operations extracted to useMessageOperations Hook

  // New state for preview feature
  const [showPreview, setShowPreview] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  
  // Translation state
  const [lastTranslationResult, setLastTranslationResult] = useState<TranslationResult | null>(null);
  const [showPreviewPrompt, setShowPreviewPrompt] = useState(false);
  const [splitPosition, setSplitPosition] = useState(50);
  const [isPreviewMaximized, setIsPreviewMaximized] = useState(false);

  // Add collapsed state for queued prompts
  const [queuedPromptsCollapsed, setQueuedPromptsCollapsed] = useState(false);

  // ✅ All refs declared BEFORE custom Hooks that depend on them
  const unlistenRefs = useRef<UnlistenFn[]>([]);
  const hasActiveSessionRef = useRef(false);
  const floatingPromptRef = useRef<FloatingPromptInputRef>(null);
  const sessionMessagesRef = useRef<SessionMessagesRef>(null);
  const queuedPromptsRef = useRef<Array<{ id: string; prompt: string; model: ModelType }>>([]);
  const isMountedRef = useRef(true);
  const isListeningRef = useRef(false);

  // ✅ Refactored: Use custom Hook for message translation (AFTER refs are declared)
  const {
    processMessageWithTranslation,
    initializeProgressiveTranslation,
  } = useMessageTranslation({
    isMountedRef,
    lastTranslationResult: lastTranslationResult || undefined,
    onMessagesUpdate: setMessages
  });

  // 🔧 FIX: 处理会话历史不存在的情况，重置到初始状态
  const handleSessionNotFound = useCallback(() => {
    console.debug('[ClaudeCodeSession] Session not found, resetting to initial state');
    setSessionNotFound(true);
    // 重置为新会话状态
    setIsFirstPrompt(true);
  }, []);

  // ✅ 新架构: 使用 useSessionStream（基于 AsyncQueue + ConverterRegistry）
  const {
    loadSessionHistory,
    checkForActiveSession,
    // reconnectToSession removed - listeners now persist across tab switches
    // messageQueue - 新增：消息队列，支持 for await...of 消费
  } = useSessionStream({
    session,
    isMountedRef,
    isListeningRef,
    hasActiveSessionRef,
    unlistenRefs,
    setIsLoading,
    setError,
    setMessages,
    setRawJsonlOutput,
    setClaudeSessionId,
    setCodexRateLimits,
    initializeProgressiveTranslation,
    processMessageWithTranslation,
    onSessionNotFound: handleSessionNotFound,
    // 🔧 FIX: Pass isNewSessionInstance flag to prevent auto-loading/reconnecting
    // when the session prop later gets upgraded (after tab session update + isActive change).
    isNewSessionInstance: wasCreatedAsNewSessionRef.current,
  });

  // Keep ref in sync with state
  useEffect(() => {
    queuedPromptsRef.current = queuedPrompts;
  }, [queuedPrompts]);

  // 🔧 NEW: Notify parent when project path changes (for tab title update)
  useEffect(() => {
    // Only notify if projectPath is valid and not the initial placeholder
    if (projectPath && projectPath !== initialProjectPath && onProjectPathChange) {
      onProjectPathChange(projectPath);
    }
  }, [projectPath, initialProjectPath, onProjectPathChange]);

  // ⚡ PERFORMANCE FIX: Git 初始化延迟到真正需要时
  // 原问题：每次加载会话都立即执行 git init + git add + git commit
  // 在大项目中，git add . 可能需要数秒，导致会话加载卡顿
  // 解决方案：只在发送提示词时才初始化 Git（在 recordPromptSent 中已有）
  // useEffect(() => {
  //   if (!projectPath) return;
  //   api.checkAndInitGit(projectPath).then(...);
  // }, [projectPath]);

  // Get effective session info (from prop or extracted) - use useMemo to ensure it updates
  const effectiveSession = useMemo(() => {
    // 🔧 FIX: 当会话历史不存在时，返回 null 以显示路径选择界面
    // 这处理了从 localStorage 恢复的无效会话（历史文件已删除或不存在）
    if (sessionNotFound) {
      return null;
    }
    if (session) return session;
    if (extractedSessionInfo) {
      return {
        id: extractedSessionInfo.sessionId,
        project_id: extractedSessionInfo.projectId,
        project_path: projectPath,
        created_at: Date.now(),
        engine: extractedSessionInfo.engine, // 🔧 FIX: Include engine field
      } as Session;
    }
    return null;
  }, [session, extractedSessionInfo, projectPath, sessionNotFound]);

  useEffect(() => {
    if (executionEngineConfig.engine !== 'codex') {
      setCodexRateLimits(null);
      return;
    }

    setCodexRateLimits(null);
  }, [executionEngineConfig.engine, effectiveSession?.id]);

  // ✅ Refactored: Use custom Hook for prompt execution (AFTER all other Hooks)
  const { handleSendPrompt } = usePromptExecution({
    projectPath,
    isLoading,
    claudeSessionId,
    effectiveSession,
    isPlanMode,
    lastTranslationResult,
    isActive,
    isFirstPrompt,
    extractedSessionInfo,
    executionEngine: executionEngineConfig.engine, // 🆕 Codex integration
    codexMode: executionEngineConfig.codexMode,    // 🆕 Codex integration
    codexModel: executionEngineConfig.codexModel,  // 🆕 Codex integration
    codexReasoningLevel: executionEngineConfig.codexReasoningLevel, // 🆕 Codex integration
    geminiModel: executionEngineConfig.geminiModel,           // 🆕 Gemini integration
    geminiApprovalMode: executionEngineConfig.geminiApprovalMode, // 🆕 Gemini integration
    hasActiveSessionRef,
    unlistenRefs,
    isMountedRef,
    isListeningRef,
    queuedPromptsRef,
    setIsLoading,
    setError,
    setMessages,
    setClaudeSessionId,
    setLastTranslationResult,
    setQueuedPrompts,
    setRawJsonlOutput,
    setExtractedSessionInfo,
    setIsFirstPrompt,
    setCodexRateLimits,
    processMessageWithTranslation
  });

  // 🆕 包装 handleSendPrompt，发送消息时自动滚动到底部
  // 解决问题：当用户滚动查看历史消息后发送新消息，页面不会自动滚动到底部
  // 🔧 修复：消息数量过多时使用虚拟列表的 scrollToIndex 确保滚动到真正的底部
  const handleSendPromptWithScroll = useCallback((prompt: string, model: ModelType, maxThinkingTokens?: number) => {
    // 重置滚动状态，确保发送消息后自动滚动到底部
    setUserScrolled(false);
    setShouldAutoScroll(true);

    // 使用虚拟列表的 scrollToBottom 方法，解决消息过多时 scrollHeight 估算不准的问题
    // 延迟执行，等待消息添加到列表后再滚动
    setTimeout(() => {
      sessionMessagesRef.current?.scrollToBottom();
    }, 50);

    handleSendPrompt(prompt, model, maxThinkingTokens);
  }, [handleSendPrompt, setUserScrolled, setShouldAutoScroll]);

  // 🆕 方案 B-1: 设置发送提示词回调，用于计划批准后自动执行
  useEffect(() => {
    // 创建一个简化的发送函数，只需要 prompt 参数
    const simpleSendPrompt = (prompt: string) => {
      handleSendPromptWithScroll(prompt, 'default'); // 使用 Claude Code 默认模型
    };
    setSendPromptCallback(simpleSendPrompt);

    // 清理时移除回调
    return () => {
      setSendPromptCallback(null);
    };
  }, [handleSendPromptWithScroll, setSendPromptCallback]);

  // 🆕 设置 UserQuestion 的发送消息回调，用于答案提交后自动发送
  useEffect(() => {
    const simpleSendMessage = (message: string) => {
      handleSendPromptWithScroll(message, 'default'); // 使用 Claude Code 默认模型
    };
    setSendMessageCallback(simpleSendMessage);

    // 清理时移除回调
    return () => {
      setSendMessageCallback(null);
    };
  }, [handleSendPromptWithScroll, setSendMessageCallback]);

  // Load recent projects when component mounts (only for new sessions)
  useEffect(() => {
    if (!session && !initialProjectPath) {
      const loadRecentProjects = async () => {
        try {
          const projects = await api.listProjects();
          // Sort by created_at (latest first) and take top 5
          const sortedProjects = projects
            .sort((a, b) => b.created_at - a.created_at)
            .slice(0, 5);
          setRecentProjects(sortedProjects);
        } catch (error) {
          console.error("Failed to load recent projects:", error);
        }
      };
      loadRecentProjects();
    }
  }, [session, initialProjectPath]);

  // Load session history if resuming
  useEffect(() => {
    if (session) {
      // 🔧 FIX: If this component was created as a new session (session prop was initially undefined),
      // do NOT auto-load history when the session prop later becomes defined.
      // This happens when TabSessionWrapper re-renders due to isActive change after the tab's
      // session was upgraded via updateTabSession. The component already has the correct
      // messages from streaming - re-loading history would overwrite them and cause the
      // "reverting to restoring latest session" bug.
      if (wasCreatedAsNewSessionRef.current) {
        // Check if this session was extracted by this component instance
        if (extractedSessionInfo && extractedSessionInfo.sessionId === session.id) {
          console.debug('[ClaudeCodeSession] Skipping session load - session was created by this instance:', session.id);
          return;
        }
        // If extractedSessionInfo doesn't match, this is a genuinely different session prop
        // (shouldn't happen in current architecture, but handle defensively)
        if (!extractedSessionInfo) {
          console.debug('[ClaudeCodeSession] Skipping session load - new session instance, no extracted info yet');
          return;
        }
      }

      // Set the claudeSessionId immediately when we have a session
      setClaudeSessionId(session.id);

      // 🆕 Auto-switch execution engine based on session type
      const sessionEngine = (session as any).engine;

      if (sessionEngine === 'codex') {
        setExecutionEngineConfig(prev => ({
          ...prev,
          engine: 'codex' as const,
        }));
      } else if (sessionEngine === 'gemini') {
        setExecutionEngineConfig(prev => ({
          ...prev,
          engine: 'gemini' as const,
        }));
      } else {
        setExecutionEngineConfig(prev => ({
          ...prev,
          engine: 'claude',
        }));
      }

      // Load session history first, then check for active session
      const initializeSession = async () => {
        await loadSessionHistory();
        // After loading history, check if the session is still active
        if (isMountedRef.current) {
          await checkForActiveSession();
        }
      };

      initializeSession();
    }
  }, [session]); // Remove hasLoadedSession dependency to ensure it runs on mount

  // Load Claude settings once for all StreamMessage components
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await api.getClaudeSettings();
        setClaudeSettings(settings);
      } catch (error) {
        console.error("Failed to load Claude settings:", error);
        setClaudeSettings({ 
          showSystemInitialization: true,
          hideWarmupMessages: true // Default: hide warmup messages for better UX
        }); // Default fallback
      }
    };

    loadSettings();
  }, []);

  // Report streaming state changes
  useEffect(() => {
    onStreamingChange?.(isLoading, claudeSessionId);
  }, [isLoading, claudeSessionId, onStreamingChange]);

  // 🔧 FIX: When a tab becomes active (visible), re-verify session running state
  // Listeners persist across tab switches (DO NOT clean up on tab switch).
  // But we need to:
  // 1. Re-report the current streaming state to the parent so the tab indicator is accurate
  // 2. Re-check if the session is still running (in case events were missed while in background)
  //
  // Listeners are automatically cleaned up when:
  // - Session completes (in processComplete/processCodexComplete)
  // - Component unmounts (in the cleanup effect below)
  //
  // Multi-tab conflict is prevented by:
  // - Message deduplication (processedClaudeMessages/processedCodexMessages Set)
  // - isMountedRef check in message handlers
  // - Session-specific event channels (claude-output:{session_id})
  useEffect(() => {
    if (isActive && session) {
      // Re-report the current streaming state to ensure the tab indicator is in sync.
      // This handles the case where the state changed in the background but the
      // parent tab manager did not receive the update.
      onStreamingChange?.(isLoading, claudeSessionId);

      // If we are not already listening to session events, re-check whether the
      // session is still actively running. This reconnects listeners if the session
      // is alive but we lost our connection (e.g., after app restart or missed events).
      if (!isListeningRef.current) {
        checkForActiveSession();
      }
    }
  }, [isActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // ✅ Keyboard shortcuts (ESC, Shift+Tab) extracted to useKeyboardShortcuts Hook

  // ✅ Smart scroll management (3 useEffect blocks) extracted to useSmartAutoScroll Hook

  // ✅ Session lifecycle functions (loadSessionHistory, checkForActiveSession, reconnectToSession)
  // are now provided by useSessionStream Hook (新架构)

  const handleSelectPath = async () => {
    try {
      const selected = await SessionHelpers.selectProjectPath();

      if (selected) {
        setProjectPath(selected);
        setError(null);
      }
    } catch (err) {
      console.error("Failed to select directory:", err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
    }
  };

  // ✅ handleSendPrompt function is now provided by usePromptExecution Hook (line 207-234)

  // Get conversation context for prompt enhancement
  // 🔧 FIX: Use useCallback to ensure getConversationContext always uses the latest messages
  // This fixes the issue where prompt enhancement doesn't work in historical sessions
  const getConversationContext = useCallback((): string[] => {
    return SessionHelpers.getConversationContext(messages);
  }, [messages]);

  const handleCancelExecution = async () => {
    if (!isLoading) return;

    try {
      // 🆕 根据执行引擎调用相应的取消方法
      if (executionEngineConfig.engine === 'codex') {
        await api.cancelCodex(claudeSessionId || undefined);
      } else {
        await api.cancelClaudeExecution(claudeSessionId || undefined);
      }
      
      // Clean up listeners
      unlistenRefs.current.forEach(unlisten => unlisten && typeof unlisten === 'function' && unlisten());
      unlistenRefs.current = [];
      
      // Reset states
      setIsLoading(false);
      hasActiveSessionRef.current = false;
      isListeningRef.current = false;
      setError(null);
      
      // Reset session state on cancel
      setClaudeSessionId(null);
      
      // Clear queued prompts
      setQueuedPrompts([]);
      
      // Add a message indicating the session was cancelled
      const cancelMessage: ClaudeStreamMessage = {
        type: "system",
        subtype: "info",
        result: "__USER_CANCELLED__", // Will be translated in render
        timestamp: new Date().toISOString(),
        receivedAt: new Date().toISOString()
      };
      setMessages(prev => [...prev, cancelMessage]);
    } catch (err) {
      console.error("Failed to cancel execution:", err);
      
      // Even if backend fails, we should update UI to reflect stopped state
      // Add error message but still stop the UI loading state
      const errorMessage: ClaudeStreamMessage = {
        type: "system",
        subtype: "error",
        result: `Failed to cancel execution: ${err instanceof Error ? err.message : 'Unknown error'}. The process may still be running in the background.`,
        timestamp: new Date().toISOString(),
        receivedAt: new Date().toISOString()
      };
      setMessages(prev => [...prev, errorMessage]);
      
      // Clean up listeners anyway
      unlistenRefs.current.forEach(unlisten => unlisten && typeof unlisten === 'function' && unlisten());
      unlistenRefs.current = [];
      
      // Reset states to allow user to continue
      setIsLoading(false);
      hasActiveSessionRef.current = false;
      isListeningRef.current = false;
      setError(null);
    }
  };

  // Handle URL detection from terminal output
  const handleLinkDetected = (url: string) => {
    const currentState: SessionHelpers.PreviewState = {
      showPreview,
      showPreviewPrompt,
      previewUrl,
      isPreviewMaximized,
      splitPosition
    };
    const newState = SessionHelpers.handleLinkDetected(url, currentState);
    if (newState.previewUrl !== currentState.previewUrl) {
      setPreviewUrl(newState.previewUrl);
    }
    if (newState.showPreviewPrompt !== currentState.showPreviewPrompt) {
      setShowPreviewPrompt(newState.showPreviewPrompt);
    }
  };

  const handleClosePreview = () => {
    const currentState: SessionHelpers.PreviewState = {
      showPreview,
      showPreviewPrompt,
      previewUrl,
      isPreviewMaximized,
      splitPosition
    };
    const newState = SessionHelpers.handleClosePreview(currentState);
    setShowPreview(newState.showPreview);
    setIsPreviewMaximized(newState.isPreviewMaximized);
  };

  const handlePreviewUrlChange = (url: string) => {
    const currentState: SessionHelpers.PreviewState = {
      showPreview,
      showPreviewPrompt,
      previewUrl,
      isPreviewMaximized,
      splitPosition
    };
    const newState = SessionHelpers.handlePreviewUrlChange(url, currentState);
    setPreviewUrl(newState.previewUrl);
  };

  const handleTogglePreviewMaximize = () => {
    const currentState: SessionHelpers.PreviewState = {
      showPreview,
      showPreviewPrompt,
      previewUrl,
      isPreviewMaximized,
      splitPosition
    };
    const newState = SessionHelpers.handleTogglePreviewMaximize(currentState);
    setIsPreviewMaximized(newState.isPreviewMaximized);
    setSplitPosition(newState.splitPosition);
  };

  // 🆕 辅助函数：计算用户消息对应的 promptIndex
  // 只计算真实用户输入，排除系统消息和工具结果
  const getPromptIndexForMessage = useCallback((displayableIndex: number): number => {
    // 找到 displayableMessages[displayableIndex] 在 messages 中的实际位置
    const displayableMessage = displayableMessages[displayableIndex];
    const actualIndex = messages.findIndex(m => m === displayableMessage);
    
    if (actualIndex === -1) return -1;
    
    // 计算这是第几条真实用户消息（排除 Warmup/System 和纯工具结果消息）
    // 这个逻辑必须和后端 prompt_tracker.rs 完全一致！
    return messages.slice(0, actualIndex + 1)
      .filter(m => {
        // 只处理 user 类型消息
        if (m.type !== 'user') return false;
        
        // 检查是否是侧链消息（agent 消息）- 与后端一致
        const isSidechain = (m as any).isSidechain === true;
        if (isSidechain) {
          return false;
        }
        
        // 检查是否有 parent_tool_use_id（子代理的消息）- 与后端一致
        const hasParentToolUseId = (m as any).parent_tool_use_id !== null && (m as any).parent_tool_use_id !== undefined;
        if (hasParentToolUseId) {
          return false;
        }
        
        // 提取消息文本（处理字符串和数组两种格式）
        const content = m.message?.content;
        let text = '';
        let hasTextContent = false;
        let hasToolResult = false;
        
        if (typeof content === 'string') {
          text = content;
          hasTextContent = text.trim().length > 0;
        } else if (Array.isArray(content)) {
          // 提取所有 text 类型的内容
          const textItems = content.filter((item: any) => item.type === 'text');
          text = textItems.map((item: any) => item.text || '').join('');
          hasTextContent = textItems.length > 0 && text.trim().length > 0;
          
          // 检查是否有 tool_result
          hasToolResult = content.some((item: any) => item.type === 'tool_result');
        }
        
        // 如果只有 tool_result 没有 text，不计入（这些是工具执行的结果）
        if (hasToolResult && !hasTextContent) {
          return false;
        }
        
        // 必须有文本内容
        if (!hasTextContent) {
          return false;
        }
        
        // 排除自动发送的 Warmup 和 Skills 消息
        // 这个逻辑要和后端 prompt_tracker.rs 保持一致
        const isWarmupMessage = text.includes('Warmup');
        const isSkillMessage = text.includes('<command-name>') 
          || text.includes('Launching skill:')
          || text.includes('skill is running');
        return !isWarmupMessage && !isSkillMessage;
      })
      .length - 1;
  }, [messages, displayableMessages]);


  // 🆕 撤回处理函数 - 支持三种撤回模式
  // Handle prompt navigation - scroll to specific prompt
  const handlePromptNavigation = useCallback((promptIndex: number) => {
    if (sessionMessagesRef.current) {
      sessionMessagesRef.current.scrollToPrompt(promptIndex);
    }
    // Close navigator after navigation
    setShowPromptNavigator(false);
  }, []);

  const handleRevert = useCallback(async (promptIndex: number, mode: import('@/lib/api').RewindMode = 'both') => {
    if (!effectiveSession) return;

    try {

      const sessionEngine = effectiveSession.engine || executionEngineConfig.engine || 'claude';
      const isCodex = sessionEngine === 'codex';
      const isGemini = sessionEngine === 'gemini';

      // 调用后端撤回（返回提示词文本）
      const promptText = isCodex
        ? await api.revertCodexToPrompt(
            effectiveSession.id,
            projectPath,
            promptIndex,
            mode
          )
        : isGemini
        ? await api.revertGeminiToPrompt(
            effectiveSession.id,
            projectPath,
            promptIndex,
            mode
          )
        : await api.revertToPrompt(
            effectiveSession.id,
            effectiveSession.project_id,
            projectPath,
            promptIndex,
            mode
          );

      // 重新加载消息历史（根据引擎类型使用不同的 API）
      if (isGemini) {
        // Gemini 使用专门的 API 加载历史
        const geminiDetail = await api.getGeminiSessionDetail(projectPath, effectiveSession.id);
        setMessages(convertGeminiSessionDetailToClaudeMessages(geminiDetail) as any);
      } else {
        // Claude/Codex 使用原有 API
        const history = await api.loadSessionHistory(
          effectiveSession.id,
          effectiveSession.project_id,
          sessionEngine as any
        );

        if (sessionEngine === 'codex' && Array.isArray(history)) {
          // 将 Codex 事件转换为消息格式（与 useSessionStream 保持一致）
          codexConverter.reset();
          const convertedMessages: any[] = [];
          for (const event of history) {
            const msg = codexConverter.convertEventObject(event as any);
            if (msg) convertedMessages.push(msg);
          }
          setMessages(convertedMessages);
        } else if (Array.isArray(history)) {
          setMessages(history);
        } else if (history && typeof history === 'object' && 'messages' in history) {
          setMessages((history as any).messages);
        }
      }

      // 恢复提示词到输入框（仅在对话撤回模式下）
      if ((mode === 'conversation_only' || mode === 'both') && floatingPromptRef.current && promptText) {
        floatingPromptRef.current.setPrompt(promptText);
      }

      // 清除错误
      setError('');

    } catch (error) {
      console.error('[Prompt Revert] Failed to revert:', error);
      setError('__REVERT_FAILED__:' + error);
    }
  }, [effectiveSession, projectPath, claudeSettings?.hideWarmupMessages, executionEngineConfig.engine]);

  // Cleanup event listeners and track mount state
  // ⚠️ IMPORTANT: No dependencies! Only cleanup on real unmount
  // Adding dependencies like effectiveSession would cause cleanup to run
  // when session ID is extracted, clearing active listeners
  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      isListeningRef.current = false;

      // Clean up listeners
      unlistenRefs.current.forEach(unlisten => unlisten && typeof unlisten === 'function' && unlisten());
      unlistenRefs.current = [];

      // Reset session state on unmount
      setClaudeSessionId(null);
    };
  }, []); // Empty deps - only run on mount/unmount

  // ✅ 架构优化: 使用 SessionProvider 提供会话上下文，避免 Props Drilling
  const messagesList = (
    <SessionProvider
      session={effectiveSession}
      projectPath={projectPath}
      sessionId={effectiveSession?.id || null}
      projectId={effectiveSession?.project_id || null}
      settings={claudeSettings}
      onLinkDetected={handleLinkDetected}
      onRevert={handleRevert}
      getPromptIndexForMessage={getPromptIndexForMessage}
    >
      <SessionMessages
        ref={sessionMessagesRef}
        messageGroups={messageGroups}
        isLoading={isLoading}
        error={error}
        parentRef={parentRef}
        onCancel={handleCancelExecution}
      />
    </SessionProvider>
  );

  // Determine if we're in "new session" mode (no session yet, showing project picker)
  // In this mode, the page content should be scrollable as a whole
  const isNewSessionMode = !effectiveSession && displayableMessages.length === 0;

  // Show project path input only when:
  // 1. No initial session prop AND
  // 2. No extracted session info (from successful first response)
  const projectPathInput = !effectiveSession && (
    <SessionHeader
      projectPath={projectPath}
      setProjectPath={(path) => {
        setProjectPath(path);
        setError(null);
      }}
      handleSelectPath={handleSelectPath}
      recentProjects={recentProjects}
      isLoading={isLoading}
    />
  );

  // If preview is maximized, render only the WebviewPreview in full screen
  if (showPreview && isPreviewMaximized) {
    return (
      <AnimatePresence>
        <motion.div 
          className="fixed inset-0 z-50 bg-background"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <WebviewPreview
            initialUrl={previewUrl}
            onClose={handleClosePreview}
            isMaximized={isPreviewMaximized}
            onToggleMaximize={handleTogglePreviewMaximize}
            onUrlChange={handlePreviewUrlChange}
            className="h-full"
          />
        </motion.div>
      </AnimatePresence>
    );
  }

  return (
    <div className={cn("flex h-full bg-background", className)}>
      {/* Main Content Area - 重构布局：使用 Flexbox 实现消息区域与输入区域的完全分离 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 消息展示区域容器 - flex-1 占据剩余空间，min-h-0 防止 flex 子元素溢出 */}
        {/* When in new session mode, allow the content to scroll so the user
            can reach all recent projects. In active session mode, overflow is
            hidden and the virtualised message list handles its own scrolling. */}
        <div className={cn(
          "flex-1 min-h-0 transition-all duration-300 relative",
          isNewSessionMode ? "overflow-y-auto" : "overflow-hidden"
        )}>
          {showPreview ? (
            // Split pane layout when preview is active
            <SplitPane
              left={
                <div className="h-full flex flex-col">
                  {projectPathInput}
                  <PlanModeStatusBar isPlanMode={isPlanMode} />
                  {messagesList}
                </div>
              }
              right={
                <WebviewPreview
                  initialUrl={previewUrl}
                  onClose={handleClosePreview}
                  isMaximized={isPreviewMaximized}
                  onToggleMaximize={handleTogglePreviewMaximize}
                  onUrlChange={handlePreviewUrlChange}
                />
              }
              initialSplit={splitPosition}
              onSplitChange={setSplitPosition}
              minLeftWidth={400}
              minRightWidth={400}
              className="h-full"
            />
          ) : (
            // In new session mode: min-h-full lets the container grow beyond
            // the parent when there are many recent projects, while ensuring
            // it fills the viewport when content is short.
            // In active session mode: h-full locks to parent height so the
            // virtualised message list can manage its own scroll area.
            <div className={cn(
              "flex flex-col relative",
              isNewSessionMode ? "min-h-full" : "h-full"
            )}>
              {projectPathInput}
              <PlanModeStatusBar isPlanMode={isPlanMode} />
              {messagesList}

              {isLoading && messages.length === 0 && (
                <div className="flex items-center justify-center h-full">
                  <div className="flex items-center gap-3">
                    <div className="rotating-symbol text-primary" />
                    <span className="text-sm text-muted-foreground">
                      {session ? t('claudeSession.loadingHistory') : t('claudeSession.initializingClaude')}
                    </span>
                  </div>
                </div>
              )}

              {/* ✅ 滚动控件 - 放在消息区域内，使用 absolute 定位 */}
              {displayableMessages.length > 5 && (
                <div className="absolute right-4 bottom-4 pointer-events-auto z-40">
                  <div className="flex flex-col gap-1.5">
                    {/* Prompt Navigator Button */}
                    {!showPromptNavigator && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="flex flex-col items-center gap-1 bg-background/60 backdrop-blur-md border border-border/50 rounded-xl px-1.5 py-2 cursor-pointer hover:bg-accent/80 shadow-sm"
                        onClick={() => setShowPromptNavigator(true)}
                        title={t('claudeSession.promptNav')}
                      >
                        <List className="h-4 w-4" />
                        <div className="flex flex-col items-center text-[10px] leading-tight tracking-wider">
                          <span>{t('session.promptChar1')}</span>
                          <span>{t('session.promptChar2')}</span>
                          <span>{t('session.promptChar3')}</span>
                        </div>
                      </motion.div>
                    )}

                    {/* New message indicator - only show when user scrolled away */}
                    <AnimatePresence>
                      {userScrolled && (
                        <motion.div
                          initial={{ opacity: 0, y: 20, scale: 0.8 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 20, scale: 0.8 }}
                          className="flex flex-col items-center gap-1 bg-background/60 backdrop-blur-md border border-border/50 rounded-xl px-1.5 py-2 cursor-pointer hover:bg-accent/80 shadow-sm"
                          onClick={() => {
                            setUserScrolled(false);
                            setShouldAutoScroll(true);
                            // 使用虚拟列表的 scrollToBottom，解决消息过多时滚动不到底的问题
                            sessionMessagesRef.current?.scrollToBottom();
                          }}
                          title={t('claudeSession.newMessage')}
                        >
                          <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
                          <div className="flex flex-col items-center text-[10px] leading-tight tracking-wider">
                            <span>{t('session.newChar1')}</span>
                            <span>{t('session.newChar2')}</span>
                            <span>{t('session.newChar3')}</span>
                          </div>
                          <ChevronDown className="h-3 w-3" />
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Traditional scroll controls */}
                    <div className="flex flex-col bg-background/60 backdrop-blur-md border border-border/50 rounded-xl overflow-hidden shadow-sm">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setUserScrolled(true);
                          setShouldAutoScroll(false);
                          if (parentRef.current) {
                            parentRef.current.scrollTo({
                              top: 0,
                              behavior: 'smooth'
                            });
                          }
                        }}
                        className="px-1.5 py-1.5 hover:bg-accent/80 rounded-none h-auto min-h-0"
                        title={t('claudeSession.scrollToTop')}
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </Button>
                      <div className="h-px w-full bg-border/50" />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setUserScrolled(false);
                          setShouldAutoScroll(true);
                          // 使用虚拟列表的 scrollToBottom，解决消息过多时滚动不到底的问题
                          sessionMessagesRef.current?.scrollToBottom();
                        }}
                        className="px-1.5 py-1.5 hover:bg-accent/80 rounded-none h-auto min-h-0"
                        title={t('claudeSession.scrollToBottom')}
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>


        {/* ✅ 重构：队列提示词作为 Flex 的一部分，显示在输入框上方 */}
        <AnimatePresence>
          {queuedPrompts.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="flex-shrink-0 w-full max-w-3xl mx-auto px-4 pb-2"
            >
              <div className="floating-element backdrop-enhanced rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium text-muted-foreground mb-1">
                    {t('session.queuedPrompts', { count: queuedPrompts.length })}
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => setQueuedPromptsCollapsed(prev => !prev)}>
                    {queuedPromptsCollapsed ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </Button>
                </div>
                {!queuedPromptsCollapsed && queuedPrompts.map((queuedPrompt, index) => (
                  <motion.div
                    key={queuedPrompt.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ delay: index * 0.05 }}
                    className="flex items-start gap-2 bg-muted/50 rounded-md p-2"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-muted-foreground">#{index + 1}</span>
                        <span className="text-xs px-1.5 py-0.5 bg-primary/10 text-primary rounded">
                          {queuedPrompt.model === "default" ? "Default" : queuedPrompt.model === "best" ? "Best" : queuedPrompt.model === "opusplan" ? "Opus Plan" : queuedPrompt.model === "haiku" ? "Haiku" : queuedPrompt.model === "opus1m" ? "Opus 1M" : queuedPrompt.model === "opus" ? "Opus" : queuedPrompt.model === "sonnet1m" ? "Sonnet 1M" : "Sonnet"}
                        </span>
                      </div>
                      <p className="text-sm line-clamp-2 break-words">{queuedPrompt.prompt}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 flex-shrink-0"
                      onClick={() => setQueuedPrompts(prev => prev.filter(p => p.id !== queuedPrompt.id))}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Floating Prompt Input - 输入区域 */}
        <ErrorBoundary>
          {/* ✅ 重构：输入区域作为 Flex 容器的一部分，不再使用 fixed 定位 */}
          <FloatingPromptInput
            className="flex-shrink-0 transition-[left] duration-300"
            ref={floatingPromptRef}
            onSend={handleSendPromptWithScroll}
            onCancel={handleCancelExecution}
            isLoading={isLoading}
            disabled={!projectPath}
            projectPath={projectPath}
            sessionId={effectiveSession?.id}         // 🆕 传递会话 ID
            projectId={effectiveSession?.project_id} // 🆕 传递项目 ID
            sessionModel={session?.model}
            getConversationContext={getConversationContext}
            messages={messages}                      // 🆕 传递完整消息列表
            isPlanMode={isPlanMode}
            onTogglePlanMode={handleTogglePlanMode}
            sessionCost={formatCost(costStats.totalCost)}
            sessionStats={costStats}
            hasMessages={messages.length > 0}
            session={effectiveSession || undefined}  // 🆕 传递完整会话信息用于导出
            codexRateLimits={codexRateLimits}
            executionEngineConfig={executionEngineConfig}              // 🆕 Codex 集成
            onExecutionEngineConfigChange={setExecutionEngineConfig}   // 🆕 Codex 集成
          />

        </ErrorBoundary>

        {/* Revert Prompt Picker - Shows when double ESC is pressed */}
        {showRevertPicker && effectiveSession && (
          <RevertPromptPicker
            sessionId={effectiveSession.id}
            projectId={effectiveSession.project_id}
            projectPath={projectPath}
            engine={effectiveSession.engine || executionEngineConfig.engine || 'claude'}
            onSelect={handleRevert}
            onClose={() => setShowRevertPicker(false)}
          />
        )}

        {/* Plan Approval Dialog - 方案 B-1: ExitPlanMode 触发审批 */}
        <PlanApprovalDialog
          open={showApprovalDialog}
          plan={pendingApproval?.plan || ''}
          onClose={closeApprovalDialog}
          onApprove={approvePlan}
          onReject={rejectPlan}
        />

        {/* 🆕 User Question Dialog - AskUserQuestion 自动触发 */}
        <AskUserQuestionDialog
          open={showQuestionDialog}
          questions={pendingQuestion?.questions || []}
          onClose={closeQuestionDialog}
          onSubmit={submitAnswers}
        />
      </div>

      {/* Prompt Navigator - Quick navigation to any user prompt */}
      <PromptNavigator
        messages={messages}
        isOpen={showPromptNavigator}
        onClose={() => setShowPromptNavigator(false)}
        onPromptClick={handlePromptNavigation}
      />

    </div>
  );
};

export const ClaudeCodeSession: React.FC<ClaudeCodeSessionProps> = (props) => {
  return (
    <MessagesProvider initialFilterConfig={{ hideWarmupMessages: true }}>
      <PlanModeProvider>
        <UserQuestionProvider>
          <ClaudeCodeSessionInner {...props} />
        </UserQuestionProvider>
      </PlanModeProvider>
    </MessagesProvider>
  );
};

