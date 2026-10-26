"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/ui";
import { createDraftNow, retryEnquiry } from "./actions";

export function RetryButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button variant="secondary" disabled={pending} onClick={() => start(() => retryEnquiry(id))}>
      {pending ? "Retrying…" : "Retry"}
    </Button>
  );
}

export function CreateDraftButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ message: string; failed: boolean } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="secondary" disabled={pending} onClick={() => start(async () => setResult(await createDraftNow(id)))}>
        {pending ? "Creating…" : "Create draft"}
      </Button>
      {result && <span className={`text-sm ${result.failed ? "text-danger" : "text-muted"}`}>{result.message}</span>}
    </div>
  );
}

/** Refreshes the page every few seconds while any row is still being read. */
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), 2500);
    return () => clearInterval(timer);
  }, [active, router]);
  return null;
}
