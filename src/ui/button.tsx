import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary";

const styles: Record<Variant, string> = {
  primary:
    "h-12 px-6 text-base bg-button text-button-text hover:opacity-85 disabled:opacity-40",
  secondary:
    "h-9 px-4 text-sm border border-line text-foreground hover:bg-chip disabled:opacity-50 disabled:hover:bg-transparent",
};

const base = "inline-flex shrink-0 items-center justify-center gap-2 rounded-full whitespace-nowrap transition disabled:cursor-not-allowed";

export function Button({ variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button {...props} className={`${base} ${styles[variant]} ${className}`} />;
}

/** A link styled as a button. */
export function ButtonLink({ variant = "secondary", className = "", ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: Variant }) {
  return <a {...props} className={`${base} ${styles[variant]} no-underline ${className}`} />;
}
