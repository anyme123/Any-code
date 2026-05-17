import * as React from "react";
import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

/**
 * Minimalist Input Component - Clean & Focused
 * Features: Simple borders, fast color transitions
 */

const inputVariants = cva(
  "flex w-full rounded-lg border px-3 py-2 text-[15px] transition-colors duration-150 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--surface-code)] border-border hover:border-border-hover focus:border-primary",
        filled:
          "bg-muted border-transparent hover:bg-[var(--color-muted-hover)] focus:border-primary",
      },
      inputSize: {
        sm: "h-8 px-2.5 py-1.5 text-sm rounded-md",
        default: "h-9 px-3 py-2 text-[15px] rounded-lg",
        lg: "h-10 px-4 py-2.5 text-base rounded-lg",
      },
    },
    defaultVariants: {
      variant: "default",
      inputSize: "default",
    },
  }
);

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement>,
    VariantProps<typeof inputVariants> {}

/**
 * Input component for text/number inputs with minimal styling
 *
 * @example
 * <Input
 *   type="text"
 *   placeholder="Enter value..."
 *   variant="default"
 * />
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, variant, inputSize, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          inputVariants({ variant, inputSize }),
          "file:border-0 file:bg-transparent file:text-sm file:font-medium",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);

Input.displayName = "Input";

export { Input };
