# Step 4: code decides, not the AI

`decide(reading, today)` is a small pure function. It's the **only** place that decides whether a row gets a draft. The AI only labels the fields ([ai-reading.md](ai-reading.md)).

## The policy table

| Field | `exact` | `approximate` | `ambiguous` | `missing` |
|---|---|---|---|---|
| **dates** | ✅ draft *(if it passes the checks)* | ✅ draft, to confirm | ❌ block | ❌ block |
| **guests** | ✅ draft *(if it passes the checks)* | ✅ draft, to confirm | ❌ block | ❌ block |
| **rooms** | ✅ draft *(if it passes the checks)* | ✅ draft, to confirm | ❌ block | ✅ draft *(optional)* |

Two rules apply to the whole row:

- **Not an event enquiry** (`isEnquiry: false`) → ❌ block.
- **An `exact` value fails a code check** → ❌ block. The model claimed precision and was wrong, which is the kind of mistake that leads to wrong bookings.

## Code checks on exact values

| Field | Blocks when | Reason shown |
|---|---|---|
| dates | `startDate` isn't a real `YYYY-MM-DD` date (e.g. `2027-02-30`) | Start date {x} isn't a real date. |
| dates | `endDate` isn't a real date | End date {x} isn't a real date. |
| dates | Start date is before today (today is allowed) | Start date {x} is in the past. |
| dates | End date is before the start date | End date is before the start date. |
| guests | Fewer than 1 | Number of guests must be at least 1. |
| rooms | Negative | Number of rooms can't be negative. |

A real date must survive a round trip through `Date` unchanged. That rejects `2027-02-30`, which JavaScript would otherwise turn into 2 March.

Approximate values aren't checked: there's no number or date to check, only the client's words. The salesperson confirms them in Proposales.

## Output

```ts
type Decision =
  | { action: "draft" }
  | { action: "draft_with_checks"; toCheck: string[] }  // ['Dates: the enquiry says "mid March".']
  | { action: "block"; reasons: string[] };             // ["Dates: 2027.12.03 could mean 3 Dec 2027 or 12 Mar 2027."]
```

- `toCheck` has one line per approximate field.
- `reasons` lists **every** reason, not just the first, so the salesperson sees everything at once. An ambiguous field's reason comes from the AI. The rest come from code.
- Reasons that come from the policy table, not the checks:

  | Case | Reason shown |
  |---|---|
  | Not an event enquiry | This isn't an event enquiry. |
  | Ambiguous field | `{Field}: {the AI's reason}`, e.g. *Dates: 2027.12.03 could mean 3 Dec 2027 or 12 Mar 2027.* |
  | Required field missing | `{Field}: not given in the enquiry.` |

- `today` is the current date in UTC (`YYYY-MM-DD`).

## Where it's used

- **After the AI reads a row:** draft or block.
- **Every time a row is shown:** its status is worked out again, never stored. A valid row that wasn't drafted yet is blocked once its exact start date has passed. A row that already has a draft stays Drafted.
- **Right before creating a draft:** the draft step calls `decide()` again, so nothing reaches Proposales that `decide()` would block.

## Tests

Each cell of the policy table is one unit test, plus one test per code check and per row rule. Changing the policy means editing one table and its tests, not the prompt.
