import React, { useState, useEffect, useCallback } from "react";
import { X, ZoomIn, ZoomOut, ChevronLeft, ChevronRight } from "lucide-react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useTranslation } from "@/hooks/useTranslation";

/**
 * 图片数据结构（从消息内容中提取）
 */
export interface MessageImage {
  /** 图片类型: base64, url 或 file（本地文件路径） */
  sourceType: "base64" | "url" | "file";
  /** base64 数据、URL 或文件路径 */
  data: string;
  /** 媒体类型，如 image/png, image/jpeg */
  mediaType?: string;
}

interface MessageImagePreviewProps {
  /** 图片列表 */
  images: MessageImage[];
  /** 自定义类名 */
  className?: string;
  /** 缩略图尺寸 */
  thumbnailSize?: number;
  /** 紧凑模式（用于消息气泡内） */
  compact?: boolean;
}

/**
 * Lightbox 模态框组件
 */
interface ImageLightboxProps {
  images: MessageImage[];
  currentIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

const ImageLightbox: React.FC<ImageLightboxProps> = ({
  images,
  currentIndex,
  onClose,
  onNavigate,
}) => {
  const { t } = useTranslation();
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const currentImage = images[currentIndex];

  // 获取图片 src
  const getImageSrc = (image: MessageImage): string => {
    if (image.sourceType === "base64") {
      return `data:${image.mediaType || "image/png"};base64,${image.data}`;
    }
    if (image.sourceType === "file") {
      return convertFileSrc(image.data);
    }
    return image.data;
  };

  // 重置缩放和位置
  const resetTransform = useCallback(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, []);

  // 切换图片时重置
  useEffect(() => {
    resetTransform();
  }, [currentIndex, resetTransform]);

  // ESC 键关闭，方向键切换
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          onClose();
          break;
        case "ArrowLeft":
          if (images.length > 1) {
            onNavigate((currentIndex - 1 + images.length) % images.length);
          }
          break;
        case "ArrowRight":
          if (images.length > 1) {
            onNavigate((currentIndex + 1) % images.length);
          }
          break;
        case "+":
        case "=":
          setScale((s) => Math.min(s + 0.25, 5));
          break;
        case "-":
          setScale((s) => Math.max(s - 0.25, 0.5));
          break;
        case "0":
          resetTransform();
          break;
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, onNavigate, currentIndex, images.length, resetTransform]);

  // 鼠标滚轮缩放
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setScale((s) => Math.max(0.5, Math.min(5, s + delta)));
  };

  // 拖拽功能
  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale > 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && scale > 1) {
      setPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // 双击切换缩放
  const handleDoubleClick = () => {
    if (scale === 1) {
      setScale(2);
    } else {
      resetTransform();
    }
  };

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center"
      style={{ zIndex: 9999 }}
      onClick={onClose}
      onWheel={handleWheel}
    >
      {/* 顶部工具栏 */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-white/10 backdrop-blur-md rounded-full px-4 py-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setScale((s) => Math.max(s - 0.25, 0.5));
          }}
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/20 text-white transition-colors"
          title={t('imagePreview.zoomOut')}
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <span className="text-white text-sm min-w-[60px] text-center">
          {Math.round(scale * 100)}%
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setScale((s) => Math.min(s + 0.25, 5));
          }}
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/20 text-white transition-colors"
          title={t('imagePreview.zoomIn')}
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        {images.length > 1 && (
          <span className="text-white/70 text-sm ml-2">
            {currentIndex + 1} / {images.length}
          </span>
        )}
      </div>

      {/* 关闭按钮 */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 w-10 h-10 bg-white/10 hover:bg-white/20 text-white rounded-full flex items-center justify-center transition-colors"
        title={t('imagePreview.close')}
      >
        <X className="h-5 w-5" />
      </button>

      {/* 图片容器 */}
      <div
        className={cn(
          "relative max-w-[90vw] max-h-[85vh] overflow-hidden",
          scale > 1 ? "cursor-grab" : "cursor-zoom-in",
          isDragging && "cursor-grabbing"
        )}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDoubleClick}
      >
        <img
          src={getImageSrc(currentImage)}
          alt={t('imagePreview.image', { index: currentIndex + 1 })}
          className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg shadow-2xl select-none"
          style={{
            transform: `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)`,
            transition: isDragging ? "none" : "transform 0.2s ease-out",
          }}
          draggable={false}
        />
      </div>

      {/* 左右切换按钮 */}
      {images.length > 1 && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onNavigate((currentIndex - 1 + images.length) % images.length);
            }}
            className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-white/10 hover:bg-white/20 text-white rounded-full flex items-center justify-center transition-colors"
            title={t('imagePreview.prevImage')}
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onNavigate((currentIndex + 1) % images.length);
            }}
            className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-white/10 hover:bg-white/20 text-white rounded-full flex items-center justify-center transition-colors"
            title={t('imagePreview.nextImage')}
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        </>
      )}

      {/* 底部缩略图导航（多张图片时显示） */}
      {images.length > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-white/10 backdrop-blur-md rounded-lg p-2">
          {images.map((image, index) => (
            <button
              key={index}
              onClick={(e) => {
                e.stopPropagation();
                onNavigate(index);
              }}
              className={cn(
                "w-12 h-12 rounded-md overflow-hidden border-2 transition-all",
                index === currentIndex
                  ? "border-white scale-110"
                  : "border-transparent opacity-60 hover:opacity-100"
              )}
            >
              <img
                src={getImageSrc(image)}
                alt={t('imagePreview.thumbnail', { index: index + 1 })}
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </motion.div>,
    document.body
  );
};

/**
 * 消息图片预览组件
 * 用于在消息气泡中显示图片缩略图，点击可放大查看
 */
export const MessageImagePreview: React.FC<MessageImagePreviewProps> = ({
  images,
  className,
  thumbnailSize = 150,
  compact = false,
}) => {
  const { t } = useTranslation();
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [imageErrors, setImageErrors] = useState<Set<number>>(new Set());

  if (!images || images.length === 0) return null;

  // 获取图片 src
  const getImageSrc = (image: MessageImage): string => {
    if (image.sourceType === "base64") {
      return `data:${image.mediaType || "image/png"};base64,${image.data}`;
    }
    if (image.sourceType === "file") {
      return convertFileSrc(image.data);
    }
    return image.data;
  };

  const handleImageError = (index: number) => {
    setImageErrors((prev) => new Set(prev).add(index));
  };

  // 紧凑模式的尺寸
  const compactSize = 56;
  const actualSize = compact ? compactSize : thumbnailSize;

  return (
    <>
      {/* 紧凑模式：独立子气泡样式 */}
      {compact ? (
        <div className={cn(
          "inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg",
          "bg-[var(--surface-panel)] border border-[var(--surface-hairline-soft)] shadow-sm",
          className
        )}>
          {images.map((image, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.15 }}
              className="relative group flex-shrink-0"
            >
              <div
                className="relative rounded overflow-hidden cursor-pointer ring-1 ring-black/10 dark:ring-white/10 hover:ring-primary/50 transition-all"
                style={{ width: compactSize, height: compactSize }}
                onClick={() => setSelectedIndex(index)}
              >
                {imageErrors.has(index) ? (
                  <div className="w-full h-full bg-slate-300 dark:bg-slate-600 flex items-center justify-center">
                    <span className="text-[10px] text-slate-500 dark:text-slate-400">{t('imagePreview.error')}</span>
                  </div>
                ) : (
                  <img
                    src={getImageSrc(image)}
                    alt={t('imagePreview.image', { index: index + 1 })}
                    className="w-full h-full object-cover"
                    onError={() => handleImageError(index)}
                    loading="lazy"
                  />
                )}
                {/* 悬停放大图标 */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                  <ZoomIn className="h-3.5 w-3.5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
            </motion.div>
          ))}
          {/* 图片数量提示 */}
          {images.length > 1 && (
            <span className="text-[10px] text-slate-500 dark:text-slate-400 ml-0.5">
              {t('imagePreview.imageCount', { count: images.length })}
            </span>
          )}
        </div>
      ) : (
        /* 标准模式：网格布局 */
        <div
          className={cn(
            "grid gap-2 mt-2",
            images.length === 1 && "grid-cols-1",
            images.length === 2 && "grid-cols-2",
            images.length >= 3 && "grid-cols-3"
          )}
          style={{ maxWidth: actualSize * Math.min(images.length, 3) + (Math.min(images.length, 3) - 1) * 8 }}
        >
          <AnimatePresence>
            {images.map((image, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.2, delay: index * 0.05 }}
                className="relative group"
              >
                <div
                  className={cn(
                    "relative rounded-lg overflow-hidden border border-border/50 cursor-pointer",
                    "hover:border-primary/50 hover:shadow-md transition-all duration-200",
                    className
                  )}
                  style={{
                    width: images.length === 1 ? actualSize * 1.5 : actualSize,
                    height: images.length === 1 ? actualSize : actualSize * 0.75,
                  }}
                  onClick={() => setSelectedIndex(index)}
                >
                  {imageErrors.has(index) ? (
                    <div className="w-full h-full bg-muted flex items-center justify-center">
                      <span className="text-xs text-muted-foreground">{t('imagePreview.loadFailed')}</span>
                    </div>
                  ) : (
                    <img
                      src={getImageSrc(image)}
                      alt={t('imagePreview.image', { index: index + 1 })}
                      className="w-full h-full object-cover"
                      onError={() => handleImageError(index)}
                      loading="lazy"
                    />
                  )}

                  {/* 悬停遮罩 */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                    <ZoomIn className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Lightbox 模态框 */}
      <AnimatePresence>
        {selectedIndex !== null && (
          <ImageLightbox
            images={images}
            currentIndex={selectedIndex}
            onClose={() => setSelectedIndex(null)}
            onNavigate={setSelectedIndex}
          />
        )}
      </AnimatePresence>
    </>
  );
};

/**
 * 从消息内容中提取图片
 * @param content 消息内容数组
 * @returns 图片数组
 */
export const extractImagesFromContent = (content: any[]): MessageImage[] => {
  if (!Array.isArray(content)) return [];

  const images: MessageImage[] = [];

  for (const item of content) {
    if (item.type !== "image") continue;

    const source = item.source;
    if (source?.type === "base64") {
      images.push({
        sourceType: "base64",
        data: source.data,
        mediaType: source.media_type,
      });
    } else if (source?.type === "url") {
      images.push({
        sourceType: "url",
        data: source.url,
        mediaType: source.media_type,
      });
    } else if (item.data) {
      // 处理其他可能的格式
      images.push({
        sourceType: "base64",
        data: item.data,
        mediaType: item.media_type || "image/png",
      });
    }
  }

  return images;
};

/**
 * 图片文件扩展名列表
 */
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];

/**
 * 检查路径是否是图片文件
 */
const isImagePath = (path: string): boolean => {
  const lowerPath = path.toLowerCase();
  return IMAGE_EXTENSIONS.some(ext => lowerPath.endsWith(ext));
};

/**
 * 从消息文本中提取图片路径（@path 格式）
 * 支持以下格式:
 * - @C:\path\to\image.png
 * - @"C:\path with spaces\image.png"
 * - @/path/to/image.png
 * - "C:\path\to\image.png" (Codex 格式，无 @ 前缀)
 *
 * @param text 消息文本
 * @returns { images: 图片数组, cleanText: 移除图片路径后的文本 }
 */
export const extractImagePathsFromText = (text: string): { images: MessageImage[]; cleanText: string } => {
  if (!text) return { images: [], cleanText: text };

  const images: MessageImage[] = [];
  let cleanText = text;

  // 正则匹配模式:
  // 1. @"path with spaces" - 带引号的路径（有 @ 前缀）
  // 2. @path - 不带引号的路径（有 @ 前缀）
  // 3. "path" - 带引号的路径（无 @ 前缀，Codex 格式）

  // 模式1: @"..." 格式
  const quotedAtPattern = /@"([^"]+)"/g;
  let match;

  while ((match = quotedAtPattern.exec(text)) !== null) {
    const path = match[1];
    if (isImagePath(path)) {
      images.push({
        sourceType: "file",
        data: path,
      });
      cleanText = cleanText.replace(match[0], '');
    }
  }

  // 模式2: @path 格式（不带引号）
  // 匹配 @ 后面的路径，直到空格或字符串结束
  const unquotedAtPattern = /@([^\s"]+)/g;

  while ((match = unquotedAtPattern.exec(text)) !== null) {
    const path = match[1];
    if (isImagePath(path)) {
      // 检查是否已经被引号模式匹配过
      const fullMatch = match[0];
      if (cleanText.includes(fullMatch)) {
        images.push({
          sourceType: "file",
          data: path,
        });
        cleanText = cleanText.replace(fullMatch, '');
      }
    }
  }

  // 模式3: "path" 格式（Codex 格式，带引号但无 @ 前缀）
  // 只匹配看起来像文件路径的带引号字符串
  const quotedPathPattern = /"([A-Za-z]:\\[^"]+|\/[^"]+)"/g;

  while ((match = quotedPathPattern.exec(text)) !== null) {
    const path = match[1];
    if (isImagePath(path)) {
      // 检查是否已经被其他模式匹配过
      const fullMatch = match[0];
      if (cleanText.includes(fullMatch)) {
        images.push({
          sourceType: "file",
          data: path,
        });
        cleanText = cleanText.replace(fullMatch, '');
      }
    }
  }

  // 模式4: 直接路径格式（Codex 格式，无引号无 @ 前缀）
  // 匹配 Windows 路径 C:\...\image.png 或 Unix 路径 /path/to/image.png
  // 注意：这个模式要在最后，因为它比较宽松
  const directPathPattern = /(?:^|\s)([A-Za-z]:\\[^\s"]+|\/(?:[^\s"]+\/)+[^\s"]+)(?=\s|$)/g;

  while ((match = directPathPattern.exec(text)) !== null) {
    const path = match[1];
    if (isImagePath(path)) {
      // 检查是否已经被其他模式匹配过
      if (cleanText.includes(path)) {
        images.push({
          sourceType: "file",
          data: path,
        });
        cleanText = cleanText.replace(path, '');
      }
    }
  }

  // 清理多余的空格（保留换行符）
  cleanText = cleanText
    .replace(/[^\S\n]+/g, ' ')  // 只替换非换行的空白字符为单个空格
    .replace(/ *\n */g, '\n')   // 清理换行符两边的空格
    .trim();

  return { images, cleanText };
};
