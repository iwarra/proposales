import { describe, expect, it } from "vitest";
import type { Reading } from "../ai";
import { keys, type Enquiry } from "../enquiries";
import { acquireLock, createMemoryKv, type Kv } from "../kv";
import { ProposalesError, type ProposalBody, type ProposalesClient } from "../proposales";
import { ensureDraft } from "./ensure-draft";

const TODAY = "2026-10-25";

const enquiry: Enquiry = {
  id: "enq-1",
  uploadedAt: 0,
  columns: { Company: "Northwind", Info: "Kick-off 12–13 March 2027 for 40" },
  message: "Kick-off 12–13 March 2027 for 40",
  company: "Northwind",
  contactName: null,
  contactEmail: null,
  receivedAt: null,
};

const reading: Reading = {
  isEnquiry: true,
  eventName: "Kick-off",
  dates: { kind: "exact", startDate: "2027-03-12", endDate: "2027-03-13" },
  guests: { kind: "exact", count: 40 },
  rooms: { kind: "missing" },
  meetingSpace: null,
  catering: null,
  notes: null,
  contact: { company: "Northwind", name: null, email: null },
};

/** An in-memory Proposales: search finds what create made. */
function fakeProposales(options: { createDelayMs?: number; failCreate?: Error } = {}) {
  const proposals: (ProposalBody & { uuid: string; url: string })[] = [];
  const calls = { create: 0, search: 0 };
  const client: ProposalesClient = {
    async createProposal(body) {
      calls.create++;
      if (options.createDelayMs) await new Promise((resolve) => setTimeout(resolve, options.createDelayMs));
      if (options.failCreate) throw options.failCreate;
      const uuid = `p-${proposals.length + 1}`;
      const proposal = { ...body, uuid, url: `https://proposales.test/${uuid}` };
      proposals.push(proposal);
      return { uuid, url: proposal.url };
    },
    async findByEnquiryId(id) {
      calls.search++;
      const match = proposals.find((p) => p.data.enquiry_id === id);
      return match ? { uuid: match.uuid, url: match.url } : null;
    },
  };
  return { client, proposals, calls };
}

const deps = (kv: Kv, proposales: ProposalesClient) => ({ kv, proposales, companyId: 1234 });

