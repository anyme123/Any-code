/**
 * ✅ Tool Translation Hook - 统一的工具内容翻译逻辑
 *
 * 从 ToolWidgets.tsx 中提取，供所有 Widget 组件复用
 * 提供智能缓存和语言检测
 *
 * @example
 * const { translateContent } = useToolTranslation();
 * const translated = await translateContent('Hello world', 'greeting-key');
 */

import React from 'react';
import { translationMiddleware } from '@/lib/translationMiddleware';

/**
 * 工具内容翻译 Hook
 *
 * Features:
 * - 自动检测内容语言
 * - 内存缓存避免重复翻译
 * - 优雅的错误处理
 */
export const useToolTranslation = () => {
  const cacheRef = React.useRef<Map<string, string>>(new Map());
  const [cacheVersion, setCacheVersion] = React.useState(0);

  const translateContent = React.useCallback(async (content: string, cacheKey: string) => {
    if (cacheRef.current.has(cacheKey)) {
      return cacheRef.current.get(cacheKey)!;
    }

    try {
      const isEnabled = await translationMiddleware.isEnabled();
      if (!isEnabled) {
        return content;
      }

      const detectedLanguage = await translationMiddleware.detectLanguage(content);
      if (detectedLanguage === 'en') {
        const result = await translationMiddleware.translateClaudeResponse(content, true);
        if (result.wasTranslated) {
          cacheRef.current.set(cacheKey, result.translatedText);
          setCacheVersion(v => v + 1);
          return result.translatedText;
        }
      }

      return content;
    } catch (error) {
      console.error('[useToolTranslation] Translation failed:', error);
      return content;
    }
  }, []);

  const clearCache = React.useCallback(() => {
    cacheRef.current = new Map();
    setCacheVersion(v => v + 1);
  }, []);

  return {
    translateContent,
    clearCache,
    cacheSize: cacheRef.current.size,
    cacheVersion,
  };
};
