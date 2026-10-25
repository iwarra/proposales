# Build plan

How to build the MVP from scratch. What it does is described in the other docs. This one covers how it's put together and in what order.

## Stack

| Part | Choice | Why |
|---|---|---|
| App | Next.js and TypeScript, hosted on Vercel | Serverless-first. One deploy gives the upload page and the backend |
| AI | Vercel AI SDK, structured output with a zod schema | One call per row, answer shape enforced |
| Storage | Redis (Upstash) | `SET NX` and expiries give duplicate protection and locks without a database server |
| Spreadsheets | node-xlsx (`.csv` and `.xlsx`) | One npm package for both formats, on a patched SheetJS (0.20.2). One dependency, no known CVEs. Handles messy files: semicolons or tabs, quotes, line breaks, BOM, å/ä/ö |
| Tests | Vitest | Fast unit tests for the pure core |

Principles:

- **Functional over OOP, no ORM, minimal abstractions.** Pure functions take their dependencies as arguments, so tests run in memory.
- **Test-driven.** Each module is built test-first.
- **Modular, with shared logic and UI in internal libraries.** Each module below has one entry point and no imports from `app/`. Shared UI (buttons, cards, chips, status badges) lives in `ui/`. Any of them can move into an internal package of a monorepo without changes.

## Modules

```text
src/
  app/                    upload page, server actions, draft route
  ui/                     shared components in the design system below
  lib/
    enquiries/            parse the file, content ids, statuses, storage
    ai/                   the schema, the prompt, the LLM call
    decide/               decide(): the policy table and code checks  ← pure
    proposales/           API client, reading → create-proposal body  ← body is pure
    drafts/               ensureDraft(): exactly one draft per enquiry
    processing/           one row end to end: lock → read → decide → draft
```

The core (`decide()`, the proposal body, statuses) is pure and has no I/O. Redis, the LLM and Proposales sit at the edges and are passed in ([integrations.md](integrations.md)).

## Parsing a row

- The file must be a `.csv` or `.xlsx`, not empty and at most 1 MB, with at most 500 rows. Otherwise the salesperson gets a message they can act on, e.g. *"Upload a .csv or .xlsx file."* or *"The limit is 500 rows per upload. Split it into smaller files."*
- **One parser for both formats.** In the server action that receives the upload: `xlsx.parse(Buffer.from(await file.arrayBuffer()))` from node-xlsx. It detects the format from the contents. It imports `fs`, so it runs in the Node runtime, not Edge.
- **The first sheet only,** with the first row as headers.
- **Every cell is read as text**, so values reach the AI exactly as written. "30-40" and "12-13 March" stay text, and leading zeros in phone numbers are kept. In `.xlsx`, cells formatted as dates become ISO dates (`2027-03-12`).
- **Every non-empty cell is kept under its original header** (`columns`). The AI reads these, so nothing is lost.
- A few headers are recognised up front, after lowercasing and removing everything but letters:

  | Field | Headers |
  |---|---|
  | message | enquiry, inquiry, message, request, body, description |
  | company | company, organisation, organization, client |
  | contact name | contact name, name, contact |
  | contact email | contact email, email, email address (stored lowercase) |
  | received at | received at, received, submitted at, submitted |

  Anything else ("Pax", "Firma", "E-post") is left to the AI.
- **The row's message** is the message column when there is one. Otherwise it's the row's other cells, joined as `Header: value · Header: value`. It's shown in the row list and quoted as the original enquiry in the draft.
- **A row with only contact details** (company, name, email, received date) is rejected with the reason *"Only contact details, no enquiry"*.
- **The AI fills in contact details the sheet lacks.** A value from the sheet always wins over the AI's.

## Storage

| Key | Holds | Written |
|---|---|---|
| `enquiries` | Sorted set of enquiry ids by upload time | On upload |
| `enquiry:{id}` | The uploaded row. `id` is a hash of its content | Once (`NX`) |
| `extraction:{id}` | The AI's reading of the row, plus the last error | After each AI call or failure |
| `draft:{id}` | The Proposales draft's uuid and url | Once (`NX`) |
| `process-lock:{id}` | Held while one worker processes the row | `NX`, expires after 5 min |
| `draft-lock:{id}` | Held around the Proposales create call | `NX`, expires after 60 s |

Statuses are never stored. They're worked out from these keys each time a row is shown ([needs-attention.md](needs-attention.md#all-row-statuses)).

## Design

The page follows **proposales.com**, so it feels like part of Proposales. The values below were taken from that site. Define them once as CSS tokens and use only the tokens.

