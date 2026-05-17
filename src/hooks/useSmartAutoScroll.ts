/**
 * 智能自动滚动 Hook
 *
 * 设计理念（参考 ChatGPT / Slack / Discord 的 Tail-mode 实现）：
 * 1. **单一真理**：滚动状态全部用 ref 管理，避免 React 状态切换重建监听器
 * 2. **用户优先**：捕获 wheel / touch / keyboard / 拖动滚动条，交互期间禁止程序化滚动
 * 3. **自动跟随**：仅当用户未离开底部时自动粘底；用户上滚后保持位置
 * 4. **节流粘底**：流式期间使用单一 rAF 循环，间隔 100ms 比对距离再决定是否滚动
 *
 * 修复要点：
 * - userScrolled 不再是 state，避免 handleScroll 闭包反复重建
 * - 移除 200ms 间隔的 setInterval 修正，避免与用户交互争用
 * - 借助原生交互事件（wheel / touch / mousedown）判定用户意图，
 *   不再依赖 scrollDelta 估算（动量滚动会污染估算）
 */

import { useRef, useState, useEffect, useCallback } from 'react';
import type { ClaudeStreamMessage } from '@/types/claude';

interface SmartAutoScrollConfig {
  displayableMessages: ClaudeStreamMessage[];
  isLoading: boolean;
}

interface SmartAutoScrollReturn {
  parentRef: React.RefObject<HTMLDivElement>;
  userScrolled: boolean;
  setUserScrolled: (scrolled: boolean) => void;
  setShouldAutoScroll: (should: boolean) => void;
}

const BOTTOM_THRESHOLD = 80;        // 距底 80px 视为"在底部"
const NEAR_BOTTOM_RECOVERY = 32;    // 距底 32px 内自动恢复粘底
const STREAM_TICK_INTERVAL = 100;   // 流式粘底间隔
const INTERACTION_RELEASE_DELAY = 220; // 交互释放后延迟判定（兼容动量滚动）

