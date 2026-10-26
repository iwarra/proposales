# When things go wrong

The case asks for this: *"treat it like it runs every day: errors, retries, the other side being down, and running twice without creating duplicates"*, and for safe handling of *"two requests that try to change the same thing at the same time"*. Any step can fail, run twice or run at the same time as another without creating duplicates. This page is the source for the README's section on the same topic.

## Failures

| What goes wrong | What the salesperson sees | What happens next |
|---|---|---|
| The file isn't a `.csv` or `.xlsx`, can't be read, is empty, is over 1 MB or has over 500 rows | A message they can act on, e.g. *"Upload a .csv or .xlsx file."* | Nothing is stored |
| A row has only contact details | Listed as rejected, with the reason | The row is skipped |
| The AI times out, the proxy is down, or the answer doesn't fit the schema | **Failed**: "The AI couldn't read this enquiry: …" | Retry sends the row to the AI again |
| The AI's answer is unclear or wrong | **Blocked**, with the reasons | See [decide.md](decide.md) and [needs-attention.md](needs-attention.md) |
| Proposales is down or rejects the request | **Failed**: "Couldn't create the draft in Proposales: …" | Retry goes straight to creating the draft. The AI isn't called again |
| A worker stops partway through | The row stays Received or Ready | A Retry or Create draft button appears |

Every Retry is safe to click any number of times.

## Duplicates

- **Same file uploaded twice:** each row's id is a hash of its content, and rows are saved with `SET NX`. A row seen before is counted as a duplicate and nothing new is stored.
- **A row the AI already read** isn't sent to the AI again, so retries and re-uploads cost nothing.

## Exactly one draft per enquiry

`ensureDraft()` creates every draft. It has three guards, each covering what the one before can't:

1. **A saved draft id.** If there is one, the draft exists. Done.
2. **A per-enquiry lock** (`SET NX` with expiry). Two requests at the same moment (a double-click, two tabs, a retry racing the background job) can't both reach the create call. The one that doesn't get the lock sees "already exists" or "in progress".
3. **A search in Proposales by `enquiry_id` before creating.** If an earlier attempt crashed after Proposales created the draft but before its id was saved, the draft is found and its id saved, instead of creating a second one.

The draft id is saved write-once, so a late writer can't replace it.

A separate per-row lock around the whole run (AI read and draft) makes sure only one worker processes a row at a time, so the AI isn't paid twice for the same row.

## Lock expiries

A lock must last longer than the slowest run of its holder. Otherwise it could expire mid-run and let a second worker in.

| Lock | Expires after | Slowest run it covers |
|---|---|---|
| Row (whole run) | 5 min | An LLM call (45 s, retried twice) plus creating the draft |
| Draft (create call) | 60 s | A search plus a create, each at most 3 × 8 s: under 50 s |

Expiry is what frees a lock when a worker crashes. A lock is only released by the worker that holds it: the release checks a token unique to that worker.

## Next version: concurrent fixes

When fixing in the app is built, each saved reading gets a version. A save with an old version is rejected rather than overwriting someone else's fix. See [needs-attention.md](needs-attention.md).
