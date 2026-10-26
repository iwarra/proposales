import type { HTMLAttributes } from "react";

export function Card({ tone = "plain", className = "", ...props }: HTMLAttributes<HTMLDivElement> & { tone?: "plain" | "surface" | "warm" }) {
  const background = { plain: "bg-background", surface: "bg-surface", warm: "bg-surface-warm" }[tone];
  return <div {...props} className={`rounded-xl border border-line ${background} ${className}`} />;
}
