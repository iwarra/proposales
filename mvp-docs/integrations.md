# Integrations

The app talks to three outside services: Proposales, the LLM and Redis. Each sits behind a small module with its config read from the environment, so the core never touches them directly and tests use fakes.

## Environment

| Variable                                             | Required | Meaning                                                         |
| ---------------------------------------------------- | -------- | --------------------------------------------------------------- |
| `PROPOSALES_API_TOKEN`                               | Yes      | API key. In Proposales: **Settings → Profile**                  |
| `PROPOSALES_COMPANY_ID`                              | Yes      | The company drafts are created in. A positive whole number      |
| `PROPOSALES_API_URL`                                 | No       | Defaults to `https://api.proposales.com`                        |
| `LLM_PROXY_URL`, `LLM_PROXY_KEY`                     | Yes      | Where the model is reached. The URL must start with `https://`. |
| `LLM_MODEL`                                          | No       | Defaults to `claude-sonnet-5-5`                                 |
| `LLM_PROXY_FORMAT`                                   | No       | `anthropic` (default) or `openai`: which API the proxy speaks   |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Yes      | Redis. Set by Vercel's Upstash integration                      |

A missing or malformed value fails with a message naming the variable, not a vague network error later.

---

## Proposales

Spec: <https://docs.proposales.com/openapi.json>. Base URL `https://api.proposales.com`. Every request sends `Authorization: Bearer {token}`, plus `Content-Type: application/json` and `Accept: application/json`.

### Finding the company id (once, during setup)

`GET /v3/companies` returns `{ "data": [{ "id", "name", … }] }`, listing the companies the token can use. Put the right `id` in `PROPOSALES_COMPANY_ID`. The app doesn't call this endpoint at runtime.

### The two endpoints the app uses

**Create a draft:** `POST /v3/proposals`

```json
{
	"company_id": 1234,
	"language": "en",
	"title_md": "Northwind: Kick-off, mid March",
	"description_md": "- **Dates:** mid March *(approximate — to confirm)*\n…",
	"recipient": {
		"first_name": "Anna",
		"last_name": "Berg",
		"email": "anna@northwind.se",
		"company_name": "Northwind"
	},
	"data": { "enquiry_id": "…", "source": "enquiry-desk" }
}
```

It returns `{ "proposal": { "uuid", "url" } }`. How the title and description are built is in [draft.md](draft.md). `description_md` uses Proposales' own markdown, not CommonMark: see [draft.md](draft.md#example).

- Only `company_id` and `language` are required. The app sends just the fields above. It leaves out the rest of the spec's optional fields (blocks, attachments, invoicing, …).
- `recipient` leaves out every field it doesn't have, and is left out entirely when it's empty.
- A malformed email is left out, because Proposales rejects the whole request on one.

**Find an earlier draft:** `GET /v3/proposal-search`

| Query                | Value                                                           |
| -------------------- | --------------------------------------------------------------- |
| `company_id`         | The company id                                                  |
| `filter[enquiry_id]` | The enquiry's id                                                |
| `include_archived`   | `true`, so a draft someone archived is never silently recreated |
| `limit`              | `1`                                                             |

It returns `{ "data": [{ "uuid", "url", "title", "status", "data", … }] }` (at most 25 items), or an empty list. The app reads only `uuid` and `url`.

The spec documents `filter[property_name]` as a filter on any key of the proposal's `data`. So `filter[enquiry_id]` is a supported query, not a workaround. It still gets one live check before building ([plan.md](plan.md#before-building-verify-two-unknowns)).

### Errors

Every error response has the same body:

```json
{ "error": { "message": "Human-readable error message.", "code": "…" } }
```

`code` is optional. Show `message` on the row when the draft fails. If the body can't be read, use `Proposales responded {status}`. The spec lists 400, 401, 403, 404 and 500 for create, and 400, 401 and 500 for search. 401 or 403 means the token or company id is wrong. That's a setup problem, so the message should say so.

### Timeouts and retries

Each request has an **8 s timeout** and at most **3 attempts**, with backoff of 250 ms, then 500 ms. Whether a failed request is retried depends on whether it could have had an effect:

| Failure                              | Search      | Create                               |
| ------------------------------------ | ----------- | ------------------------------------ |
| No response (network error, timeout) | Retry       | **Don't retry.** The draft may exist |
| 5xx                                  | Retry       | **Don't retry.** The draft may exist |
| 429 (rate limited)                   | Retry       | Retry. Nothing was created           |
| Other 4xx                            | Don't retry | Don't retry                          |

A search changes nothing, so it's always safe to repeat. After a create fails with no response or a 5xx, the next attempt **searches first** ([guard 3](when-things-go-wrong.md#exactly-one-draft-per-enquiry)). That's what makes every Retry safe.

The worst case is a search plus a create, each 3 × 8 s, so under 50 s. The draft lock lasts longer than that.

### Testing against a real account

The Proposales account is real, so calls are kept to a minimum. Unit tests pass in a fake client. Only the end-to-end test calls Proposales ([plan.md](plan.md#testing-against-proposales)).

---

## LLM

- **Client:** Vercel AI SDK. `anthropic` uses the Anthropic provider, which has native structured output. `openai` uses an OpenAI-compatible provider with structured output switched on.
- **Call:** one per row, with the schema from [ai-reading.md](ai-reading.md) as structured output. **45 s timeout**, and the SDK retries twice.
- **Failure:** a timeout, a proxy that's down, or an answer that doesn't fit the schema saves the error on the row, which shows as Failed.
- **To verify first:** the `anyOf` schema gets through the proxy in the configured format ([plan.md](plan.md#before-building-verify-two-unknowns)).

---

## Redis

Upstash Redis, over REST, so it works from serverless functions without a connection pool. The keys are in [plan.md](plan.md#storage).

The database belongs to this app alone. The keys aren't namespaced, so another app writing `enquiry:{id}` or `draft:{id}` into the same database would collide with this one.

The app uses three operations:

- **`SET NX`** to write once: uploaded rows, draft ids and locks.
- **Expiry** on locks, so a crashed worker can't hold one forever.
- **Delete only if the token still matches** when releasing a lock, so a worker never releases a lock someone else now holds.
