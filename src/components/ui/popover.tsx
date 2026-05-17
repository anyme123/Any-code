import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface PopoverProps {
  /**
   * The trigger element
   */
  trigger: React.ReactNode;
  /**
   * The content to display in the popover
   */
  content: React.ReactNode;
  /**
   * Whether the popover is open
   */
  open?: boolean;
  /**
   * Callback when the open state changes
   */
  onOpenChange?: (open: boolean) => void;
  /**
   * Optional className for the content
   */
  className?: string;
  /**
   * Alignment of the popover relative to the trigger
   */
  align?: "start" | "center" | "end";
  /**
   * Side of the trigger to display the popover
   */
  side?: "top" | "bottom" | "left" | "right";
}

/**
 * Popover component for displaying floating content
 *
 * @example
 * <Popover
 *   trigger={<Button>Click me</Button>}
 *   content={<div>Popover content</div>}
 *   side="top"
 * />
 */
export const Popover: React.FC<PopoverProps> = ({
  trigger,
  content,
  open: controlledOpen,
  onOpenChange,
  className,
  align = "center",
  side = "bottom",
}) => {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = onOpenChange || setInternalOpen;

  const triggerRef = React.useRef<HTMLDivElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);

  // Close on click outside
  React.useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      // Check if click is inside trigger or content
      if (triggerRef.current?.contains(target) || contentRef.current?.contains(target)) {
        return;
      }

      // Check if click is inside a Radix Portal (e.g., Select dropdown)
      const radixPortal = target.closest('[data-radix-popper-content-wrapper], [data-radix-select-viewport], [role="listbox"], [data-radix-portal]');
      if (radixPortal) {
        return;
      }

      // Check for radix-related attributes in parent chain
      let element: HTMLElement | null = target;
      while (element && element !== document.body) {
        if (element.hasAttribute('data-radix-collection-item') || element.getAttribute('role') === 'option') {
          return;
        }
        element = element.parentElement;
      }

      setOpen(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, setOpen]);

  // Close on escape
  React.useEffect(() => {
    if (!open) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open, setOpen]);

  // 水平方向（left/right）时使用垂直对齐
  const isHorizontal = side === "left" || side === "right";

  const alignClass = isHorizontal
    ? {
        start: "top-0",
        center: "top-1/2 -translate-y-1/2",
        end: "bottom-0",
      }[align]
    : {
        start: "left-0",
        center: "left-1/2 -translate-x-1/2",
        end: "right-0",
      }[align];

  const sideClass = {
    top: "bottom-full mb-2",
    bottom: "top-full mt-2",
    left: "right-full mr-2",
    right: "left-full ml-2",
  }[side];

  const getAnimation = () => {
    switch (side) {
      case "top":
        return { initial: { y: 10 }, exit: { y: 10 } };
      case "bottom":
        return { initial: { y: -10 }, exit: { y: -10 } };
      case "left":
        return { initial: { x: 10 }, exit: { x: 10 } };
      case "right":
        return { initial: { x: -10 }, exit: { x: -10 } };
    }
  };
  const animation = getAnimation();

  return (
    <div className="relative inline-block">
      <div
        ref={triggerRef}
        onClick={() => setOpen(!open)}
      >
        {trigger}
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={contentRef}
            initial={{ opacity: 0, scale: 0.95, ...animation?.initial }}
            animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, ...animation?.exit }}
            transition={{ duration: 0.15 }}
            className={cn(
              "absolute z-50 min-w-[200px] rounded-lg border border-[var(--surface-hairline-soft)] bg-popover p-4 text-popover-foreground shadow-lg",
              sideClass,
              alignClass,
              className
            )}
          >
            {content}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
