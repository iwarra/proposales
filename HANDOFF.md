# Handoff: build the MVP

You're implementing the MVP described in `mvp-docs/`, in this repo (`my-demo`). The repo is a fresh `create-next-app` (Next.js 16.4.3, React 19.3, Tailwind 4, TypeScript) with one commit on `main`.

## Source of truth

**`mvp-docs/` is the spec.** Read it in this order before writing code:

1. `README.md`: the rule, the flow, the three outcomes
2. `case.md`: what the case requires and the definition of done
3. `user-story.md`: acceptance criteria 1–7
4. `plan.md`: stack, modules, parsing, storage, design, **order of work**
5. `ai-reading.md`, `decide.md`, `draft.md`, `needs-attention.md`, `when-things-go-wrong.md`, `integrations.md`: one per part, as you reach it

If the docs are unclear, contradict each other, or don't cover something you need, **stop and ask**. Don't guess. If you change behaviour the docs describe, update the doc in the same commit.

**Build from the docs only.** Don't read, copy from or import anything in `../app` or any other folder outside this repo. This is a from-scratch build.

## Next.js

This Next.js version has breaking changes from what you may know. Before writing a server action, route handler, background work (`after`) or config, read the matching guide in `node_modules/next/dist/docs/` and follow its deprecation notices. See `AGENTS.md`.

## Ground rules

- **Git:** work on a branch (e.g. `mvp`), never on `main`. Commit after each step in the order of work, once its tests pass. **Never merge into `main`.** The user reviews first.
- **Proposales is a real account.** Keep API calls to a minimum:
  - Unit tests never call Proposales. Pass in a fake client.
  - Ask the user before any call that creates a proposal.
  - Prefix titles of test drafts with `[TEST]`, and reuse one test draft where possible instead of creating new ones.
- **The LLM costs money.** Unit tests use a fake model. Real calls only for the checks named in `plan.md`.
- **Secrets:** the user provides `.env.local` (variables in `integrations.md#environment`). Add a `.env.example` with placeholder values only. Never print, log or commit real values.
- **Design follows proposales.com:** the tokens and styles in `plan.md#design`. Define the tokens once in `globals.css` and use only them.
- **Code style:** functional, no ORM, minimal abstractions, test-first (Vitest). Pure core, I/O at the edges, dependencies passed in.

## Packages to add

| Package | For |
|---|---|
| `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai-compatible` | The LLM call |
| `zod` | The output schema |
| `@upstash/redis` | Storage and locks |
| `node-xlsx` | Parsing `.csv` and `.xlsx` |
| `vitest` (dev) | Tests. Add a `test` script |

Pin exact versions. Run `npm audit` after installing, and report anything it finds.

## Order of work

Follow `plan.md#order-of-work`. Start with **"Before building: verify two unknowns"**:

1. **`anyOf` through the LLM proxy:** one LLM-only call with the dates/guests/rooms union schema. Report the result. If it fails, switch to the flat fallback described in the plan.
2. **Proposales search by `data.enquiry_id`:** this needs one create and one search on the real account. **Ask the user first**, and use a `[TEST]` title.

Then report back before starting step 1.

After each step, report briefly:
- what was built,
- test results (passing and failing, with output if failing),
- anything left out or unclear.

## Done

- Every step in `plan.md#order-of-work` is complete, with its tests passing (`npm test`, `npm run lint`, `npm run build`).
- The definition of done in `case.md` is met: live on Vercel and usable at the link, with a README covering what happens when things go wrong and how concurrent requests are handled.
- The end-to-end test in step 10 has been run on the live link with the 3-row sheet. Results reported: two drafts, one blocked row, no new drafts on re-upload.
- Everything is on the branch, ready for the user's review. Nothing is merged.