| Token | Light | Dark | Used for |
|---|---|---|---|
| background | `#ffffff` | `#121212` | Page, cards |
| foreground | `#292929` | `#f2f2f2` | Headings, links |
| body | `#353535` | `#e2e2e2` | Text |
| muted | body at 70% | body at 65% | Secondary text |
| surface | `#f9f9f9` | `#1b1b1b` | Panels |
| surface-warm | `#f6f6f3` | `#1e1e1c` | Highlighted panels |
| chip | `#eeeeee` | `#2a2a2a` | Chips, hover |
| line | black at 12% | white at 14% | Borders |
| button / button text | `#000000` / `#ffffff` | `#ffffff` / `#000000` | Primary buttons |
| danger | `#ce1919` | `#ff6b6b` | Blocked and Failed |

| Element | Style |
|---|---|
| Font | **Switzer** (free from Fontshare), weights 400 and 500. Fallback Arial |
| Text | 16 px, line height 1.5. Headings weight 400, letter spacing −0.01em |
| Primary button | Black pill: 48 px high, 24 px side padding, fully rounded |
| Secondary button | 36 px high, 14 px text, 1 px border, fully rounded |
| Card | 1 px border, **12 px** corners |
| Input | 48 px high, 1 px border, 6 px corners |
| Chip (status) | 24 px high, 13 px text, fully rounded, chip background |
| Focus | 2 px outline in foreground, 2 px offset |

Monochrome throughout. Danger red is the only colour, used for Blocked and Failed. Dark mode follows the system setting.

## Before building: verify two unknowns

1. **The `anyOf` schema gets through the LLM proxy.** Make one LLM-only test call. If it's rejected, use a flat object with a `kind` enum and nullable fields. `decide()` is the same either way.
2. **Proposales can find a proposal by a `data` field.** The third draft guard searches with `filter[enquiry_id]` ([integrations.md](integrations.md#proposales)). Confirm it with one create and one search.

## Order of work

Each step is built test-first and ends with something that runs.

1. **Upload and parse**, as above. Start with tests for both formats: a messy `.csv` (semicolons, a BOM, å/ä/ö, a line break in a quoted cell, "30-40") and an `.xlsx` with a date cell. Then content ids, and saving with `SET NX`, so a re-upload counts duplicates.
2. **`decide()`.** One test per policy cell, code check and row rule ([decide.md](decide.md)). No I/O, so this can be finished before the AI exists.
3. **AI reading.** The schema and prompt from [ai-reading.md](ai-reading.md). Test the call's handling with a fake model, plus one manual check against the real one.
4. **Proposal body.** Reading → title, description, recipient and `data` ([draft.md](draft.md)). Snapshot-style tests for exact, approximate and missing rooms.
5. **Proposales client.** The two endpoints and the retry rules ([integrations.md](integrations.md#timeouts-and-retries)). Tests with a fake `fetch`.
6. **`ensureDraft()`.** The three guards. Tests in memory for double calls, racing calls, and a crash after Proposales created the draft.
7. **Processing.** Lock → read (skip the AI if already read) → `decide()` → `ensureDraft()`. After an upload, run in the background, 4 rows at a time. Failures are saved with their reason.
8. **Page,** in the design above. Upload form, row list with status chips, reasons for blocked rows, Retry and Create draft buttons, the disabled "Fix & create draft — coming next" button. Refreshes itself while rows are in progress.
9. **Deploy to Vercel** with the environment from [integrations.md](integrations.md#environment).
10. **End-to-end test** on the live link with a 3-row sheet: one exact, one approximate, one ambiguous. Expect two drafts and one blocked row. Upload it again and expect no new drafts.
11. **README.** The flow, "what happens when things go wrong" ([when-things-go-wrong.md](when-things-go-wrong.md)), and how concurrent requests are handled. See the definition of done in [case.md](case.md#definition-of-done).

## Testing against Proposales

Proposales is a real account, so calls to it are kept to a minimum:

- Unit tests and AI tests never call Proposales. The client is passed in, and tests use a fake.
- The end-to-end test uses the 3-row sheet once, not a full sheet.

## Left out of the MVP

| Left out | Why |
|---|---|
| Fixing rows in the app, and versioned saves | Next version. Blocked rows show a disabled button |
| A structured list of readings for ambiguous fields | Only the fix UI would use it. The `reason` text names them |
| Extra fields in the proposal's `data` | Only `enquiry_id` is read, by the third draft guard |
| Hidden hints on approximate values (e.g. a month for "mid March") | The salesperson confirms approximate values anyway, and a second value can disagree with the first |
| Catching vague dates in the past | Left to the prompt. An exact date in the past is blocked by code |
| Tracking when the salesperson confirms a value | The row stays Drafted |
| An eval set | The boundary cases are in the prompt. The 3-row sheet is the end-to-end test |
