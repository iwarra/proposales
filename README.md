# Enquiry desk: proposals that create themselves

A hotel salesperson uploads a spreadsheet of enquiries. The AI reads every row, and a draft proposal appears in [Proposales](https://proposales.com) for each one it can safely draft.

> **Vague is fine. Ambiguous is not.**
>
> Clear → draft. Vague → draft, marked for you to confirm. Could mean two things → we tell you why, and you handle it.

The full spec is in [`mvp-docs/`](mvp-docs/README.md).

## The flow

1. **Upload.** A `.csv` or `.xlsx`, one enquiry per row, up to 1 MB and 500 rows. Each row is stored once, under a hash of its content.
2. **The AI reads each row**, whatever the columns are called ("Pax", "Firma", "Antal gäster"). One LLM call per row, with structured output.
3. **The AI labels** the dates, the guest count and the rooms count: `exact`, `approximate`, `ambiguous` or `missing`. It also says whether the row is an event enquiry at all.
4. **Code decides, not the AI.** `decide()` ([src/lib/decide/decide.ts](src/lib/decide/decide.ts)) applies one policy table:

   | Field | exact | approximate | ambiguous | missing |
   |---|---|---|---|---|
   | dates | ✅ if it passes the checks | ✅ to confirm | ❌ | ❌ |
   | guests | ✅ if it passes the checks | ✅ to confirm | ❌ | ❌ |
   | rooms | ✅ if it passes the checks | ✅ to confirm | ❌ | ✅ optional |

   Not an event enquiry → ❌. An exact value that fails a code check (a date like `2027-02-30`, a start date in the past, an end before the start, fewer than 1 guest, negative rooms) → ❌.
5. **The draft appears in Proposales.** Approximate values are shown as the client wrote them, with a "To check" list and the original enquiry quoted.
6. **Blocked rows are listed under "Needs attention"** with every reason, and a disabled "Fix & create draft — coming next" button.

## What happens when things go wrong

Any step can fail, run twice, or run at the same time as another, without creating duplicates.

| What goes wrong | What the salesperson sees | What happens next |
|---|---|---|
| The file isn't a `.csv` or `.xlsx`, can't be read, is empty, is over 1 MB or has over 500 rows | A message they can act on, e.g. *"Upload a .csv or .xlsx file."* | Nothing is stored |
| A row has only contact details | Listed as skipped, with the reason | The row isn't stored |
| The AI times out, the proxy is down, or the answer doesn't fit the schema | **Failed**: "The AI couldn't read this enquiry: …" | **Retry** sends the row to the AI again |
| The AI's answer is unclear or wrong | **Blocked**, with every reason | The salesperson handles it, or fixes the row in the sheet and uploads it again |
| Proposales is down or rejects the request | **Failed**: "Couldn't create the draft in Proposales: …" | **Retry** goes straight to creating the draft. The AI isn't called again |
| Proposales rejects the token or company id (401/403) | **Failed**, saying it's a setup problem and naming the variables | Fix `.env.local`, then Retry |
| A worker stops partway through | The row stays Received or Ready | After 60 s a **Retry** button appears, or **Create draft** |
| A required environment variable is missing or malformed | A message naming the variable | Nothing is called |

**Every Retry is safe to click any number of times.**

### Timeouts and retries

- **LLM:** 45 s per attempt, and the SDK retries twice. A failure is saved on the row with its reason, never thrown away.
- **Proposales:** 8 s per request and at most 3 attempts, with 250 ms then 500 ms backoff. Whether a failure is retried depends on whether it could have had an effect:

  | Failure | Search | Create |
  |---|---|---|
  | No response (network error, timeout) | Retry | **Don't retry.** The draft may exist |
  | 5xx | Retry | **Don't retry.** The draft may exist |
  | 429 | Retry | Retry. Nothing was created |
  | Other 4xx | Don't retry | Don't retry |

  A create that may have succeeded is never repeated blindly: the next attempt searches Proposales first (guard 3 below).

### Duplicates

- **The same file uploaded twice:** each row's id is a hash of its content, and rows are saved with `SET NX`. A row seen before is counted as a duplicate, and nothing new is stored or processed.
- **A row the AI already read** isn't sent to the AI again, so retries and re-uploads cost nothing.

## Two requests changing the same thing at the same time

The thing that must never happen twice is **creating a proposal for the same enquiry**. Double-clicks, two tabs, a Retry racing the background job, or two calls to `POST /api/enquiries/{id}/draft` can all try at the same moment. Every draft is created by `ensureDraft()` ([src/lib/drafts/ensure-draft.ts](src/lib/drafts/ensure-draft.ts)), which has three guards. Each one covers what the one before can't:

1. **A saved draft id** (`draft:{id}`). If there is one, the draft exists, and Proposales isn't called at all. The id is written once (`SET NX`), so a late writer can't replace it.
2. **A per-enquiry lock** (`draft-lock:{id}`, `SET NX` with a 60 s expiry). Only one request at a time can reach the create call. The others see "already exists" or "in progress".
3. **A search in Proposales by `enquiry_id` before creating.** Every draft carries `data.enquiry_id`. If an earlier attempt crashed after Proposales created the draft but before its id was saved, the search finds it, and its id is saved instead of a second draft being created.

A second lock around the whole run (`process-lock:{id}`, 5 min) makes sure only one worker processes a row at a time, so the AI isn't paid twice for the same row.

**Lock expiries** are longer than the slowest run of their holder: 60 s covers a search plus a create (each at most 3 × 8 s), and 5 min covers an LLM call (45 s, retried twice) plus creating the draft. Expiry is what frees a lock when a worker crashes. A lock is only released by the worker holding it: the release checks a token unique to that worker, in one atomic Redis script.

These guarantees are tested in memory: five racing calls create exactly one draft, a crash between Proposales creating the draft and its id being saved doesn't create a second one, and a click racing the background job creates exactly one ([ensure-draft.test.ts](src/lib/drafts/ensure-draft.test.ts), [process.test.ts](src/lib/processing/process.test.ts)).

## Statuses

Statuses are never stored. Each time a row is shown, they're worked out from the keys, and the first rule that matches wins:

1. A draft id is saved → **Drafted**
2. A worker holds the row's lock → **Reading**
3. The AI hasn't read the row → **Received** (a Retry button appears after 60 s with no worker)
4. The last attempt saved an error → **Failed**
5. `decide()` blocks it → **Blocked**
6. Otherwise → **Ready** (a **Create draft** button)

Because `decide()` runs again each time, a Ready row whose exact start date has passed becomes Blocked. A Drafted row stays Drafted.

## Running it

```bash
cp .env.example .env.local   # fill in the values; see below
npm install
npm run dev                  # http://localhost:3000
npm test                     # unit tests (no network: fake model, fake Proposales, in-memory Redis)
npm run lint
npm run build
```

| Variable | Required | Meaning |
|---|---|---|
| `PROPOSALES_API_TOKEN` | Yes | API key. In Proposales: Settings → Profile |
| `PROPOSALES_COMPANY_ID` | Yes | The company drafts are created in (from `GET /v3/companies`) |
| `PROPOSALES_API_URL` | No | Defaults to `https://api.proposales.com` |
| `LLM_PROXY_URL`, `LLM_PROXY_KEY` | Yes | Where the model is reached. `https://`, or `http://` on a Tailscale `*.ts.net` host |
| `LLM_MODEL` | No | Defaults to `claude-opus-5-5` |
| `LLM_PROXY_FORMAT` | No | `anthropic` (default) or `openai` |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Yes | Redis, over REST |

The Redis database should belong to this app alone: the keys (`enquiries`, `enquiry:{id}`, `extraction:{id}`, `draft:{id}`, and the two locks) aren't namespaced.

`POST /api/enquiries/{id}/draft` creates the draft for one enquiry through the same `ensureDraft()`: `201` created, `200` already exists, `409` in progress or not read yet, `422` blocked, `502` Proposales failed.

## Code

```text
src/
  app/            the page, server actions, the draft route; wiring from the environment
  ui/             shared components: buttons, card, file input, status chip
  lib/
    enquiries/    parse the file, content ids, storage, statuses
    ai/           the schema, the prompt, the LLM call
    decide/       decide(): the policy table and code checks  ← pure
    proposales/   API client, reading → create-proposal body  ← body is pure
    drafts/       ensureDraft(): exactly one draft per enquiry
    processing/   one row end to end: lock → read → decide → draft
    kv/           the Redis operations, locks, and an in-memory fake
    env/          reads and checks the environment
```

The core is pure and has no I/O. Redis, the LLM and Proposales sit at the edges and are passed in, so every module is tested in memory.

## Not in this version

- **Fixing a blocked row in the app.** The disabled button shows where it goes. Today the salesperson writes that proposal in Proposales, or fixes the row in the sheet and uploads it again (a changed row is a new enquiry).
- **Sign-in.** Every draft is created on the account behind `PROPOSALES_API_TOKEN`, and anyone who can reach the app can upload.
