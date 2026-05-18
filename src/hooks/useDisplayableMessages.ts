/**
 * 可显示消息过滤 Hook
 *
 * 从 ClaudeCodeSession 提取（原 343-403 行）
 * 负责过滤出应该在 UI 中显示的消息
 */

import { useMemo } from 'react';
import type { ClaudeStreamMessage } from '@/types/claude';

/**
 * 过滤选项
 */
interface DisplayableMessagesOptions {
  /** 是否隐藏 Warmup 消息及其回复 */
  hideWarmupMessages?: boolean;
  /** 是否隐藏启动期间的系统警告消息 */
  hideStartupWarnings?: boolean;
}

/**
 * 这些工具有专用的 Widget，结果不需要单独显示
 * 模块级 Set，避免每次 filter 重建数组
 */
const TOOLS_WITH_WIDGETS = new Set<string>([
  'task',
  'edit',
  'multiedit',
  'todowrite',
  'ls',
  'read',
  'glob',
  'bash',
  'write',
  'grep',
]);

/**
 * 检查消息是否为启动期间的系统警告消息
 * 这些消息通常在 Gemini 等引擎初始化 MCP 客户端时产生
 */
function isStartupWarningMessage(message: ClaudeStreamMessage): boolean {
  // 只检查 system 类型的消息
  if (message.type !== 'system') return false;

  // 获取消息内容
  const content = message.message?.content;
  let text = '';

  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .filter((item: any) => item.type === 'text')
      .map((item: any) => item.text || '')
      .join('');
  }

  // 检查是否包含启动期间的特征字符串
  const startupPatterns = [
    '[STARTUP]',
    'Recording metric',
    'initialize_mcp_clients',
    'Initializing MCP',
    'MCP client',
  ];

  return startupPatterns.some(pattern => text.includes(pattern));
}

/**
 * 检查消息是否为 Warmup 消息
 *
 * 真正的 Warmup 消息是系统生成的简短消息，通常以 "Warmup" 开头
 * 需要排除用户粘贴的包含 "Warmup" 关键字的长文本（如日志内容）
 */
function isWarmupMessage(message: ClaudeStreamMessage): boolean {
  if (message.type !== 'user') return false;

  const content = message.message?.content;
  let text = '';

  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .filter((item: any) => item.type === 'text')
      .map((item: any) => item.text || '')
      .join('');
  }

  // 修复：更精确的 Warmup 消息检测
  // 真正的 Warmup 消息特征：
  // 1. 消息以 "Warmup" 开头（系统生成的 Warmup 提示）
  // 2. 消息内容较短（通常不超过 200 字符）
  // 排除用户粘贴的包含 "Warmup" 的长日志文本
  const trimmedText = text.trim();

  // 如果消息太长（超过 200 字符），不认为是 Warmup 消息
  // 因为真正的 Warmup 消息是简短的系统提示
  if (trimmedText.length > 200) {
    return false;
  }

  // 检查是否以 "Warmup" 开头（不区分大小写）
  return trimmedText.toLowerCase().startsWith('warmup');
}

/**
 * 过滤出可显示的消息
 *
 * 过滤规则：
 * 1. 跳过没有实际内容的元消息（isMeta && !leafUuid && !summary）
 * 2. 跳过只包含工具结果的用户消息（工具结果已在 assistant 消息中显示）
 * 3. 跳过空内容的用户消息
 * 4. （可选）跳过 Warmup 消息及其回复
 *
 * @param messages - 原始消息列表
 * @param options - 过滤选项
 * @returns 过滤后的可显示消息列表
 *
 * @example
 * const displayableMessages = useDisplayableMessages(messages, { hideWarmupMessages: true });
 * // 用于渲染 UI
 */
export function useDisplayableMessages(
  messages: ClaudeStreamMessage[],
  options: DisplayableMessagesOptions = {}
): ClaudeStreamMessage[] {
  // 默认隐藏 Warmup（undefined 时为 true），只有明确设置为 false 时才显示
  const hideWarmupMessages = options.hideWarmupMessages !== false;
  // 默认隐藏启动警告（undefined 时为 true）
  const hideStartupWarnings = options.hideStartupWarnings !== false;

  return useMemo(() => {
    // 单次正向扫描：构建 tool_use_id -> { name } 的索引，并收集 Warmup 索引
    // 通过一次遍历同时完成原本的两遍循环，整体复杂度从 O(n²) 降到 O(n)
    const toolUseIndex = new Map<string, { name: string }>();
    const warmupIndices = new Set<number>();

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      // 收集 assistant 消息中的所有 tool_use
      if (msg.type === 'assistant' && msg.message?.content && Array.isArray(msg.message.content)) {
        for (const item of msg.message.content as any[]) {
          if (item.type === 'tool_use' && item.id) {
            toolUseIndex.set(item.id, { name: item.name || '' });
          }
        }
      }

      // Warmup 检测并入主扫描
      if (hideWarmupMessages && isWarmupMessage(msg)) {
        warmupIndices.add(i);
        if (i + 1 < messages.length && messages[i + 1].type === 'assistant') {
          warmupIndices.add(i + 1);
        }
      }
    }

    return messages.filter((message, index) => {
      // 规则 0：隐藏 Warmup 消息及其回复
      if (hideWarmupMessages && warmupIndices.has(index)) {
        return false;
      }
      // 规则 0.5：隐藏启动期间的系统警告消息
      if (hideStartupWarnings && isStartupWarningMessage(message)) {
        return false;
      }
      // 规则 1：跳过没有实际内容的元消息
      if (message.isMeta && !message.leafUuid && !message.summary) {
        return false;
      }

      // 规则 2 & 3：处理用户消息
      if (message.type === 'user' && message.message) {
        // 跳过元消息标记的用户消息
        if (message.isMeta) return false;

        const msg = message.message;

        // 检查是否有空内容
        if (!msg.content || (Array.isArray(msg.content) && msg.content.length === 0)) {
          return false;
        }

        // 检查是否只包含工具结果
        if (Array.isArray(msg.content)) {
          let hasVisibleContent = false;

          for (const content of msg.content) {
            // 如果有文本内容，保留消息
            if (content.type === 'text') {
              hasVisibleContent = true;
              break;
            }

            // 检查工具结果是否会被跳过（已在 assistant 消息中显示）
            if (content.type === 'tool_result') {
              let willBeSkipped = false;

              if (content.tool_use_id) {
                // O(1) 查询：通过预先构建的索引获取 tool_use 名称
                const toolUse = toolUseIndex.get(content.tool_use_id);

                if (toolUse) {
                  const toolName = toolUse.name?.toLowerCase();

                  if (
                    (toolName && TOOLS_WITH_WIDGETS.has(toolName)) ||
                    toolUse.name?.startsWith('mcp__')
                  ) {
                    willBeSkipped = true;
                  }
                }
              }

              // 如果工具结果不会被跳过，说明有可见内容
              if (!willBeSkipped) {
                hasVisibleContent = true;
                break;
              }
            }
          }

          // 如果没有可见内容，过滤掉这条消息
          if (!hasVisibleContent) {
            return false;
          }
        }
      }

      // 其他情况保留消息
      return true;
    });
  }, [messages, hideWarmupMessages, hideStartupWarnings]);
}
