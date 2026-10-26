"use client";

import { useActionState } from "react";
import { Button, Card, FileInput } from "@/ui";
import { uploadEnquiries, type UploadState } from "./actions";

export const FILE_INPUT_ID = "file";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** `reading` is whether any row is still being read, so the message doesn't outlive the work. */
function summary(state: Extract<UploadState, { kind: "done" }>, reading: boolean): string {
  const parts: string[] = [];
  if (state.added > 0) {
    const added = plural(state.added, "new enquiry", "new enquiries");
    parts.push(reading ? `${added}. The AI is reading ${state.added === 1 ? "it" : "them"} now.` : `${added} added.`);
  }
  if (state.duplicates > 0) {
    parts.push(
      state.added === 0
        ? `Nothing new: ${state.duplicates === 1 ? "this row was" : `all ${state.duplicates} rows were`} uploaded before.`
        : `${plural(state.duplicates, "row was", "rows were")} uploaded before and skipped.`,
    );
  }
  if (parts.length === 0) parts.push("No enquiries were added.");
  return parts.join(" ");
}

export function UploadForm({ reading }: { reading: boolean }) {
  const [state, action, pending] = useActionState<UploadState, FormData>(uploadEnquiries, { kind: "idle" });

  return (
    <Card tone="warm" className="p-5 sm:p-6">
      <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label htmlFor={FILE_INPUT_ID} className="sr-only">
          Enquiry spreadsheet
        </label>
        <FileInput id={FILE_INPUT_ID} name="file" accept=".csv,.xlsx" required disabled={pending} />
        <Button type="submit" disabled={pending}>
          {pending ? "Uploading…" : "Upload"}
        </Button>
      </form>
      <p className="mt-3 text-sm text-muted">A .csv or .xlsx file. One enquiry per row.</p>

      <div aria-live="polite">
        {state.kind === "error" && <p className="mt-4 text-danger">{state.message}</p>}
        {state.kind === "done" && (
          <div className="mt-4">
            <p className="text-foreground">{summary(state, reading)}</p>
            {state.rejected.length > 0 && (
              <ul className="mt-2 space-y-1 text-sm">
                {state.rejected.map((row) => (
                  <li key={row.line}>
                    <span className="text-foreground">Row {row.line}</span> ({row.label}) was skipped:{" "}
                    <span className="text-danger">{row.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
