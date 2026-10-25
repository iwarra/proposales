"use client";

import { useActionState } from "react";
import { Button, Card, FileInput } from "@/ui";
import { uploadEnquiries, type UploadState } from "./actions";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function summary(state: Extract<UploadState, { kind: "done" }>): string {
  const parts: string[] = [];
  if (state.added > 0) parts.push(`${plural(state.added, "new enquiry", "new enquiries")}. The AI is reading ${state.added === 1 ? "it" : "them"} now.`);
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

export function UploadForm() {
  const [state, action, pending] = useActionState<UploadState, FormData>(uploadEnquiries, { kind: "idle" });

  return (
    <Card tone="warm" className="p-5 sm:p-6">
      <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label htmlFor="file" className="sr-only">
          Enquiry spreadsheet
        </label>
        <FileInput id="file" name="file" accept=".csv,.xlsx" required disabled={pending} />
        <Button type="submit" disabled={pending}>
          {pending ? "Uploading…" : "Upload"}
        </Button>
      </form>
      <p className="mt-3 text-sm text-muted">One enquiry per row, headers in the first row. A .csv or .xlsx file, up to 1 MB and 500 rows.</p>

      <div aria-live="polite">
        {state.kind === "error" && <p className="mt-4 text-danger">{state.message}</p>}
        {state.kind === "done" && (
          <div className="mt-4">
            <p className="text-foreground">{summary(state)}</p>
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
