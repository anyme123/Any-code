import React, { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";

interface CliProcessingIndicatorProps {
  isProcessing: boolean;
  onCancel?: () => void;
}

// CLI风格的处理状态词汇
const PROCESSING_VERBS = [
  "Thinking",
  "Reasoning",
  "Analyzing",
  "Processing",
  "Computing",
  "Evaluating",
  "Unravelling",
  "Pondering",
];

/**
 * CLI风格的处理状态指示器
 * 模仿CLI窗口的 "* Unravelling... (esc to interrupt · thinking)" 样式
 */
export const CliProcessingIndicator: React.FC<CliProcessingIndicatorProps> = ({
  isProcessing,
  onCancel,
}) => {
  const { t } = useTranslation();
  const [dotCount, setDotCount] = useState(0);
  const [verbIndex, setVerbIndex] = useState(0);

  // 随机选择初始动词
  const initialVerbIndex = useMemo(() =>
    Math.floor(Math.random() * PROCESSING_VERBS.length),
    []
  );

  useEffect(() => {
    if (isProcessing) {
      setVerbIndex(initialVerbIndex);
    }
  }, [isProcessing, initialVerbIndex]);

  // 动态省略号动画
  useEffect(() => {
    if (!isProcessing) return;

    const dotInterval = setInterval(() => {
      setDotCount((prev) => (prev + 1) % 4);
    }, 400);

    return () => clearInterval(dotInterval);
  }, [isProcessing]);

  // 定期切换动词
  useEffect(() => {
    if (!isProcessing) return;

    const verbInterval = setInterval(() => {
      setVerbIndex((prev) => (prev + 1) % PROCESSING_VERBS.length);
    }, 3000);

    return () => clearInterval(verbInterval);
  }, [isProcessing]);

  // 监听 Escape 键取消
  useEffect(() => {
    if (!isProcessing || !onCancel) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isProcessing, onCancel]);

  const currentVerb = PROCESSING_VERBS[verbIndex];
  const dots = ".".repeat(dotCount);
  const paddedDots = dots.padEnd(3, " ");

  return (
    <AnimatePresence>
      {isProcessing && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
          className="w-full max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[86%] mx-auto px-4 py-3"
        >
          <div className="command-surface flex items-center gap-2 px-3 py-2 font-mono text-sm shadow-sm">
            <motion.span
              animate={{
                opacity: [1, 0.4, 1],
                scale: [1, 1.2, 1],
              }}
              transition={{
                duration: 1.2,
                repeat: Infinity,
                ease: "easeInOut"
              }}
              className="h-2 w-2 rounded-full bg-primary"
            />

            {/* 动态处理文本 */}
            <span className="text-foreground/90">
              <motion.span
                key={currentVerb}
                initial={{ opacity: 0, x: -5 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 5 }}
                transition={{ duration: 0.2 }}
                className="text-primary font-medium"
              >
                {currentVerb}
              </motion.span>
              <span className="text-muted-foreground font-mono w-[24px] inline-block">
                {paddedDots}
              </span>
            </span>

            {/* 提示信息 */}
            <span className="text-muted-foreground/60 text-xs">
              (
              {onCancel && (
                <button
                  onClick={onCancel}
                  className="hover:text-destructive transition-colors cursor-pointer"
                >
                  {t('cliIndicator.escToCancel', 'esc to cancel')}
                </button>
              )}
              {onCancel && <span className="mx-1">·</span>}
              <span className="inline-flex items-center gap-1">
                <motion.span
                  animate={{ opacity: [0.4, 1, 0.4] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                  className="inline-block w-1.5 h-1.5 rounded-full bg-primary/70"
                />
                {t('cliIndicator.thinking', 'thinking')}
              </span>
              )
            </span>
          </div>

          {/* 底部进度条动画 */}
          <motion.div className="mt-2 h-[2px] bg-muted-foreground/10 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-primary/80"
              animate={{
                x: ["-100%", "100%"],
              }}
              transition={{
                duration: 1.5,
                repeat: Infinity,
                ease: "linear",
              }}
              style={{ width: "50%" }}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default CliProcessingIndicator;
