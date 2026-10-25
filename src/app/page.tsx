import { connection } from "next/server";
import { decide } from "@/lib/decide";
import { listRows, todayUtc, type Row } from "@/lib/enquiries";
import { Button, ButtonLink, Card, StatusChip } from "@/ui";
import { getDeps } from "./deps";
import { AutoRefresh, CreateDraftButton, RetryButton } from "./row-actions";
import { UploadForm } from "./upload-form";

// Covers the background work started by the upload action: up to 500 rows, 4 at a time.
export const maxDuration = 300;

function rowTitle({ enquiry, reading }: Row): string {
  const who = enquiry.company ?? reading?.contact.company ?? enquiry.contactName ?? reading?.contact.name;
  const what = reading?.eventName;
  if (who && what) return `${who}: ${what}`;
  return who ?? what ?? `Enquiry received ${new Date(enquiry.uploadedAt).toISOString().slice(0, 10)}`;
}

function toConfirm(row: Row, today: string): number {
  if (!row.reading) return 0;
  const decision = decide(row.reading, today);
  return decision.action === "draft_with_checks" ? decision.toCheck.length : 0;
}

function RowCard({ row, today }: { row: Row; today: string }) {
  const { status } = row;
  const confirm = status.status === "drafted" ? toConfirm(row, today) : 0;
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 text-base font-medium break-words">{rowTitle(row)}</h3>
        <StatusChip status={status.status} />
      </div>
      <p className="mt-1 line-clamp-2 text-sm whitespace-pre-line text-muted">{row.enquiry.message}</p>

      <div className="mt-3 text-sm">
        {status.status === "drafted" && (
          <div className="flex flex-wrap items-center gap-3">
            <ButtonLink href={status.draft.url} target="_blank" rel="noreferrer">
              Open in Proposales ↗
            </ButtonLink>
            {confirm > 0 && <span className="text-muted">{confirm === 1 ? "1 value" : `${confirm} values`} to confirm</span>}
          </div>
        )}
        {status.status === "reading" && <p className="text-muted">The AI is reading this enquiry…</p>}
        {status.status === "received" &&
          (status.stuck ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-muted">Not read yet.</span>
              <RetryButton id={row.enquiry.id} />
            </div>
          ) : (
            <p className="text-muted">Waiting to be read.</p>
          ))}
        {status.status === "failed" && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-danger">{status.error}</span>
            <RetryButton id={row.enquiry.id} />
          </div>
        )}
        {status.status === "ready" && (
          <div className="flex flex-col gap-2">
            <p className="text-muted">Passes the checks, but has no draft yet.</p>
            <CreateDraftButton id={row.enquiry.id} />
          </div>
        )}
        {status.status === "blocked" && (
          <div className="flex flex-col gap-3">
            <ul className="space-y-1">
              {status.reasons.map((reason) => (
                <li key={reason} className="text-body">
                  {reason}
                </li>
              ))}
            </ul>
            <div>
              <Button variant="secondary" disabled title="Coming in the next version">
                Fix &amp; create draft — coming next
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function Section({ title, hint, rows, today }: { title: string; hint?: string; rows: Row[]; today: string }) {
  if (rows.length === 0) return null;
  return (
    <section className="mt-10">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-xl">{title}</h2>
        <span className="text-sm text-muted">{rows.length}</span>
      </div>
      {hint && <p className="-mt-2 mb-3 text-sm text-muted">{hint}</p>}
      <div className="flex flex-col gap-3">
        {rows.map((row) => (
          <RowCard key={row.enquiry.id} row={row} today={today} />
        ))}
      </div>
    </section>
  );
}

/** Statuses are worked out now, from the stored keys. */
async function loadRows(): Promise<{ today: string } & ({ rows: Row[] } | { error: string })> {
  const now = Date.now();
  const today = todayUtc(now);
  try {
    return { today, rows: await listRows(getDeps().kv, now, today) };
  } catch (error) {
    return { today, error: error instanceof Error ? error.message : "The enquiries couldn't be loaded." };
  }
}

export default async function Page() {
  await connection();
  const loaded = await loadRows();
  const { today } = loaded;
  const rows = "rows" in loaded ? loaded.rows : [];
  const blocked = rows.filter((row) => row.status.status === "blocked");
  const others = rows.filter((row) => row.status.status !== "blocked");
  const inProgress = rows.some((row) => row.status.status === "reading" || (row.status.status === "received" && !row.status.stuck));

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
      <AutoRefresh active={inProgress} />
      <header className="mb-8">
        <p className="text-sm text-muted">Proposales</p>
        <h1 className="mt-1 text-4xl sm:text-5xl">Enquiry desk</h1>
        <p className="mt-3 max-w-xl">
          Upload a spreadsheet of enquiries. The AI reads every row, and a draft proposal appears in Proposales for each one it can safely
          draft.
        </p>
      </header>

      <UploadForm />

      {"error" in loaded && (
        <Card tone="surface" className="mt-6 p-4 text-danger">
          Setup problem: {loaded.error}
        </Card>
      )}

      <Section
        title="Needs attention"
        hint="These could mean two things, so no draft was created. Handle them in Proposales, or fix the row in the sheet and upload it again."
        rows={blocked}
        today={today}
      />
      <Section title="Enquiries" rows={others} today={today} />
      {"rows" in loaded && rows.length === 0 && <p className="mt-10 text-muted">No enquiries yet. Upload a sheet to start.</p>}
    </main>
  );
}
