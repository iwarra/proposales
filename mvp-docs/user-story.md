# User story

**Scenario:** the salesperson uploads the enquiry sheet straight into the tool, as if inside Proposales. Every draft is created on the uploader's Proposales account (for now, the account behind `PROPOSALES_API_TOKEN`).

> As a hotel salesperson, I want to upload a spreadsheet of enquiries, even a messy one with badly named columns, and have the AI turn each row into a draft proposal in Proposales. That way I don't have to retype anything, and each enquiry gets exactly one proposal.

## Acceptance criteria

### AI saves time

1. Within seconds of an upload, each row (one row = one enquiry) is read by the AI. Dates, guest count, rooms, meeting space and catering are filled in, whatever the columns are called.
2. A draft is created automatically in Proposales for every enquiry that passes validation. Exact values are filled in as given.
3. **Vague values are drafted, never guessed.** A value with one meaning that isn't precise ("mid March", "30–40 people") is shown in the draft exactly as the enquiry wrote it, marked to confirm.
4. **Ambiguous enquiries are blocked.** A row with a value that could mean two things, missing dates or guests, an exact value that fails validation, or content that isn't an event enquiry gets no draft. It's listed under the upload form as "Needs attention", with the reason.

### Unique (idempotency)

5. Uploading the same file again creates no duplicate enquiries and no duplicate drafts.
6. Retries, double-clicks or a crash partway through never create a second proposal for the same enquiry.

### Concurrency

7. If two requests try to create the draft for the same enquiry at the same moment (double-click, two tabs, a retry racing the background job), exactly one creates it. The other sees that the draft already exists.

## Next version

- **Fix in the app.** The salesperson fixes a blocked row's fields in the app and clicks "Create draft". The draft appears in Proposales within seconds.
- **Concurrent fixes.** If two people save fixes to the same enquiry at the same time, the later save is rejected instead of silently overwriting. That person sees the current values and can try again.

The case's concurrency requirement is met in the MVP by criterion 7. See [when-things-go-wrong.md](when-things-go-wrong.md).
