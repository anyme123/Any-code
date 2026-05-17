import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Modern Button Component - Material 3 Inspired
 * Features:
 * - Micro-interactions (Scale on press)
 * - Smooth transitions
 * - Focus rings for accessibility
 * - Refined shadows and rounding
 */

const buttonVariants = cva(
  // Base styles: Layout, Focus, Transition, Disabled state
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.99]",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-sm hover:bg-[var(--color-primary-hover)]",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-[var(--color-destructive-hover)]",
        outline:
          "border border-border bg-background/40 shadow-xs hover:bg-accent hover:text-accent-foreground hover:border-border-hover",
        secondary:
          "bg-secondary text-secondary-foreground border border-border/60 hover:bg-[var(--color-secondary-hover)]",
        ghost:
          "hover:bg-accent hover:text-accent-foreground",
        link:
          "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 rounded-lg has-[>svg]:px-3",
        sm: "h-8 rounded-md px-3 has-[>svg]:px-2.5 text-xs",
        lg: "h-10 rounded-lg px-8 has-[>svg]:px-4",
        icon: "h-9 w-9 rounded-lg",
        "icon-sm": "h-8 w-8 rounded-md",
        "icon-xs": "h-6 w-6 rounded-md",
        "icon-lg": "h-10 w-10 rounded-lg",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

/**
 * Button component with modern interactions
 */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
