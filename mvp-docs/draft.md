# Step 5: the draft in Proposales

When `decide()` says draft, one proposal is created in Proposales. Every field appears in it. Approximate values are shown exactly as the enquiry wrote them, and marked.

## Example

For the Northwind row in [ai-reading.md](ai-reading.md):

Title: `Northwind: Kick-off, mid March`. Description, as sent in `description_md`:

```text
*Dates:* mid March *(approximate — to confirm)*
*Guests:* 30–40 *(approximate — to confirm)*
*Rooms:* none
*Meeting space:* 2 breakout rooms
*Catering:* Lunch both days

*To check*
• Dates: the enquiry says "mid March".
• Guests: the enquiry says "30–40".

*Original enquiry*
Kick-off mid March, lunch both days, 2 breakouts, no rooms needed
```

**Proposales' markdown is not CommonMark.** In a real draft's `description_html`, `*text*` became bold, a newline a line break and a blank line a new paragraph. `**text**`, `- ` lists and `> ` quotes were shown as typed. So the description uses only those three, list items start with `•`, and a `*` in the client's or the AI's text becomes `∗` so it can't turn text bold. Blank lines inside the original enquiry are dropped, so it stays one paragraph.

## How each part is built

| Part | Built from |
|---|---|
| Title | `{company or contact name}: {event name or "{guests} guests"}, {dates}`. With neither a company nor a name: "New enquiry" |
| Dates, guests, rooms | Exact: formatted ("12 Mar 2027 – 13 Mar 2027", "40"). Approximate: `asStated` plus "(approximate — to confirm)". Missing rooms: the line is left out |
| Meeting space, catering, notes | Free text, shown when present |
| To check | One line per approximate field. Left out when everything is exact |
| Original enquiry | The row's message, under its own heading |
| Recipient | The contact details. A malformed email is left out, because Proposales rejects the whole request otherwise |
| `data` | `enquiry_id` (so the draft can always be found again) and `source` |

The create-proposal API has no event date fields. Dates only ever appear as text we write, so nothing in Proposales shows as blank.

## Exactly one draft per enquiry

Every draft is created by `ensureDraft()`, which has three guards: a saved draft id, a per-enquiry lock, and a search in Proposales by `enquiry_id` before creating. See [when-things-go-wrong.md](when-things-go-wrong.md).

## After the draft is created

The row shows **Drafted**, an **Open the draft** link to the proposal and, when there are any, how many values are to confirm ("1 value to confirm"). The salesperson confirms the "To check" values in Proposales. The app doesn't track that: the row simply stays Drafted.
