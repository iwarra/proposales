# Step 6: blocked rows

## In the MVP: show them

Under the upload form and the summary, "Needs attention" lists every row that `decide()` blocked, with the hint *"No draft was created for these."* Each row shows:

- the status **Blocked**,
- every reason from `decide()`, e.g. *"Dates: 2027.12.03 could mean 3 Dec 2027 or 12 Mar 2027."*,
- one **disabled** button: **Fix & create draft**. Hovering or focusing it shows *"Coming in V2"*.

No draft is created and nothing on the row can be edited. For now the salesperson writes that proposal in Proposales themselves, or fixes the row in the sheet and uploads it again. A changed row is a new enquiry, because an enquiry's id comes from its content.

```text
┌──────────────────────────────────────────────────────────────┐
│ Northwind: Kick-off                              ● Blocked   │
│ Dates: 2027.12.03 could mean 3 Dec 2027 or 12 Mar 2027.      │
│                                                              │
│ [ Fix & create draft ]   (disabled, tooltip "Coming in V2")  │
└──────────────────────────────────────────────────────────────┘
```

## All row statuses

| Status | Meaning | What the salesperson does |
|---|---|---|
| Received | Uploaded, not read yet | Wait. A Retry button appears if it gets stuck |
| Reading | A worker is on it right now | Wait |
| **Drafted** | The draft exists in Proposales | Open it, confirm any "To check" values |
| **Blocked** | `decide()` blocked it | Read the reasons and handle the enquiry |
| Ready | Passes `decide()`, but no draft yet (e.g. the worker stopped) | Click **Create draft** |
| Failed | The AI or Proposales failed | Click **Retry** (safe) |

Statuses are never stored. Each time a row is shown, the first rule that matches wins:

1. A draft id is saved → **Drafted**
2. A worker holds the row's lock → **Reading**
3. The AI hasn't read the row → **Received**. After 60 s with no worker, a Retry button appears
4. The last attempt saved an error → **Failed**
5. `decide()` blocks it → **Blocked**
6. Otherwise → **Ready**

Because `decide()` runs again each time, a Ready row whose exact start date has passed becomes Blocked. A Drafted row stays Drafted.

## Next version: fix in the app

Behind the disabled button:

1. The salesperson enters exact values for the blocked fields: a date range, or a whole number.
2. The fix is saved as an `exact` reading and goes through the same `decide()`. There is no second validation path.
3. **Concurrent fixes:** each saved reading has a version. A save sent with an old version is rejected, and that person sees the current values and can try again.
4. **Create draft** goes through `ensureDraft()`, like every other draft.
