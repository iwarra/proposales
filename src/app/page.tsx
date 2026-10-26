import { connection } from "next/server";
import { decide } from "@/lib/decide";
import { isBeingRead, listRows, todayUtc, type Row } from "@/lib/enquiries";
import { Button, ButtonLink, Card, StatusChip } from "@/ui";
import { getDeps } from "./deps";
import { DemoBanner } from "./demo-banner";
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
              Open the draft
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
            {/* Disabled buttons get no hover events, so the tooltip hangs off the wrapper. */}
            <div className="group relative w-fit" tabIndex={0} aria-describedby={`v2-${row.enquiry.id}`}>
              <Button variant="secondary" disabled>
                Fix &amp; create draft
              </Button>
              <span
                id={`v2-${row.enquiry.id}`}
                role="tooltip"
                className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-md bg-button px-2.5 py-1.5 text-[13px] whitespace-nowrap text-button-text opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100"
              >
                Coming in V2
              </span>
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
    <section className="mt-14 sm:mt-16">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-2xl sm:text-3xl">{title}</h2>
        <span className="text-base text-muted">{rows.length}</span>
      </div>
      {hint && <p className="-mt-1 mb-6 max-w-xl text-sm text-muted">{hint}</p>}
      <div className="flex flex-col gap-4">
        {rows.map((row) => (
          <RowCard key={row.enquiry.id} row={row} today={today} />
        ))}
      </div>
    </section>
  );
}

const DraftedIcon = () => (
  <svg aria-hidden viewBox="0 0 16 16" width="16" height="16" className="shrink-0">
    <circle cx="8" cy="8" r="8" className="fill-success" />
    <path d="M4.5 8.2l2.3 2.3 4.7-4.7" fill="none" className="stroke-background" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const BlockedIcon = () => (
  <svg aria-hidden viewBox="0 0 16 16" width="16" height="16" className="shrink-0">
    <circle cx="8" cy="8" r="8" className="fill-danger" />
    <circle cx="8" cy="8" r="4.2" fill="none" className="stroke-background" strokeWidth="1.6" />
    <path d="M5 5l6 6" className="stroke-background" strokeWidth="1.6" />
  </svg>
);

const ProcessedIcon = () => (
  <svg aria-hidden viewBox="0 0 16 16" width="16" height="16" className="shrink-0">
    <circle cx="8" cy="8" r="7" fill="none" className="stroke-foreground" strokeWidth="1.6" />
  </svg>
);

/** Processed means the AI has finished with the row: anything but Received or Reading. */
function Summary({ rows }: { rows: Row[] }) {
  if (rows.length === 0) return null;
  const count = (...statuses: Row["status"]["status"][]) => rows.filter((row) => statuses.includes(row.status.status)).length;
  const beingRead = rows.filter((row) => isBeingRead(row.status)).length;
  const stats = [
    { label: "Processed", value: rows.length - count("received", "reading"), icon: <ProcessedIcon /> },
    { label: "Drafted", value: count("drafted"), icon: <DraftedIcon /> },
    { label: "Blocked", value: count("blocked"), icon: <BlockedIcon /> },
  ];
  return (
    <section aria-label="Summary" className="mt-8">
      <Card tone="surface" className="px-2 py-1">
        {/* Stacked rows on phones, one row of columns from sm up. */}
        <dl className="grid grid-cols-1 divide-y divide-line sm:grid-cols-3 sm:divide-y-0">
          {stats.map(({ label, value, icon }) => (
            <div key={label} className="flex items-center gap-3 px-3 py-3 sm:flex-col sm:items-start sm:gap-1 sm:px-4">
              {icon}
              <dt className="text-sm text-muted">{label}</dt>
              <dd className="ml-auto text-lg font-medium text-foreground sm:ml-0">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
      {beingRead > 0 && <p className="mt-2 text-sm text-muted">{beingRead} more being read by the AI…</p>}
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
  const inProgress = rows.some((row) => isBeingRead(row.status));

  return (
    <>
      <DemoBanner />
      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
        <AutoRefresh active={inProgress} />
        <header className="mb-8">
          <p className="text-xl font-medium text-muted">Proposales</p>
          <h1 className="mt-1 text-4xl sm:text-5xl">Enquiry desk</h1>
          <p className="mt-3 max-w-xl">
            Upload a spreadsheet and let AI draft proposals. Blocked enquiries will be listed below for your immediate attention.
          </p>
        </header>

        <UploadForm reading={inProgress} />
        <Summary rows={rows} />

        {"error" in loaded && (
          <Card tone="surface" className="mt-6 p-4 text-danger">
            Setup problem: {loaded.error}
          </Card>
        )}

        <Section title="Needs attention" hint="No draft was created for these." rows={blocked} today={today} />
        <Section title="Enquiries" rows={others} today={today} />
        {"rows" in loaded && rows.length === 0 && <p className="mt-10 text-muted">No enquiries yet. Upload a sheet to start.</p>}
      </main>
    </>
  );
}
