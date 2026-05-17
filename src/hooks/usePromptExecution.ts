/**
 * usePromptExecution Hook
 *
 * Manages Claude Code prompt execution including:
 * - Input validation and queueing
 * - Event listener setup (generic and session-specific)
 * - Translation processing
 * - Thinking instruction handling
 * - API execution (new session, resume, continue)
 * - Error handling and state management
 *
 * Extracted from ClaudeCodeSession component (296 lines)
 */

import { useCallback, useRef, useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { api, type Session } from '@/lib/api';
import { translationMiddleware, isSlashCommand, type TranslationResult } from '@/lib/translationMiddleware';
import type { ClaudeStreamMessage } from '@/types/claude';
import type { ModelType } from '@/components/FloatingPromptInput/types';
// 🔧 FIX: 导入 CodexEventConverter 类，在每个会话中创建独立实例避免全局单例污染
import { CodexEventConverter, extractCodexRateLimitsFromEvent } from '@/lib/codexConverter';
import type { CodexExecutionMode, CodexRateLimits } from '@/types/codex';
import { cacheModelFromInitMessage } from '@/lib/modelNameParser';

// ============================================================================
// Global Type Declarations
// ============================================================================

// Extend window object for Codex/Gemini pending prompt tracking
declare global {
  interface Window {
    __codexPendingPrompt?: {
      sessionId: string;
      projectPath: string;
      promptIndex: number;
      promptText: string;
    };
    __geminiPendingPrompt?: {
      sessionId: string;
      projectPath: string;
      promptIndex: number;
      promptText: string;
    };
    __geminiPendingSession?: {
      sessionId: string;
      projectPath: string;
    };
  }
}

// ============================================================================
// Type Definitions
// ============================================================================

interface QueuedPrompt {
  id: string;
  prompt: string;
  model: ModelType;
}

interface UsePromptExecutionConfig {
  // State
  projectPath: string;
  isLoading: boolean;
  claudeSessionId: string | null;
  effectiveSession: Session | null;
  isPlanMode: boolean;
  lastTranslationResult: TranslationResult | null;
  isActive: boolean;
  isFirstPrompt: boolean;
  extractedSessionInfo: { sessionId: string; projectId: string } | null;

  // 🆕 Execution Engine Integration (Claude/Codex/Gemini)
  executionEngine?: 'claude' | 'codex' | 'gemini'; // 执行引擎选择 (默认: 'claude')
  codexMode?: CodexExecutionMode;       // Codex 执行模式
  codexModel?: string;                  // Codex 模型 (e.g., 'gpt-5.2')
  geminiModel?: string;                 // Gemini 模型 (e.g., 'gemini-3-flash')
  geminiApprovalMode?: 'auto_edit' | 'yolo' | 'default'; // Gemini 审批模式

  // Refs
  hasActiveSessionRef: React.MutableRefObject<boolean>;
  unlistenRefs: React.MutableRefObject<UnlistenFn[]>;
  isMountedRef: React.MutableRefObject<boolean>;
  isListeningRef: React.MutableRefObject<boolean>;
  queuedPromptsRef: React.MutableRefObject<QueuedPrompt[]>;

  // State Setters
  setIsLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setMessages: React.Dispatch<React.SetStateAction<ClaudeStreamMessage[]>>;
  setClaudeSessionId: (id: string | null) => void;
  setLastTranslationResult: (result: TranslationResult | null) => void;
  setQueuedPrompts: React.Dispatch<React.SetStateAction<QueuedPrompt[]>>;
  setRawJsonlOutput: React.Dispatch<React.SetStateAction<string[]>>;
  setExtractedSessionInfo: React.Dispatch<React.SetStateAction<{ sessionId: string; projectId: string; engine?: 'claude' | 'codex' | 'gemini' } | null>>;
  setIsFirstPrompt: (isFirst: boolean) => void;
  setCodexRateLimits?: React.Dispatch<React.SetStateAction<CodexRateLimits | null>>;

  // External Hook Functions
  processMessageWithTranslation: (message: ClaudeStreamMessage, payload: string, currentTranslationResult?: TranslationResult) => Promise<void>;
}

interface UsePromptExecutionReturn {
  handleSendPrompt: (prompt: string, model: ModelType, maxThinkingTokens?: number) => Promise<void>;
}

type ClaudeGlobalEventPayload<T> = { tab_id?: string | null; payload: T } | T;

const normalizeClaudeGlobalPayload = <T,>(payload: ClaudeGlobalEventPayload<T>) => {
  if (payload && typeof payload === 'object' && 'payload' in payload) {
    const typedPayload = payload as { tab_id?: string | null; payload: T };
    return { tabId: typedPayload.tab_id ?? null, payload: typedPayload.payload };
  }
  return { tabId: null, payload: payload as T };
};

// ============================================================================
// Hook Implementation
// ============================================================================

export function usePromptExecution(config: UsePromptExecutionConfig): UsePromptExecutionReturn {
  const {
    projectPath,
    isLoading,
    claudeSessionId,
    effectiveSession,
    isPlanMode,
    isActive,
    isFirstPrompt,
    extractedSessionInfo,
    executionEngine = 'claude', // 🆕 默认使用 Claude Code
    codexMode = 'default',       // 🆕 Codex 默认模式（每次敏感操作前请求授权）
    codexModel,                  // 🆕 Codex 模型
    geminiModel,                 // 🆕 Gemini 模型
    geminiApprovalMode,          // 🆕 Gemini 审批模式
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
  } = config;

  // ============================================================================
  // 🔧 Fix: 使用 ref 存储 isPlanMode，确保异步回调获取最新值
  // 解决问题：批准计划后自动发送的提示词仍带 --plan 标志
  // ============================================================================
  const isPlanModeRef = useRef(isPlanMode);
  useEffect(() => {
    isPlanModeRef.current = isPlanMode;
  }, [isPlanMode]);

  // ============================================================================
  // 🔒 CRITICAL FIX: 生成唯一的 tabId 用于会话隔离
  // 解决问题：新建会话并发时全局事件的消息串扰
  // ============================================================================
  const tabIdRef = useRef<string>(crypto.randomUUID());

  const codexThreadIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (executionEngine !== 'codex') {
      return;
    }

    const sessionId = extractedSessionInfo?.sessionId || effectiveSession?.id;
    if (sessionId) {
      codexThreadIdRef.current = sessionId;
    }
  }, [executionEngine, extractedSessionInfo?.sessionId, effectiveSession?.id]);

  const updateCodexRateLimits = useCallback((incoming?: CodexRateLimits | null) => {
    if (!incoming || !setCodexRateLimits) {
      return;
    }

    setCodexRateLimits((prev) => {
      if (!prev) {
        return incoming;
      }

      if (!incoming.updatedAt) {
        return prev.updatedAt ? prev : incoming;
      }

      if (!prev.updatedAt) {
        return incoming;
      }

      const prevTime = Date.parse(prev.updatedAt);
      const nextTime = Date.parse(incoming.updatedAt);

      if (Number.isFinite(prevTime) && Number.isFinite(nextTime) && nextTime < prevTime) {
        return prev;
      }

      return incoming;
    });
  }, [setCodexRateLimits]);

  const refreshCodexRateLimitsFromHistory = useCallback(async () => {
    if (!setCodexRateLimits) {
      return;
    }

    const sessionId = codexThreadIdRef.current || extractedSessionInfo?.sessionId || effectiveSession?.id;
    if (!sessionId) {
      return;
    }

    try {
      const history = await api.loadCodexSessionHistory(sessionId);
      for (let i = history.length - 1; i >= 0; i -= 1) {
        const rateLimits = extractCodexRateLimitsFromEvent(history[i]);
        if (rateLimits) {
          updateCodexRateLimits(rateLimits);
          break;
        }
      }
    } catch (err) {
      console.warn('[usePromptExecution] Failed to refresh Codex rate limits:', err);
    }
  }, [effectiveSession?.id, extractedSessionInfo?.sessionId, setCodexRateLimits, updateCodexRateLimits]);

  // ============================================================================
  // Main Prompt Execution Function
  // ============================================================================

  const handleSendPrompt = useCallback(async (
    prompt: string,
    model: ModelType,
    maxThinkingTokens?: number
  ) => {
    // ========================================================================
    // 1️⃣ Validation & Queueing
    // ========================================================================

    if (!projectPath) {
      setError("请先选择项目目录");
      return;
    }

    // Check if this is a slash command
    const isSlashCommandInput = isSlashCommand(prompt);

    // If already loading, queue the prompt
    if (isLoading) {
      const newPrompt: QueuedPrompt = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        prompt,
        model
      };
      setQueuedPrompts(prev => [...prev, newPrompt]);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      hasActiveSessionRef.current = true;

      // Record prompt sent (save Git state before sending)
      // Only record real user input, exclude auto Warmup and Skills messages
      let recordedPromptIndex = -1;
      const isUserInitiated = !prompt.includes('Warmup') 
        && !prompt.includes('<command-name>')
        && !prompt.includes('Launching skill:');
      const codexPendingInfo = executionEngine === 'codex' ? {
        sessionId: effectiveSession?.id || null,
        projectPath,
        promptText: prompt,
        promptIndex: undefined as number | undefined,
      } : undefined;
      const geminiPendingInfo = executionEngine === 'gemini' ? {
        sessionId: effectiveSession?.id || null,
        projectPath,
        promptText: prompt,
        promptIndex: undefined as number | undefined,
      } : undefined;
      
      // 对于已有会话，立即记录；对于新会话，在收到 session_id 后记录
      if (effectiveSession && isUserInitiated) {
        try {
          if (executionEngine === 'codex') {
            // ✅ Codex 使用专用的记录 API（写入 ~/.codex/git-records/）
            recordedPromptIndex = await api.recordCodexPromptSent(
              effectiveSession.id,
              projectPath,
              prompt
            );
            
            if (codexPendingInfo) {
              codexPendingInfo.promptIndex = recordedPromptIndex;
              codexPendingInfo.sessionId = effectiveSession.id;
            }
          } else if (executionEngine === 'gemini') {
            // 🔧 FIX: Gemini must wait for real CLI session ID from init event
            // Don't record here even for existing sessions - Gemini CLI may generate new session ID
            // geminiPendingInfo will be used in the init event handler
          } else {
            // Claude Code 使用原有的记录 API（写入 .claude-sessions/）
            recordedPromptIndex = await api.recordPromptSent(
              effectiveSession.id,
              effectiveSession.project_id,
              projectPath,
              prompt
            );
            
          }
        } catch (err) {
          console.error('[Prompt Revert] [ERROR] Failed to record prompt:', err);
        }
      } else if (isUserInitiated) {
        
      }

      // Translation state
      let processedPrompt = prompt;
      let userInputTranslation: TranslationResult | null = null;

      // For resuming sessions, ensure we have the session ID
      if (effectiveSession && !claudeSessionId) {
        setClaudeSessionId(effectiveSession.id);
      }

      // ========================================================================
      // 2️⃣ Event Listener Setup (Only for Active Tabs)
      // ========================================================================

      if (!isListeningRef.current && isActive) {
        // Clean up previous listeners
        unlistenRefs.current.forEach(unlisten => unlisten && typeof unlisten === 'function' && unlisten());
        unlistenRefs.current = [];

        // Mark as setting up listeners
        isListeningRef.current = true;

        // ====================================================================
        // 🆕 Codex Event Listeners (with session isolation support)
        // ====================================================================
        if (executionEngine === 'codex') {
          // 🔧 CRITICAL FIX: 创建会话级别的转换器实例,避免全局单例污染
          // 问题: 全局 codexConverter 单例会在多个标签页间共享状态(threadId, itemMap, toolResults)
          // 解决: 每个会话创建独立的转换器实例
          const sessionCodexConverter = new CodexEventConverter({
            // codex exec --json 的事件不包含 model 信息；这里用用户选择/会话记录作为默认模型
            defaultModel: effectiveSession?.model || codexModel || null,
          });

          // 🔧 FIX: Track current Codex session ID for channel isolation
          let currentCodexSessionId: string | null = null;
          // 🔧 FIX: Track processed message IDs to prevent duplicates
          const processedCodexMessages = new Set<string>();
          // 🔧 FIX: Track pending prompt recording Promise to avoid race condition
          let pendingPromptRecordingPromise: Promise<void> | null = null;

          // Helper function to generate message ID for deduplication
          const getCodexMessageId = (payload: string): string => {
            // Use payload hash as ID since Codex doesn't provide unique message IDs
            let hash = 0;
            for (let i = 0; i < payload.length; i++) {
              const char = payload.charCodeAt(i);
              hash = ((hash << 5) - hash) + char;
              hash = hash & hash;
            }
            return `codex-${hash}`;
          };

          // Helper function to process Codex output
          const processCodexOutput = async (payload: string) => {
            if (!isMountedRef.current) return;

            // 🔧 FIX: Deduplicate messages
            const messageId = getCodexMessageId(payload);
            if (processedCodexMessages.has(messageId)) {
              return;
            }
            processedCodexMessages.add(messageId);

            // 🔧 CRITICAL FIX: Parse JSONL to detect turn.completed event
            let isTurnCompleted = false;
            try {
              const event = JSON.parse(payload);
              if (event.type === 'turn.completed') {
                isTurnCompleted = true;
              }
            } catch (e) {
              // Ignore parse errors
            }

            // 🔧 FIX: 使用会话级别的转换器实例
            const message = sessionCodexConverter.convertEvent(payload);
            if (message) {
              setMessages(prev => [...prev, message]);
              setRawJsonlOutput((prev) => [...prev, payload]);

              // Extract and save Codex thread_id from thread.started for session resuming
              // NOTE: claudeSessionId is already set to the backend channel ID in codex-session-init handler
              // Here we only save the thread_id for session resuming purposes (different from channel ID)
              if (message.type === 'system' && message.subtype === 'init' && (message as any).session_id) {
                const codexThreadId = (message as any).session_id;  // This is the Codex thread_id
                codexThreadIdRef.current = codexThreadId;
                // 🔧 FIX: Don't override claudeSessionId here - it's already set to backend channel ID
                // setClaudeSessionId(codexThreadId);  // REMOVED - would break event channel subscription

                // Save session info for resuming (uses thread_id, not channel ID)
                const projectId = projectPath.replace(/[^a-zA-Z0-9]/g, '-');
                setExtractedSessionInfo({ sessionId: codexThreadId, projectId, engine: 'codex' });

                // Mark as not first prompt anymore
                setIsFirstPrompt(false);

                // If this is a new Codex session and prompt not yet recorded, record now
                if (isUserInitiated && codexPendingInfo && codexPendingInfo.promptIndex === undefined) {
                  // 🔧 FIX: Store Promise to allow processCodexComplete to wait for it
                  pendingPromptRecordingPromise = api.recordCodexPromptSent(codexThreadId, projectPath, codexPendingInfo.promptText)
                    .then((idx) => {
                      codexPendingInfo.promptIndex = idx;
                      codexPendingInfo.sessionId = codexThreadId;
                      window.__codexPendingPrompt = {
                        sessionId: codexThreadId,
                        projectPath,
                        promptIndex: idx,
                        promptText: codexPendingInfo.promptText
                      };
                    })
                    .catch(err => {
                      console.warn('[usePromptExecution] Failed to record Codex prompt after init:', err);
                    });
                } else if (codexPendingInfo && codexPendingInfo.promptIndex !== undefined) {
                  // Update pending sessionId for completion handler
                  window.__codexPendingPrompt = {
                    sessionId: codexThreadId,
                    projectPath,
                    promptIndex: codexPendingInfo.promptIndex,
                    promptText: codexPendingInfo.promptText
                  };
                }
              }
            }

            // 🔧 CRITICAL FIX: Auto-complete session when turn.completed is received
            // Don't wait for codex-complete event from backend, as it may be delayed or not sent
            const converterRateLimits = sessionCodexConverter.getRateLimits();
            const messageRateLimits = (message as any)?.codexMetadata?.rateLimits;
            updateCodexRateLimits(messageRateLimits || converterRateLimits);

            if (isTurnCompleted) {
              // Use setTimeout to ensure message state is updated first
              setTimeout(() => {
                processCodexComplete();
              }, 100);
            }
          };

          // Helper function to process Codex completion
          const processCodexComplete = async () => {
            // 发送桌面通知
            try {
              const { notifyResponseComplete } = await import('@/lib/notificationService');
              notifyResponseComplete('Codex');
            } catch {}

            setIsLoading(false);
            hasActiveSessionRef.current = false;
            isListeningRef.current = false;

            // 🆕 Clean up listeners to prevent memory leak
            unlistenRefs.current.forEach(u => u && typeof u === 'function' && u());
            unlistenRefs.current = [];

            // 🔧 FIX: Wait for pending prompt recording to complete (race condition fix)
            if (pendingPromptRecordingPromise) {
              await pendingPromptRecordingPromise;
              pendingPromptRecordingPromise = null;
            }

            // 🆕 Record prompt completion for rewind support
            if (window.__codexPendingPrompt) {
              const pendingPrompt = window.__codexPendingPrompt;
              try {
                await api.recordCodexPromptCompleted(
                  pendingPrompt.sessionId,
                  pendingPrompt.projectPath,
                  pendingPrompt.promptIndex,
                  pendingPrompt.promptText
                );
              } catch (err) {
                console.warn('[usePromptExecution] Failed to record Codex prompt completion:', err);
              }
              // Clear the pending prompt
              delete window.__codexPendingPrompt;
            }

            await refreshCodexRateLimitsFromHistory();

            // Process queued prompts
            if (queuedPromptsRef.current.length > 0) {
              const [nextPrompt, ...remainingPrompts] = queuedPromptsRef.current;
              setQueuedPrompts(remainingPrompts);

              setTimeout(() => {
                handleSendPrompt(nextPrompt.prompt, nextPrompt.model);
              }, 100);
            }
          };

          const parseCodexErrorPayload = (payload: string): { sessionId?: string; message: string } => {
            try {
              const data = JSON.parse(payload);
              const sessionId = data?.session_id || data?.sessionId;
              const message = data?.error?.message || data?.message || payload;
              const detail = data?.error?.detail || data?.detail;
              if (detail && typeof detail === 'string' && detail.trim().length > 0) {
                return { sessionId, message: `${message}\n${detail}` };
              }
              return { sessionId, message };
            } catch {
              return { message: payload };
            }
          };

          // Helper function to process Codex errors (确保退出加载态并清理监听，避免前端“无反应”)
          const processCodexError = async (payload: string) => {
            const parsed = parseCodexErrorPayload(payload);
            setError(parsed.message);
            setIsLoading(false);
            hasActiveSessionRef.current = false;
            isListeningRef.current = false;

            // 清理监听器，避免后续事件污染
            unlistenRefs.current.forEach(u => u && typeof u === 'function' && u());
            unlistenRefs.current = [];

            // 启动失败时不应保留 pending prompt
            if (window.__codexPendingPrompt) {
              delete window.__codexPendingPrompt;
            }

            // 继续处理队列（与完成逻辑一致）
            if (queuedPromptsRef.current.length > 0) {
              const [nextPrompt, ...remainingPrompts] = queuedPromptsRef.current;
              setQueuedPrompts(remainingPrompts);

              setTimeout(() => {
                handleSendPrompt(nextPrompt.prompt, nextPrompt.model);
              }, 100);
            }
          };

          // Helper function to attach session-specific listeners
          const attachCodexSessionListeners = async (sessionId: string) => {
            const specificOutputUnlisten = await listen<string>(`codex-output:${sessionId}`, (evt) => {
              processCodexOutput(evt.payload);
            });

            const specificCompleteUnlisten = await listen<boolean>(`codex-complete:${sessionId}`, async () => {
              
              await processCodexComplete();
            });

            const specificErrorUnlisten = await listen<string>(`codex-error:${sessionId}`, async (evt) => {
              await processCodexError(evt.payload);
            });

            // Replace existing listeners with session-specific ones
            unlistenRefs.current.forEach((u) => u && typeof u === 'function' && u());
            unlistenRefs.current = [specificOutputUnlisten, specificCompleteUnlisten, specificErrorUnlisten];
          };

          // 🔧 FIX: Listen for session init event to get session ID for channel isolation
          const codexSessionInitUnlisten = await listen<{ type: string; session_id: string }>('codex-session-init', async (evt) => {
            // 🔧 FIX: Only process if this tab has an active session
            if (!hasActiveSessionRef.current) return;
            if (evt.payload.session_id && !currentCodexSessionId) {
              currentCodexSessionId = evt.payload.session_id;
              // 🔧 FIX: Set claudeSessionId to the backend channel ID for reconnection and cancellation
              // This is different from the Codex thread_id which is used for resuming sessions
              setClaudeSessionId(currentCodexSessionId);
              // Switch to session-specific listeners
              await attachCodexSessionListeners(currentCodexSessionId);
            }
          });

          // 🔧 FIX: 移除全局监听器,避免跨会话串流
          // Listen for Codex JSONL output (global fallback) - REMOVED to prevent cross-session data leakage
          // 问题: 多个标签页都监听全局 'codex-output' 事件,导致消息被多个会话接收
          // 解决: 仅在会话ID未知的早期阶段处理全局事件,且必须验证会话归属
          const codexOutputUnlisten = await listen<string>('codex-output', (evt) => {
            // 🔧 CRITICAL FIX: 只在尚未收到会话ID时处理全局事件
            if (!hasActiveSessionRef.current) return;
            if (currentCodexSessionId) {
              // 已经有会话ID,不再处理全局事件(应该由会话特定监听器处理)
              
              return;
            }
            // 只在会话ID未知的早期阶段处理
            processCodexOutput(evt.payload);
          });

          // Listen for Codex errors
          const codexErrorUnlisten = await listen<string>('codex-error', async (evt) => {
            // 🔧 FIX: Only process if this tab has an active session
            if (!hasActiveSessionRef.current) return;

            const parsed = parseCodexErrorPayload(evt.payload);

            // 🔒 Session Isolation：如果已确定会话 ID，则忽略其他会话的错误
            if (parsed.sessionId && currentCodexSessionId && parsed.sessionId !== currentCodexSessionId) {
              return;
            }

            // 如果尚未拿到 session_init，但错误里包含 session_id，也用于绑定会话（用于隔离与 UI 展示）
            if (!currentCodexSessionId && parsed.sessionId) {
              currentCodexSessionId = parsed.sessionId;
              setClaudeSessionId(currentCodexSessionId);
            }

            await processCodexError(evt.payload);
          });

          // 🔧 FIX: 移除全局完成事件监听器,避免跨会话串流
          // Listen for Codex completion (global fallback) - FIXED to prevent cross-session interference
          const codexCompleteUnlisten = await listen<boolean>('codex-complete', async () => {
            // 🔧 CRITICAL FIX: 只在尚未收到会话ID时处理全局事件
            if (!hasActiveSessionRef.current) return;
            if (currentCodexSessionId) {
              // 已经有会话ID,不再处理全局完成事件(应该由会话特定监听器处理)
              
              return;
            }
            
            await processCodexComplete();
          });

          unlistenRefs.current = [codexSessionInitUnlisten, codexOutputUnlisten, codexErrorUnlisten, codexCompleteUnlisten];
        } else if (executionEngine === 'gemini') {
          // ====================================================================
          // 🆕 Gemini Event Listeners
          // ====================================================================

          // 🔧 Track current Gemini session ID for channel isolation
          let currentGeminiSessionId: string | null = null;
          // 🔧 Track processed message IDs to prevent duplicates
          const processedGeminiMessages = new Set<string>();
          // 🔧 FIX: Track pending prompt recording Promise to avoid race condition
          let pendingGeminiPromptRecordingPromise: Promise<void> | null = null;

          // Helper function to generate message ID for deduplication
          const getGeminiMessageId = (payload: string): string => {
            let hash = 0;
            for (let i = 0; i < payload.length; i++) {
              const char = payload.charCodeAt(i);
              hash = ((hash << 5) - hash) + char;
              hash = hash & hash;
            }
            return `gemini-${hash}`;
          };

          // Helper function to convert Gemini unified message to ClaudeStreamMessage
          const convertGeminiToClaudeMessage = (data: any): ClaudeStreamMessage | null => {
            try {
              // The backend already converts to unified format, we just need to ensure type compatibility
              // Note: geminiMetadata is already included in data from backend conversion

              if (data.type === 'system' && data.subtype === 'init') {
                return {
                  type: 'system',
                  subtype: 'init',
                  session_id: data.session_id,
                  model: data.model,
                  timestamp: data.timestamp,
                  engine: 'gemini' as const
                };
              }

              if (data.type === 'assistant' || data.type === 'user') {
                // 🔧 FIX: 对于 user 类型的 tool_result 消息，提取 Gemini functionResponse 格式的实际输出
                let message = data.message;

                if (data.type === 'user' && message?.content) {
                  const content = Array.isArray(message.content) ? message.content : [message.content];
                  const processedContent = content.map((item: any) => {
                    // 检查是否是 tool_result
                    if (item.type === 'tool_result') {
                      let resultContent = item.content;

                      // 尝试提取 Gemini functionResponse 格式: [{functionResponse: {response: {output: "..."}}}]
                      if (Array.isArray(item.content)) {
                        const firstResult = item.content[0];
                        if (firstResult?.functionResponse?.response?.output !== undefined) {
                          resultContent = firstResult.functionResponse.response.output;
                        }
                      }

                      return {
                        ...item,
                        content: resultContent
                      };
                    }
                    return item;
                  });

                  message = {
                    ...message,
                    content: processedContent
                  };
                }

                return {
                  type: data.type,
                  message,
                  timestamp: data.timestamp,
                  engine: 'gemini' as const
                };
              }

              if (data.type === 'result') {
                return {
                  type: 'result',
                  subtype: data.subtype || 'success',
                  usage: data.usage,
                  timestamp: data.timestamp,
                  engine: 'gemini' as const,
                  model: data.model,
                  geminiMetadata: data.geminiMetadata,
                };
              }

              if (data.type === 'system' && data.subtype === 'error') {
                return {
                  type: 'system',
                  subtype: 'error',
                  error: data.error,
                  timestamp: data.timestamp,
                  engine: 'gemini' as const
                };
              }

              // Fallback for unknown types
              return {
                type: 'system',
                subtype: 'raw',
                message: { content: [{ type: 'text', text: JSON.stringify(data) }] },
                engine: 'gemini' as const
              };
            } catch (err) {
              console.error('[usePromptExecution] Failed to convert Gemini message:', err);
              return null;
            }
          };

          // Helper function to process Gemini output
          const processGeminiOutput = (payload: string) => {
            if (!isMountedRef.current) return;

            // 🔧 FIX: Deduplicate messages
            const messageId = getGeminiMessageId(payload);
            if (processedGeminiMessages.has(messageId)) {
              return;
            }
            processedGeminiMessages.add(messageId);

            try {
              const data = JSON.parse(payload);

              // 🔧 FIX: Skip user messages from Gemini - already added by frontend
              // Gemini CLI echoes back user messages, but we already display them
              const hasToolResult = data.message?.content?.some((c: any) => c.type === 'tool_result');
              if (data.type === 'user' && !hasToolResult) {
                
                return;
              }

              // 🔧 FIX: Skip Gemini CLI stderr messages (debug info, metrics, startup logs)
              // These are system messages with eventType: "stderr" that should not be shown to users
              if (data.type === 'system' && data.geminiMetadata?.eventType === 'stderr') {
                return;
              }

              // 🔧 FIX: Handle delta messages - merge with last message of same type
              const isDelta = data.geminiMetadata?.delta || data.delta;
              const msgType = data.type;

              if (isDelta && msgType === 'assistant') {
                // Delta message - merge with last assistant message
                setMessages(prev => {
                  const lastIdx = prev.length - 1;
                  const lastMsg = prev[lastIdx];

                  // Check if last message is assistant and can be merged
                  if (lastMsg && lastMsg.type === 'assistant') {
                    const lastContent = lastMsg.message?.content;
                    const newContent = data.message?.content;

                    if (Array.isArray(lastContent) && Array.isArray(newContent)) {
                      let updatedContent = [...lastContent];
                      let merged = false;

                      // Process each item in new content
                      for (const newItem of newContent) {
                        if (newItem.type === 'text') {
                          // Merge text with existing text block
                          const lastTextIdx = updatedContent.findIndex((c: any) => c.type === 'text');
                          if (lastTextIdx >= 0 && newItem.text) {
                            updatedContent[lastTextIdx] = {
                              ...updatedContent[lastTextIdx],
                              text: (updatedContent[lastTextIdx].text || '') + newItem.text
                            };
                            merged = true;
                          }
                        } else if (newItem.type === 'tool_use') {
                          // 🔧 FIX: Handle tool_use delta - merge with existing tool_use if same ID
                          // Gemini streaming often sends tool_use in chunks or duplicates
                          const lastContentIdx = updatedContent.length - 1;
                          const lastContentItem = updatedContent[lastContentIdx];
                          
                          // Check if we can merge with the last item (same type and ID)
                          if (lastContentItem && lastContentItem.type === 'tool_use' && 
                              (lastContentItem.id === newItem.id || (!lastContentItem.id && !newItem.id))) {
                            
                            // Merge input (assuming it's accumulating properties or complete update)
                            // For safety, we merge objects
                            const mergedInput = { ...(lastContentItem.input || {}), ...(newItem.input || {}) };
                            
                            updatedContent[lastContentIdx] = {
                              ...lastContentItem,
                              ...newItem, // Update other fields like name
                              input: mergedInput
                            };
                            // 
                          } else {
                            // New tool call
                            updatedContent.push(newItem);
                            // 
                          }
                          merged = true;
                        } else {
                          // Append non-text items (thinking, etc.)
                          updatedContent.push(newItem);
                          merged = true;
                        }
                      }

                      if (merged) {
                        // 🐛 DEBUG: Log final merged content structure
                        const toolUseCount = updatedContent.filter((c: any) => c.type === 'tool_use').length;
                        if (toolUseCount > 0) {
                          
                        }

                        const updatedMsg = {
                          ...lastMsg,
                          message: {
                            ...lastMsg.message,
                            content: updatedContent
                          }
                        };

                        return [...prev.slice(0, lastIdx), updatedMsg];
                      }
                    }
                  }

                  // Cannot merge, add as new message
                  const message = convertGeminiToClaudeMessage(data);
                  return message ? [...prev, message] : prev;
                });
                setRawJsonlOutput((prev) => [...prev, payload]);
                return;
              }

              // Non-delta message - add normally
              const message = convertGeminiToClaudeMessage(data);

              if (message) {
                setMessages(prev => [...prev, message]);
                setRawJsonlOutput((prev) => [...prev, payload]);

                // 🔧 NOTE: Session ID handling moved to gemini-cli-session-id event listener
                // The init message from gemini-output may contain backend's temporary ID (gemini-{uuid})
                // We now use the dedicated gemini-cli-session-id event which provides the REAL CLI session ID
              }
            } catch (err) {
              console.error('[usePromptExecution] Failed to process Gemini output:', err, payload);
            }
          };

          // Helper function to process Gemini completion
          const processGeminiComplete = async () => {
            // 发送桌面通知
            try {
              const { notifyResponseComplete } = await import('@/lib/notificationService');
              notifyResponseComplete('Gemini');
            } catch {}

            setIsLoading(false);
            hasActiveSessionRef.current = false;
            isListeningRef.current = false;

            // Clean up listeners
            unlistenRefs.current.forEach(u => u && typeof u === 'function' && u());
            unlistenRefs.current = [];

            // 🔧 FIX: Wait for pending prompt recording to complete (race condition fix)
            if (pendingGeminiPromptRecordingPromise) {
              await pendingGeminiPromptRecordingPromise;
              pendingGeminiPromptRecordingPromise = null;
            }

            // 🆕 Record prompt completion for rewind support
            if (window.__geminiPendingPrompt) {
              const pendingPrompt = window.__geminiPendingPrompt;
              try {
                await api.recordGeminiPromptCompleted(
                  pendingPrompt.sessionId,
                  pendingPrompt.projectPath,
                  pendingPrompt.promptIndex,
                  pendingPrompt.promptText
                );
              } catch (err) {
                console.warn('[usePromptExecution] Failed to record Gemini prompt completion:', err);
              }
              // Clear the pending prompt
              delete window.__geminiPendingPrompt;
            }

            // Clear pending session
            delete window.__geminiPendingSession;

            // Process queued prompts
            if (queuedPromptsRef.current.length > 0) {
              const [nextPrompt, ...remainingPrompts] = queuedPromptsRef.current;
              setQueuedPrompts(remainingPrompts);

              setTimeout(() => {
                handleSendPrompt(nextPrompt.prompt, nextPrompt.model);
              }, 100);
            }
          };

          // Helper function to attach session-specific listeners
          const attachGeminiSessionListeners = async (sessionId: string) => {
            const specificOutputUnlisten = await listen<string>(`gemini-output:${sessionId}`, (evt) => {
              processGeminiOutput(evt.payload);
            });

            const specificCompleteUnlisten = await listen<boolean>(`gemini-complete:${sessionId}`, async () => {
              
              await processGeminiComplete();
            });

            // 🔧 FIX: Append session-specific listeners instead of replacing all
            // This preserves global listeners like geminiCliSessionIdUnlisten
            unlistenRefs.current.push(specificOutputUnlisten, specificCompleteUnlisten);
          };

          // Listen for session init event (backend emits this with backend channel ID)
          const geminiSessionInitUnlisten = await listen<any>('gemini-session-init', async (evt) => {
            if (!hasActiveSessionRef.current) return;
            // 🔧 FIX: evt.payload is already an object, no need to JSON.parse
            const data = evt.payload;
            if (data.session_id && !currentGeminiSessionId) {
              const backendSessionId = data.session_id as string; // e.g., gemini-{uuid}
              currentGeminiSessionId = backendSessionId;
              // Note: Don't set claudeSessionId yet, wait for real Gemini CLI session ID from gemini-cli-session-id event

              // Switch to session-specific listeners
              await attachGeminiSessionListeners(backendSessionId);
            }
          });

          // 🔧 FIX: Listen for real Gemini CLI session ID (emitted when CLI returns init event)
          // This is the REAL session ID that should be used for prompt recording
          const geminiCliSessionIdUnlisten = await listen<{ backend_session_id: string; cli_session_id: string }>('gemini-cli-session-id', async (evt) => {
            if (!hasActiveSessionRef.current) return;
            const { cli_session_id: realCliSessionId } = evt.payload;
            if (!realCliSessionId) return;

            // Update state with real CLI session ID
            setClaudeSessionId(realCliSessionId);
            const projectId = projectPath.replace(/[^a-zA-Z0-9]/g, '-');
            setExtractedSessionInfo({ sessionId: realCliSessionId, projectId, engine: 'gemini' });
            setIsFirstPrompt(false);

            // 🔧 FIX: Record prompt sent using REAL Gemini CLI session ID
            if (isUserInitiated && geminiPendingInfo && geminiPendingInfo.promptIndex === undefined) {
              pendingGeminiPromptRecordingPromise = api.recordGeminiPromptSent(realCliSessionId, projectPath, geminiPendingInfo.promptText)
                .then((idx) => {
                  geminiPendingInfo.promptIndex = idx;
                  geminiPendingInfo.sessionId = realCliSessionId;
                  window.__geminiPendingPrompt = {
                    sessionId: realCliSessionId,
                    projectPath,
                    promptIndex: idx,
                    promptText: geminiPendingInfo.promptText
                  };
                })
                .catch(err => {
                  console.warn('[Gemini Revert] Failed to record prompt with real CLI session ID:', err);
                });
            }

            // Store pending session info with real CLI session ID
            window.__geminiPendingSession = {
              sessionId: realCliSessionId,
              projectPath
            };
          });

          // 🔧 FIX: 移除全局监听器,避免跨会话串流
          // Listen for Gemini output (global fallback) - FIXED to prevent cross-session data leakage
          const geminiOutputUnlisten = await listen<string>('gemini-output', (evt) => {
            // 🔧 CRITICAL FIX: 只在尚未收到会话ID时处理全局事件
            if (!hasActiveSessionRef.current) return;
            if (currentGeminiSessionId) {
              // 已经有会话ID,不再处理全局事件(应该由会话特定监听器处理)
              
              return;
            }
            // 只在会话ID未知的早期阶段处理
            processGeminiOutput(evt.payload);
          });

          // Listen for Gemini errors
          const geminiErrorUnlisten = await listen<string>('gemini-error', (evt) => {
            if (!hasActiveSessionRef.current) return;
            console.error('[usePromptExecution] Gemini error:', evt.payload);
            try {
              const data = JSON.parse(evt.payload);
              setError(data.error?.message || evt.payload);
            } catch {
              setError(evt.payload);
            }
          });

          // 🔧 FIX: 移除全局完成事件监听器,避免跨会话串流
          // Listen for Gemini completion (global fallback) - FIXED to prevent cross-session interference
          const geminiCompleteUnlisten = await listen<boolean>('gemini-complete', async () => {
            // 🔧 CRITICAL FIX: 只在尚未收到会话ID时处理全局事件
            if (!hasActiveSessionRef.current) return;
            if (currentGeminiSessionId) {
              // 已经有会话ID,不再处理全局完成事件(应该由会话特定监听器处理)
              
              return;
            }
            
            await processGeminiComplete();
          });

          unlistenRefs.current = [geminiSessionInitUnlisten, geminiCliSessionIdUnlisten, geminiOutputUnlisten, geminiErrorUnlisten, geminiCompleteUnlisten];
        } else {
          // --------------------------------------------------------------------
          // Claude Code Event Listener Setup Strategy
          // --------------------------------------------------------------------
          // Claude Code may emit a *new* session_id even when we pass --resume.
          // If we listen only on the old session-scoped channel we will miss the
          // stream until the user navigates away & back. To avoid this we:
          //   • Always start with GENERIC listeners (no suffix) so we catch the
          //     very first "system:init" message regardless of the session id.
          //   • Once that init message provides the *actual* session_id, we
          //     dynamically switch to session-scoped listeners and stop the
          //     generic ones to prevent duplicate handling.
          // --------------------------------------------------------------------

        let currentSessionId: string | null = claudeSessionId || effectiveSession?.id || null;

        // 🔧 FIX: Track whether we've switched to session-specific listeners
        // Only ignore generic messages AFTER we've attached session-specific listeners
        let hasAttachedSessionListeners = false;

        // 🔧 FIX: Track processed message IDs to prevent duplicates from global and session-specific channels
        const processedClaudeMessages = new Set<string>();

        // 🔧 FIX: Track pending prompt recording Promise to avoid race condition
        let pendingClaudePromptRecordingPromise: Promise<void> | null = null;

        // Helper function to generate message ID for deduplication
        const getClaudeMessageId = (payload: string): string => {
          try {
            const msg = JSON.parse(payload) as ClaudeStreamMessage;
            // Use message ID if available, otherwise use payload hash
            if (msg.id) return `claude-${msg.id}`;
            if (msg.timestamp) return `claude-${msg.timestamp}-${msg.type}`;
          } catch {
            // Fall through to hash-based ID
          }
          // Fallback: use payload hash
          let hash = 0;
          for (let i = 0; i < payload.length; i++) {
            const char = payload.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
          }
          return `claude-${hash}`;
        };

        // ====================================================================
        // Helper: Attach Session-Specific Listeners
        // ====================================================================
        const attachSessionSpecificListeners = async (sid: string) => {
          // 🔧 FIX: Mark that we've attached session-specific listeners
          hasAttachedSessionListeners = true;

          const specificOutputUnlisten = await listen<string>(`claude-output:${sid}`, async (evt) => {
            handleStreamMessage(evt.payload, userInputTranslation || undefined);
            
            // Handle user message recording in session-specific listener
            try {
              const msg = JSON.parse(evt.payload) as ClaudeStreamMessage;
              
              // 在收到第一条 user 消息后记录
              if (msg.type === 'user' && !hasRecordedPrompt && isUserInitiated) {
                // 检查这是否是我们发送的那条消息（通过内容匹配）
                let isOurMessage = false;
                const msgContent: any = msg.message?.content;
                
                if (msgContent) {
                  if (typeof msgContent === 'string') {
                    const contentStr = msgContent as string;
                    isOurMessage = contentStr.includes(prompt) || prompt.includes(contentStr);
                  } else if (Array.isArray(msgContent)) {
                    const textContent = msgContent
                      .filter((item: any) => item.type === 'text')
                      .map((item: any) => item.text)
                      .join('');
                    isOurMessage = textContent.includes(prompt) || prompt.includes(textContent);
                  }
                }
                
                if (isOurMessage) {
                  const projectId = extractedSessionInfo?.projectId || projectPath.replace(/[^a-zA-Z0-9]/g, '-');
                  // 🔧 FIX: Store Promise to allow processComplete to wait for it
                  pendingClaudePromptRecordingPromise = (async () => {
                    try {
                      // 添加延迟以确保文件写入完成
                      await new Promise(resolve => setTimeout(resolve, 100));

                      recordedPromptIndex = await api.recordPromptSent(
                        sid,
                        projectId,
                        projectPath,
                        prompt
                      );
                      hasRecordedPrompt = true;
                      
                    } catch (err) {
                      console.error('[Prompt Revert] [ERROR] Failed to record prompt:', err);
                    }
                  })();
                }
              }
            } catch {
              /* ignore parse errors */
            }
          });

          const specificErrorUnlisten = await listen<string>(`claude-error:${sid}`, (evt) => {
            console.error('Claude error (scoped):', evt.payload);
            setError(evt.payload);
            // 错误时兜底关闭 loading 状态：进程可能因 stderr 触发 error 后才退出，
            // 也可能直接异常退出而不再发 complete 事件
            if (hasActiveSessionRef.current) {
              processComplete();
            }
          });

          const specificCompleteUnlisten = await listen<boolean>(`claude-complete:${sid}`, () => {
            processComplete();
          });

          // Replace existing unlisten refs with these new ones (after cleaning up)
          unlistenRefs.current.forEach((u) => u && typeof u === 'function' && u());
          unlistenRefs.current = [specificOutputUnlisten, specificErrorUnlisten, specificCompleteUnlisten];
        };

        // ====================================================================
        // Helper: Process Stream Message
        // ====================================================================
        async function handleStreamMessage(payload: string, currentTranslationResult?: TranslationResult) {
          try {
            // Don't process if component unmounted
            if (!isMountedRef.current) return;

            // 🔧 FIX: Deduplicate messages to prevent duplicate processing
            // This can happen when both global and session-specific listeners receive the same message
            const messageId = getClaudeMessageId(payload);
            if (processedClaudeMessages.has(messageId)) {
              return;
            }
            processedClaudeMessages.add(messageId);

            // Store raw JSONL
            setRawJsonlOutput((prev) => [...prev, payload]);

            const message = JSON.parse(payload) as ClaudeStreamMessage;

            // Use the shared translation function for consistency
            await processMessageWithTranslation(message, payload, currentTranslationResult);

          } catch (err) {
            console.error('Failed to parse message:', err, payload);
          }
        }

        // ====================================================================
        // Helper: Process Completion
        // ====================================================================
        const processComplete = async () => {

          // 发送桌面通知（窗口不在前台时）
          try {
            const { notifyResponseComplete } = await import('@/lib/notificationService');
            notifyResponseComplete('Claude');
          } catch {}

          // 🔧 FIX: Wait for pending prompt recording to complete (race condition fix)
          if (pendingClaudePromptRecordingPromise) {
            await pendingClaudePromptRecordingPromise;
            pendingClaudePromptRecordingPromise = null;
          }

          // Mark prompt as completed (record Git state after completion)
          if (recordedPromptIndex >= 0) {
            // Use currentSessionId and extractedSessionInfo for new sessions
            const sessionId = effectiveSession?.id || currentSessionId;
            const projectId = effectiveSession?.project_id || extractedSessionInfo?.projectId || projectPath.replace(/[^a-zA-Z0-9]/g, '-');
            
            if (sessionId && projectId) {
              api.markPromptCompleted(
                sessionId,
                projectId,
                projectPath,
                recordedPromptIndex,
                prompt
              ).then(() => {
              }).catch(err => {
                console.error('[Prompt Revert] Failed to mark completed:', err);
              });
            } else {
              console.warn('[Prompt Revert] Cannot mark completed: missing sessionId or projectId');
            }
          }

          setIsLoading(false);
          hasActiveSessionRef.current = false;
          isListeningRef.current = false;

          // 🆕 Clean up listeners to prevent memory leak
          unlistenRefs.current.forEach(u => u && typeof u === 'function' && u());
          unlistenRefs.current = [];

          // Reset currentSessionId to allow detection of new session_id
          currentSessionId = null;
          // Process queued prompts after completion
          if (queuedPromptsRef.current.length > 0) {
            const [nextPrompt, ...remainingPrompts] = queuedPromptsRef.current;
            setQueuedPrompts(remainingPrompts);

            // Small delay to ensure UI updates
            setTimeout(() => {
              handleSendPrompt(nextPrompt.prompt, nextPrompt.model);
            }, 100);
          }
        };

        // Track if we've recorded the prompt for new sessions
        let hasRecordedPrompt = recordedPromptIndex >= 0;

        // ====================================================================
        // Generic Listeners (Catch-all) - FIXED to prevent cross-session data leakage
        // ====================================================================
        // 🔒 CRITICAL FIX: 全局事件现在格式为 { tab_id: string | null, payload: string }
        const genericOutputUnlisten = await listen<ClaudeGlobalEventPayload<string>>('claude-output', async (event) => {
          // 🔧 CRITICAL FIX: 只在尚未收到会话ID时处理全局事件
          if (!hasActiveSessionRef.current) return;

          // 🔒 CRITICAL FIX: 使用 tab_id 过滤消息，这是最可靠的会话隔离方式
          const { tabId: eventTabId, payload: messagePayload } = normalizeClaudeGlobalPayload(event.payload);

          // 如果事件包含 tab_id，则只处理匹配当前标签页的消息
          if (eventTabId && eventTabId !== tabIdRef.current) {
            // 消息来自不同标签页，忽略
            return;
          }

          // 🔒 CRITICAL FIX: Session Isolation - 严格隔离全局事件处理
          // 问题: 多个标签页都监听全局 'claude-output',导致消息被多个会话接收
          // 解决: 只在会话ID未知的早期阶段处理全局事件
          if (hasAttachedSessionListeners) {
             try {
                const msg = JSON.parse(messagePayload) as ClaudeStreamMessage;
                // 只处理新会话的 init 消息(session_id 不同)
                if (msg.type === 'system' && msg.subtype === 'init' && msg.session_id && msg.session_id !== currentSessionId) {
                   // Fall through to processing below
                } else {
                   // ⚠️ 忽略所有其他消息 - 应该由会话特定监听器处理

                   return;
                }
             } catch {
                return;
             }
          }

          // Attempt to extract session_id on the fly (for the very first init)
          try {
            const msg = JSON.parse(messagePayload) as ClaudeStreamMessage;

            // 🔒 CRITICAL FIX #1: 使用 session_id 验证消息是否属于当前会话
            // 这是最重要的检查：如果消息包含 session_id，且我们已经有 claudeSessionId，
            // 则只处理匹配的消息（解决同一项目下多个会话的串扰问题）
            if (msg.session_id && claudeSessionId && msg.session_id !== claudeSessionId) {
              // 消息来自不同会话，忽略
              return;
            }

            // 🔒 CRITICAL FIX #2: 使用 cwd 字段作为备选验证（不同项目的情况）
            // 多会话并发时，不同项目的消息会通过全局事件广播
            // 通过检查 cwd 确保只处理属于当前项目的消息
            if (msg.cwd && !claudeSessionId) {
              // 只有在还没有 session_id 时才使用 cwd 检查
              const normalizePath = (p: string) => p.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
              const msgCwd = normalizePath(msg.cwd);
              const currentPath = normalizePath(projectPath);

              if (msgCwd !== currentPath) {
                // 消息来自不同项目，忽略
                return;
              }
            }

            // Always process the message if we haven't established a session yet
            // Or if it is the init message
            handleStreamMessage(messagePayload, userInputTranslation || undefined);

            if (msg.type === 'system' && msg.subtype === 'init' && msg.session_id) {
              // Cache model display name from init message for dynamic model selector
              if (msg.model) {
                cacheModelFromInitMessage(msg.model);
              }

              if (!currentSessionId || currentSessionId !== msg.session_id) {
                currentSessionId = msg.session_id;
                setClaudeSessionId(msg.session_id);

                // If we haven't extracted session info before, do it now
                if (!extractedSessionInfo) {
                  const projectId = projectPath.replace(/[^a-zA-Z0-9]/g, '-');
                  setExtractedSessionInfo({ sessionId: msg.session_id, projectId, engine: 'claude' });
                }

                // Record prompt after system:init (user message already written to JSONL)
                if (!hasRecordedPrompt && isUserInitiated) {
                  const projectId = projectPath.replace(/[^a-zA-Z0-9]/g, '-');
                  // 🔧 FIX: Store Promise to allow processComplete to wait for it
                  pendingClaudePromptRecordingPromise = (async () => {
                    try {
                      // Delay 200ms to ensure file is written
                      await new Promise(resolve => setTimeout(resolve, 200));

                      recordedPromptIndex = await api.recordPromptSent(
                        msg.session_id,
                        projectId,
                        projectPath,
                        prompt
                      );
                      hasRecordedPrompt = true;
                      
                    } catch (err) {
                      console.error('[Prompt Revert] [ERROR] Failed to record prompt:', err);
                    }
                  })();
                }

                // Switch to session-specific listeners
                await attachSessionSpecificListeners(msg.session_id);
              }
            }
            
            // Record after first user message (user message already written to JSONL)
            // This ensures backend can correctly read and calculate index
            if (msg.type === 'user' && !hasRecordedPrompt && isUserInitiated && currentSessionId) {
              // 检查这是否是我们发送的那条消息（通过内容匹配）
              let isOurMessage = false;
              const msgContent: any = msg.message?.content;
              
              if (msgContent) {
                if (typeof msgContent === 'string') {
                  const contentStr = msgContent as string;
                  isOurMessage = contentStr.includes(prompt) || prompt.includes(contentStr);
                } else if (Array.isArray(msgContent)) {
                  const textContent = msgContent
                    .filter((item: any) => item.type === 'text')
                    .map((item: any) => item.text)
                    .join('');
                  isOurMessage = textContent.includes(prompt) || prompt.includes(textContent);
                }
              }
              
              if (isOurMessage) {
                const projectId = extractedSessionInfo?.projectId || projectPath.replace(/[^a-zA-Z0-9]/g, '-');
                // 🔧 FIX: Store Promise to allow processComplete to wait for it
                pendingClaudePromptRecordingPromise = (async () => {
                  try {
                    // 添加延迟以确保文件写入完成
                    await new Promise(resolve => setTimeout(resolve, 100));

                    recordedPromptIndex = await api.recordPromptSent(
                      currentSessionId,
                      projectId,
                      projectPath,
                      prompt
                    );
                    hasRecordedPrompt = true;
                    
                  } catch (err) {
                    console.error('[Prompt Revert] [ERROR] Failed to record prompt:', err);
                  }
                })();
              }
            }
          } catch {
            /* ignore parse errors */
          }
        });

        // 🔒 CRITICAL FIX: 全局事件现在格式为 { tab_id: string | null, payload: string }
        const genericErrorUnlisten = await listen<ClaudeGlobalEventPayload<string>>('claude-error', (evt) => {
          if (!hasActiveSessionRef.current) return;

          const { tabId: eventTabId, payload: errorPayload } = normalizeClaudeGlobalPayload(evt.payload);
          if (eventTabId && eventTabId !== tabIdRef.current) {
            return;
          }

          console.error('Claude error:', errorPayload);
          setError(errorPayload);
          // 错误时兜底关闭 loading：避免后端只发 error 不发 complete 时 spinner 永转
          if (hasActiveSessionRef.current) {
            processComplete();
          }
        });

        const genericCompleteUnlisten = await listen<ClaudeGlobalEventPayload<boolean>>('claude-complete', (evt) => {
          // 不再用 hasActiveSessionRef 过滤：错误兜底可能已先翻转 ref，会吞掉真正的 complete
          const { tabId: eventTabId } = normalizeClaudeGlobalPayload(evt.payload);
          if (eventTabId && eventTabId !== tabIdRef.current) {
            return;
          }

          processComplete();
        });

        // Store the generic unlisteners for now; they may be replaced later.
        unlistenRefs.current = [genericOutputUnlisten, genericErrorUnlisten, genericCompleteUnlisten];

        } // End of Claude Code event listener setup

        // ========================================================================
        // 3️⃣ Translation Processing
        // ========================================================================

        // Skip translation entirely for slash commands
        if (!isSlashCommandInput) {
          try {
            const isEnabled = await translationMiddleware.isEnabled();
            if (isEnabled) {
              userInputTranslation = await translationMiddleware.translateUserInput(prompt);
              processedPrompt = userInputTranslation.translatedText;

              if (userInputTranslation.wasTranslated) {
              }
            }
          } catch (translationError) {
            console.error('[usePromptExecution] Translation failed, using original prompt:', translationError);
            // Continue with original prompt if translation fails
          }
        }

        // Store the translation result AFTER all processing for response translation
        if (userInputTranslation) {
          setLastTranslationResult(userInputTranslation);
        }

        // ========================================================================
        // 4️⃣ maxThinkingTokens Processing (No longer modifying prompt)
        // ========================================================================

        // maxThinkingTokens is now passed as API parameter, not added to prompt
        if (maxThinkingTokens) {
        }

        // ========================================================================
        // 5️⃣ Add User Message to UI
        // ========================================================================

        // 🆕 检测斜杠命令 - 斜杠命令显示为"执行命令"系统消息，而不是用户消息
        const isSlashCmd = isSlashCommand(prompt);

        if (isSlashCmd) {
          // 斜杠命令显示为 command-meta 系统消息
          const commandMessage: ClaudeStreamMessage = {
            type: "system",
            subtype: "command-meta",
            message: {
              content: [
                {
                  type: "text",
                  text: `<command-name>${prompt.trim()}</command-name>`
                }
              ]
            },
            timestamp: new Date().toISOString(),
            ...(executionEngine === 'codex' ? { engine: 'codex' as const } : {}),
            ...(executionEngine === 'gemini' ? { engine: 'gemini' as const } : {})
          };
          setMessages(prev => [...prev, commandMessage]);
        } else {
          // 普通用户消息
          const userMessage: ClaudeStreamMessage = {
            type: "user",
            message: {
              content: [
                {
                  type: "text",
                  text: prompt // Always show original user input
                }
              ]
            },
            sentAt: new Date().toISOString(),
            ...(executionEngine === 'codex' ? { engine: 'codex' as const } : {}),
            ...(executionEngine === 'gemini' ? { engine: 'gemini' as const } : {}),
            // Add translation metadata for debugging/info
            translationMeta: userInputTranslation ? {
              wasTranslated: userInputTranslation.wasTranslated,
              detectedLanguage: userInputTranslation.detectedLanguage,
              translatedText: userInputTranslation.translatedText
            } : undefined
          };
          setMessages(prev => [...prev, userMessage]);
        }
      }

      // ========================================================================
      // 6️⃣ API Execution
      // ========================================================================

      // Execute the appropriate command based on execution engine
      // Use processedPrompt (potentially translated) for API calls
      if (executionEngine === 'codex') {
        // ====================================================================
        // 🆕 Codex Execution Branch
        // ====================================================================

        // 📝 Git 记录逻辑说明：
        // - 已有会话：已在前面第 201-230 行通过 recordCodexPromptSent 记录
        // - 新会话：在事件监听器 codex-output 收到 thread.started 后记录
        // 此处仅设置 pendingPrompt 供 completion 使用

        if (effectiveSession && !isFirstPrompt) {
          // Resume existing Codex session
          try {
            await api.resumeCodex(effectiveSession.id, {
              projectPath,
              prompt: processedPrompt,
              mode: codexMode || 'default',
              model: codexModel || model,
              json: true
            });
          } catch (resumeError) {
            // Fallback to resume last if specific resume fails
            await api.resumeLastCodex({
              projectPath,
              prompt: processedPrompt,
              mode: codexMode || 'default',
              model: codexModel || model,
              json: true
            });
          }
        } else {
          // Start new Codex session
          setIsFirstPrompt(false);
          await api.executeCodex({
            projectPath,
            prompt: processedPrompt,
            mode: codexMode || 'default',
            model: codexModel || model,
            json: true
          });
        }

        // 🆕 Store pending prompt info for completion recording
        // 已有会话: recordedPromptIndex 已在前面设置
        // 新会话: codexPendingInfo.promptIndex 将在 thread.started 事件后设置
        const pendingIndex = recordedPromptIndex >= 0 ? recordedPromptIndex : codexPendingInfo?.promptIndex;
        const pendingSessionId = effectiveSession?.id || codexPendingInfo?.sessionId || null;
        if (pendingIndex !== undefined && pendingSessionId) {
          window.__codexPendingPrompt = {
            sessionId: pendingSessionId,
            projectPath,
            promptIndex: pendingIndex,
            promptText: prompt
          };
        }
      } else if (executionEngine === 'gemini') {
        // ====================================================================
        // 🆕 Gemini Execution Branch
        // ====================================================================
        // Note: geminiModel and geminiApprovalMode come from hook parameters

        // Determine if we're resuming a session
        const resumingSession = effectiveSession && !isFirstPrompt;
        const sessionId = resumingSession ? effectiveSession.id : undefined;

        

        if (resumingSession) {
        } else {
          setIsFirstPrompt(false);
        }

        await api.executeGemini({
          projectPath,
          prompt: processedPrompt,
          model: geminiModel || 'gemini-3-flash',
          approvalMode: geminiApprovalMode || 'auto_edit',
          sessionId: sessionId,  // 🔑 Pass session ID for resumption
          debug: false
        });

        // 🆕 Store pending prompt info for completion recording
        // 已有会话: recordedPromptIndex 已在前面设置
        // 新会话: geminiPendingInfo.promptIndex 将在 gemini-session-init 事件后设置
        const pendingIndex = recordedPromptIndex >= 0 ? recordedPromptIndex : geminiPendingInfo?.promptIndex;
        const pendingSessionId = effectiveSession?.id || geminiPendingInfo?.sessionId || null;
        if (pendingIndex !== undefined && pendingSessionId) {
          window.__geminiPendingPrompt = {
            sessionId: pendingSessionId,
            projectPath,
            promptIndex: pendingIndex,
            promptText: prompt
          };
        }

      } else {
        // ====================================================================
        // Claude Code Execution Branch
        // ====================================================================
        // 🔧 Fix: 使用 isPlanModeRef.current 获取最新值，确保批准计划后不带 --plan
        const currentPlanMode = isPlanModeRef.current;
        // 🔒 CRITICAL FIX: 传递 tabId 用于全局事件过滤
        const tabId = tabIdRef.current;
        if (effectiveSession && !isFirstPrompt) {
          // Resume existing session
          try {
            await api.resumeClaudeCode(projectPath, effectiveSession.id, processedPrompt, model, currentPlanMode, maxThinkingTokens, tabId);
          } catch (resumeError) {
            console.warn('[usePromptExecution] Resume failed, falling back to continue mode:', resumeError);
            // Fallback to continue mode if resume fails
            await api.continueClaudeCode(projectPath, processedPrompt, model, currentPlanMode, maxThinkingTokens, tabId);
          }
        } else {
          // Start new session
          setIsFirstPrompt(false);
          await api.executeClaudeCode(projectPath, processedPrompt, model, currentPlanMode, maxThinkingTokens, tabId);
        }
      }

    } catch (err) {
      // ========================================================================
      // 7️⃣ Error Handling
      // ========================================================================
      console.error("Failed to send prompt:", err);
      setError("发送提示失败");
      setIsLoading(false);
      hasActiveSessionRef.current = false;
      // Reset session state on error
      setClaudeSessionId(null);
    }
  }, [
    projectPath,
    isLoading,
    claudeSessionId,
    effectiveSession,
    isPlanMode,
    isActive,
    isFirstPrompt,
    extractedSessionInfo,
    executionEngine,  // 🆕 Codex/Gemini integration
    codexMode,        // 🆕 Codex integration
    codexModel,       // 🆕 Codex integration
    geminiModel,      // 🆕 Gemini integration
    geminiApprovalMode, // 🆕 Gemini integration
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
    processMessageWithTranslation,
    refreshCodexRateLimitsFromHistory,
    updateCodexRateLimits
  ]);

  // ============================================================================
  // Return Hook Interface
  // ============================================================================

  return {
    handleSendPrompt
  };
}