export function useSmartAutoScroll(config: SmartAutoScrollConfig): SmartAutoScrollReturn {
  const { displayableMessages, isLoading } = config;

  const parentRef = useRef<HTMLDivElement>(null);

  // 仅用于通知外部消费者；内部状态走 ref
  const [userScrolled, setUserScrolledStateInternal] = useState(false);

  // 单一状态对象（ref），避免 setState 触发的不必要 re-render
  const stateRef = useRef({
    userScrolled: false,        // 用户已离开底部
    interacting: false,         // 用户正在交互（wheel / drag / touch / key）
    lastAutoScroll: 0,          // 上次程序化滚动时间戳
    prevMessageCount: 0,
  });

  const setUserScrolled = useCallback((v: boolean) => {
    if (stateRef.current.userScrolled === v) return;
    stateRef.current.userScrolled = v;
    setUserScrolledStateInternal(v);
  }, []);

  const setShouldAutoScroll = useCallback((v: boolean) => {
    setUserScrolled(!v);
  }, [setUserScrolled]);

  const distanceFromBottom = useCallback((): number => {
    const el = parentRef.current;
    if (!el) return 0;
    return el.scrollHeight - el.scrollTop - el.clientHeight;
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = parentRef.current;
    if (!el) return;
    if (stateRef.current.interacting) return; // 交互期禁止程序化滚动
    stateRef.current.lastAutoScroll = performance.now();
    // 使用 scrollTop 直接赋值，避免 scrollTo 触发 smooth 兼容差异
    el.scrollTop = el.scrollHeight - el.clientHeight;
  }, []);

  // ============== 用户交互检测 ==============
  // 通过原生事件判定用户意图，不再依赖 scroll 事件 delta（避免动量滚动误判）
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;

    let releaseTimer: number | undefined;
    let scrollbarDragging = false;

    const beginInteraction = () => {
      stateRef.current.interacting = true;
      if (releaseTimer) {
        window.clearTimeout(releaseTimer);
        releaseTimer = undefined;
      }
    };

    const scheduleRelease = () => {
      if (releaseTimer) window.clearTimeout(releaseTimer);
      releaseTimer = window.setTimeout(() => {
        stateRef.current.interacting = false;
        // 释放后基于当前位置重新评估是否恢复粘底
        const dist = distanceFromBottom();
        if (dist <= NEAR_BOTTOM_RECOVERY) {
          setUserScrolled(false);
        } else {
          setUserScrolled(true);
        }
      }, INTERACTION_RELEASE_DELAY);
    };

    const onWheel = (e: WheelEvent) => {
      beginInteraction();
      // 立即决策：向上滚 → 离开底部
      if (e.deltaY < 0) {
        setUserScrolled(true);
      }
      scheduleRelease();
    };

    const onTouchStart = () => beginInteraction();
    const onTouchEnd = () => scheduleRelease();
    const onTouchCancel = () => scheduleRelease();

    const onKeyDown = (e: KeyboardEvent) => {
      const navKeys = ['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' '];
      if (navKeys.includes(e.key)) {
        beginInteraction();
        if (['PageUp', 'Home', 'ArrowUp'].includes(e.key)) {
          setUserScrolled(true);
        }
        scheduleRelease();
      }
    };

    // 拖动滚动条：mousedown 在容器上但 target 不是子节点（即原生滚动条区域）
    const onMouseDown = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      // 落点在右侧滚动条区域（容差 20px）
      const isOnScrollbar = e.clientX > rect.right - 20;
      if (isOnScrollbar) {
        scrollbarDragging = true;
        beginInteraction();
        const onMouseUp = () => {
          scrollbarDragging = false;
          scheduleRelease();
          window.removeEventListener('mouseup', onMouseUp);
        };
        window.addEventListener('mouseup', onMouseUp);
      }
    };

    // scroll 事件仅作辅助：判断是否仍在底部以"自动恢复粘底"
    const onScroll = () => {
      if (scrollbarDragging || stateRef.current.interacting) return;
      const dist = distanceFromBottom();
      // 程序化滚动后 50ms 内不参与判定
      if (performance.now() - stateRef.current.lastAutoScroll < 50) return;
      if (dist > BOTTOM_THRESHOLD) {
        if (!stateRef.current.userScrolled) setUserScrolled(true);
      } else if (dist <= NEAR_BOTTOM_RECOVERY) {
        if (stateRef.current.userScrolled) setUserScrolled(false);
      }
    };

    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchCancel, { passive: true });
    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('keydown', onKeyDown);
    el.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchCancel);
      el.removeEventListener('mousedown', onMouseDown);
      el.removeEventListener('keydown', onKeyDown);
      el.removeEventListener('scroll', onScroll);
      if (releaseTimer) window.clearTimeout(releaseTimer);
    };
    // 故意空依赖：监听器只装一次，全部读 ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============== 新消息到达：若仍在底部则跟随 ==============
  useEffect(() => {
    const count = displayableMessages.length;
    const prev = stateRef.current.prevMessageCount;
    stateRef.current.prevMessageCount = count;

    if (count <= prev) return;
    if (stateRef.current.interacting) return;

    // 仅在已经接近底部时跟随
    if (distanceFromBottom() <= 300 && !stateRef.current.userScrolled) {
      // 双 rAF 等待虚拟列表测量
      const id1 = requestAnimationFrame(() => {
        const id2 = requestAnimationFrame(scrollToBottom);
        // @ts-ignore 保存到外层闭包
        cleanupId = id2;
      });
      let cleanupId = id1;
      return () => cancelAnimationFrame(cleanupId);
    }
  }, [displayableMessages.length, distanceFromBottom, scrollToBottom]);

  // ============== 流式输出粘底循环 ==============
  useEffect(() => {
    if (!isLoading) return;

    let rafId = 0;
    let lastTime = 0;

    const tick = (now: number) => {
      // 用户交互期暂停粘底
      if (stateRef.current.interacting || stateRef.current.userScrolled) {
        rafId = requestAnimationFrame(tick);
        return;
      }
      if (now - lastTime >= STREAM_TICK_INTERVAL) {
        if (distanceFromBottom() > 4) {
          scrollToBottom();
        }
        lastTime = now;
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isLoading, distanceFromBottom, scrollToBottom]);

  return {
    parentRef,
    userScrolled,
    setUserScrolled,
    setShouldAutoScroll,
  };
}
