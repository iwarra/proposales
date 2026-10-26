export type ChipStatus = "received" | "reading" | "drafted" | "blocked" | "ready" | "failed";

const LABELS: Record<ChipStatus, string> = {
  received: "Received",
  reading: "Reading",
  drafted: "Drafted",
  blocked: "Blocked",
  ready: "Ready",
  failed: "Failed",
};

const TONES = {
  danger: { text: "text-danger", dot: "bg-danger" },
  success: { text: "text-success", dot: "bg-success" },
  foreground: { text: "text-foreground", dot: "bg-foreground" },
};

/** Monochrome; success green for Drafted, danger red for Blocked and Failed. */
export function StatusChip({ status }: { status: ChipStatus }) {
  const danger = status === "blocked" || status === "failed";
  const tone = TONES[danger ? "danger" : status === "drafted" ? "success" : "foreground"];
  return (
    <span className={`inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-chip px-2.5 text-[13px] leading-none ${tone.text}`}>
      <span
        aria-hidden
        className={`size-1.5 rounded-full ${tone.dot}${status === "reading" ? "animate-pulse" : ""} ${status === "received" ? "opacity-40" : ""}`}
      />
      {LABELS[status]}
    </span>
  );
}
