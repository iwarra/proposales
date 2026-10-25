import type { InputHTMLAttributes } from "react";

export function FileInput({ className = "", ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return (
    <input
      {...props}
      type="file"
      className={`h-12 w-full min-w-0 cursor-pointer rounded-md border border-line bg-background px-1.5 py-[5px] text-sm text-body file:mr-3 file:h-9 file:cursor-pointer file:rounded-full file:border-0 file:bg-chip file:px-4 file:text-sm file:text-foreground ${className}`}
    />
  );
}