describe("ensureDraft", () => {
  it("creates the draft, sends the body, and saves its id", async () => {
    const kv = createMemoryKv();
    const p = fakeProposales();
    const result = await ensureDraft(deps(kv, p.client), enquiry, reading, TODAY);

    expect(result).toEqual({ outcome: "created", draft: { uuid: "p-1", url: "https://proposales.test/p-1" } });
    expect(p.proposals[0]).toMatchObject({ company_id: 1234, title_md: "Northwind: Kick-off, 12 Mar 2027 – 13 Mar 2027", data: { enquiry_id: "enq-1" } });
    expect(await kv.get(keys.draft("enq-1"))).toEqual({ uuid: "p-1", url: "https://proposales.test/p-1" });
  });

  it("searches Proposales before creating", async () => {
    const kv = createMemoryKv();
    const p = fakeProposales();
    await ensureDraft(deps(kv, p.client), enquiry, reading, TODAY);
    expect(p.calls).toEqual({ create: 1, search: 1 });
  });

  describe("guard 1: a saved draft id", () => {
    it("a second call sees the draft exists and never calls Proposales", async () => {
      const kv = createMemoryKv();
      const p = fakeProposales();
      await ensureDraft(deps(kv, p.client), enquiry, reading, TODAY);
      const again = await ensureDraft(deps(kv, p.client), enquiry, reading, TODAY);

      expect(again).toEqual({ outcome: "exists", draft: { uuid: "p-1", url: "https://proposales.test/p-1" } });
      expect(p.calls).toEqual({ create: 1, search: 1 });
    });

    it("a drafted row stays drafted even when decide() would now block it", async () => {
      const kv = createMemoryKv();
      const p = fakeProposales();
      await ensureDraft(deps(kv, p.client), enquiry, reading, TODAY);
      expect(await ensureDraft(deps(kv, p.client), enquiry, reading, "2027-06-01")).toMatchObject({ outcome: "exists" });
    });
  });

  describe("guard 2: a per-enquiry lock", () => {
    it("racing calls create exactly one draft; the others see it exists or is in progress", async () => {
      const kv = createMemoryKv();
      const p = fakeProposales({ createDelayMs: 20 });
      const results = await Promise.all(Array.from({ length: 5 }, () => ensureDraft(deps(kv, p.client), enquiry, reading, TODAY)));

      expect(p.calls.create).toBe(1);
      expect(p.proposals).toHaveLength(1);
      expect(results.filter((r) => r.outcome === "created")).toHaveLength(1);
      for (const r of results.filter((r) => r.outcome !== "created")) expect(["exists", "in_progress"]).toContain(r.outcome);
    });

    it("reports in progress while another worker holds the lock", async () => {
      const kv = createMemoryKv();
      const p = fakeProposales();
      await acquireLock(kv, keys.draftLock("enq-1"), 60);
      expect(await ensureDraft(deps(kv, p.client), enquiry, reading, TODAY)).toEqual({ outcome: "in_progress" });
      expect(p.calls).toEqual({ create: 0, search: 0 });
    });

    it("lets the next attempt in once a crashed worker's lock expires", async () => {
      let now = 0;
      const kv = createMemoryKv(() => now);
      const p = fakeProposales();
      await acquireLock(kv, keys.draftLock("enq-1"), 60);
      now = 60_000;
      expect(await ensureDraft(deps(kv, p.client), enquiry, reading, TODAY)).toMatchObject({ outcome: "created" });
    });

    it("releases the lock when Proposales fails, so Retry can run", async () => {
      const kv = createMemoryKv();
      const failing = fakeProposales({ failCreate: new ProposalesError("Proposales responded 500") });
      await expect(ensureDraft(deps(kv, failing.client), enquiry, reading, TODAY)).rejects.toThrow("Proposales responded 500");

      const p = fakeProposales();
      expect(await ensureDraft(deps(kv, p.client), enquiry, reading, TODAY)).toMatchObject({ outcome: "created" });
    });
  });

  describe("guard 3: a search in Proposales before creating", () => {
    it("after a crash between Proposales creating the draft and its id being saved, finds it instead of creating a second", async () => {
      const kv = createMemoryKv();
      const p = fakeProposales();
      // The crash: the draft is created, then saving its id fails.
      const crashing: Kv = { ...kv, set: async (key, value, options) => (key === keys.draft("enq-1") ? Promise.reject(new Error("crash")) : kv.set(key, value, options)) };
      await expect(ensureDraft(deps(crashing, p.client), enquiry, reading, TODAY)).rejects.toThrow("crash");
      expect(p.proposals).toHaveLength(1);
      expect(await kv.get(keys.draft("enq-1"))).toBeNull();

      const retry = await ensureDraft(deps(kv, p.client), enquiry, reading, TODAY);
      expect(retry).toEqual({ outcome: "exists", draft: { uuid: "p-1", url: "https://proposales.test/p-1" } });
      expect(p.proposals).toHaveLength(1);
      expect(await kv.get(keys.draft("enq-1"))).toEqual({ uuid: "p-1", url: "https://proposales.test/p-1" });
    });
  });

  it("saves the draft id write-once, so a late writer can't replace it", async () => {
    const kv = createMemoryKv();
    await kv.set(keys.draft("enq-1"), { uuid: "first", url: "https://proposales.test/first" }, { nx: true });
    const p = fakeProposales();
    expect(await ensureDraft(deps(kv, p.client), enquiry, reading, TODAY)).toEqual({
      outcome: "exists",
      draft: { uuid: "first", url: "https://proposales.test/first" },
    });
  });

  it("calls decide() again and sends nothing it would block", async () => {
    const kv = createMemoryKv();
    const p = fakeProposales();
    const past = { ...reading, dates: { kind: "exact", startDate: "2026-01-01", endDate: "2026-01-02" } } as const;
    expect(await ensureDraft(deps(kv, p.client), enquiry, past, TODAY)).toEqual({
      outcome: "blocked",
      reasons: ["Start date 2026-01-01 is in the past."],
    });
    expect(p.calls).toEqual({ create: 0, search: 0 });
  });

  it("puts approximate values in the To check list", async () => {
    const kv = createMemoryKv();
    const p = fakeProposales();
    const vague: Reading = { ...reading, guests: { kind: "approximate", asStated: "30–40" } };
    await ensureDraft(deps(kv, p.client), enquiry, vague, TODAY);
    expect(p.proposals[0].description_md).toContain('**To check**\n- Guests: the enquiry says "30–40".');
  });
});
