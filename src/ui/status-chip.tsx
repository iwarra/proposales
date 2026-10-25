export type ChipStatus = "received" | "reading" | "drafted" | "blocked" | "ready" | "failed";

const LABELS: Record<ChipStatus, string> = {
  received: "Received",
  reading: "Reading",
  drafted: "Drafted",
  blocked: "Blocked",
  ready: "Ready",
  failed: "Failed",
};

/** Monochrome; danger red only for Blocked and Failed. */
export function StatusChip({ status }: { status: ChipStatus }) {
  const danger = status === "blocked" || status === "failed";
  return (
    <span className={`inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-chip px-2.5 text-[13px] leading-none ${danger ? "text-danger" : "text-foreground"}`}>
      <span
        aria-hidden
        className={`size-1.5 rounded-full ${danger ? "bg-danger" : "bg-foreground"} ${status === "reading" ? "animate-pulse" : ""} ${status === "received" ? "opacity-40" : ""}`}
      />
      {LABELS[status]}
    </span>
  );
}
