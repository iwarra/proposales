# The case

**Proposals that create themselves.** Hotel salespeople lose hours copying enquiries from forms, emails or spreadsheets into proposals. The task is to build the connection that does it for them: an enquiry arrives somewhere else, and a draft proposal is waiting in Proposales moments later.

## What the case asks for

| Requirement | How the MVP answers it |
|---|---|
| **AI is required**, to understand the enquiry (dates, guests, what they need) and turn it into the right proposal | One LLM call per row reads it, whatever the columns are called ([ai-reading.md](ai-reading.md)) |
| **Decide what happens when the model is unsure or wrong** | The AI only labels each field. Code decides: vague → draft to confirm, ambiguous → blocked, an exact value that fails a check → blocked ([decide.md](decide.md)) |
| **Pick the source yourself** | A spreadsheet the salesperson uploads ([user-story.md](user-story.md)) |
| **The magic moment:** something happens over there, the proposal appears here | Upload a sheet, and drafts appear in Proposales within seconds ([draft.md](draft.md)) |
| **Treat it like it runs every day:** errors, retries, the other side being down, running twice without duplicates | [when-things-go-wrong.md](when-things-go-wrong.md) |
| **Two requests changing the same thing at the same time are handled safely** | Exactly one draft per enquiry, however many requests race ([when-things-go-wrong.md](when-things-go-wrong.md#exactly-one-draft-per-enquiry)) |

## Definition of done

- **Live on Vercel and usable at the link.** A hotel salesperson could open it and use it today. Proposales will try it before the presentation. Code alone doesn't count.
- **The GitHub repo is shared** along with the link.
- **The README explains** what happens when things go wrong, and how two requests changing the same thing at the same time are handled.

## The presentation

1. **Business side, 5 minutes:** the salesperson's story. Upload a sheet with three rows (one clear, one vague, one ambiguous), and show the three outcomes: a draft, a draft marked to confirm, and a blocked row with its reason.
2. **Engineering side, in depth:** `decide()` and its policy table, the three draft guards, and what happens when the AI or Proposales fails.

## Glossary

| Term | Meaning |
|---|---|
| **Proposales** | A sales platform for hotels and event venues. It handles group, meeting and event sales, from the first enquiry to repeat bookings |
| **MICE** | Meetings, incentives, conferences and events: the corporate group business a hotel's sales team quotes and sells |
| **Enquiry** | A request from a client for an event: dates, number of guests, rooms, meeting space, catering. One spreadsheet row in this app |
| **Proposal** | What the hotel sends back: an interactive, branded offer the client can sign and pay in Proposales |
| **Draft** | A proposal that hasn't been sent yet. The salesperson reviews it, confirms any marked values and sends it |
| **Pax** | Number of guests. A common column name in hotel spreadsheets |
