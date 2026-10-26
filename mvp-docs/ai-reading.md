# Steps 2–3: the AI reads and labels the row

One LLM call per row. The AI does two things:

1. **Understands the row.** Column names can be vague, abbreviated or in another language ("Pax", "Antal gäster", "Arr. date"). The AI uses the values and the free text together to work out what each column means.
2. **Labels the key fields.** It doesn't decide whether a draft is created. That's [`decide()`](decide.md), in code.

## Input

| Input | Why |
|---|---|
| System prompt | The job and the rules below |
| Today's date and the date the enquiry was received | To resolve "12 March" (no year) or "next Friday" |
| The row as `column → value` JSON | The raw enquiry |
| The output schema | Forces the shape of the answer |

## Output schema

`dates`, `guests` and `rooms` each have four cases. **Each case has only its own fields:** an approximate date has no `startDate` at all, not even `null`.

```ts
dates: z.union([
  z.object({ kind: z.literal("exact"), startDate: isoDate, endDate: isoDate }),
  z.object({ kind: z.literal("approximate"), asStated: z.string() }),
  z.object({ kind: z.literal("ambiguous"), asStated: z.string(), reason: z.string() }),
  z.object({ kind: z.literal("missing") }),
])

guests: z.union([
  z.object({ kind: z.literal("exact"), count: z.number().int() }),
  z.object({ kind: z.literal("approximate"), asStated: z.string() }),
  z.object({ kind: z.literal("ambiguous"), asStated: z.string(), reason: z.string() }),
  z.object({ kind: z.literal("missing") }),
])

rooms: // same shape as guests
```

The rest of the answer:

| Field | Type | Notes |
|---|---|---|
| `isEnquiry` | boolean | `false` for anything that isn't an event enquiry ("Please unsubscribe me") |
| `eventName`, `meetingSpace`, `catering`, `notes` | string or `null` | Free text. Descriptive, so a loose reading can't cause a wrong booking |
| `contact` | company, name, email | Fills in what the sheet's own columns didn't |

`z.union` produces `anyOf` in the JSON Schema. `z.discriminatedUnion` is avoided because it produces `oneOf`, which Anthropic's structured output doesn't list as supported.

### Example

| Firma | Pax | Info |
|---|---|---|
| Northwind | 30–40 | Kick-off mid March, lunch both days, 2 breakouts, no rooms needed |

```json
{
  "isEnquiry": true,
  "eventName": "Kick-off",
  "dates": { "kind": "approximate", "asStated": "mid March" },
  "guests": { "kind": "approximate", "asStated": "30–40" },
  "rooms": { "kind": "exact", "count": 0 },
  "meetingSpace": "2 breakout rooms",
  "catering": "Lunch both days",
  "notes": null,
  "contact": { "company": "Northwind", "name": null, "email": null }
}
```

## Prompt rules

- **Never invent.** If a value isn't stated, use `missing`.
- **`asStated` is copied word for word**, in the enquiry's language ("mitten av mars"). No day is filled in and nothing is translated.
- **`reason` says what the readings are**, so a salesperson can act on it: *"2027.12.03 could mean 3 Dec 2027 or 12 Mar 2027."*
- **If unsure whether a value is approximate or ambiguous, choose ambiguous.** In doubt, the row is blocked rather than guessed.
- **Each field is labelled from what the enquiry says about that field.** Guests and rooms aren't compared with each other: more rooms than guests is checked by code ([decide.md](decide.md)), so the AI doesn't block it or explain it twice.
- **A date without a year** means its next occurrence on or after the date the enquiry was received. Relative dates ("next Friday") are resolved against that date too.

### Boundary cases

These go into the prompt as examples.

| Enquiry says | Case |
|---|---|
| "12–13 March" (no year) | dates `exact`: the next March after the received date |
| "12 March, 3 days" | dates `exact`: 12–14 March |
| "12 March, a few days" | dates `approximate` |
| "starting 12 March" (no length) | dates `approximate` |
| "mid March", "first week of May", "spring 2027" | dates `approximate` |
| "next Friday", with a received date | dates `exact` |
| "next Friday", no received date | dates `ambiguous` |
| "2027.12.03" | dates `ambiguous`: 3 Dec 2027 or 12 Mar 2027 |
| "30–40 people", "about 40" | guests `approximate` |
| Pax column 60, text says 40 | guests `ambiguous` |
| "15 people", "25 single rooms" | guests `exact` 15, rooms `exact` 25 |
| "no rooms needed" | rooms `exact` 0 |
| Rooms not mentioned | rooms `missing` |
| "Please unsubscribe me" | `isEnquiry: false` |

## When the AI call fails

A timeout, a proxy that's down, or an answer that doesn't fit the schema makes the row **Failed**, with the reason and a Retry button. See [when-things-go-wrong.md](when-things-go-wrong.md).

## Known risk: overconfidence

The model could mark something `exact` that should be `approximate`. Code can't catch a valid but wrong date. The safeguards are the "choose ambiguous when unsure" rule, the code checks on exact values, and the original enquiry always quoted in the draft.
