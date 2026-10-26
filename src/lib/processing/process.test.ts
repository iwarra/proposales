import { describe, expect, it } from "vitest";
import type { Reading, ReadResult } from "../ai";
import { keys, saveUpload, type Enquiry, type Extraction } from "../enquiries";
import { acquireLock, createMemoryKv, type Kv } from "../kv";
import { ProposalesError, type ProposalesClient } from "../proposales";
import { createDraft, processEnquiry, processMany, type ProcessDeps } from "./process";

const TODAY = "2026-10-25";

const exact: Reading = {
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

function fakeProposales(options: { failCreate?: () => Error | null; createDelayMs?: number } = {}) {
  const created: string[] = [];
  const client: ProposalesClient = {
    async createProposal(body) {
      if (options.createDelayMs) await new Promise((r) => setTimeout(r, options.createDelayMs));
      const error = options.failCreate?.();
      if (error) throw error;
      created.push(body.data.enquiry_id);
      return { uuid: `p-${created.length}`, url: `https://p/${created.length}` };
    },
    async findByEnquiryId(id) {
      const i = created.indexOf(id);
      return i === -1 ? null : { uuid: `p-${i + 1}`, url: `https://p/${i + 1}` };
    },
  };
  return { client, created };
}

async function setup(options: { read?: (enquiry: Enquiry) => Promise<ReadResult>; proposales?: ProposalesClient; rows?: number } = {}) {
  const kv = createMemoryKv();
  const reads: string[] = [];
  const proposales = options.proposales ?? fakeProposales().client;
  const deps: ProcessDeps = {
    kv,
    proposales,
    companyId: 1,
    read: async (enquiry) => {
      reads.push(enquiry.id);
      return options.read ? options.read(enquiry) : { ok: true, reading: exact };
    },
  };
  const rows = Array.from({ length: options.rows ?? 1 }, (_, i) => ({
    columns: { Info: `Kick-off ${i}` },
    message: `Kick-off ${i}`,
    company: "Northwind",
    contactName: null,
    contactEmail: null,
    receivedAt: null,
  }));
  const { added } = await saveUpload(kv, rows, 0);
  return { kv, deps, reads, ids: added.map((e) => e.id) };
}

const extraction = (kv: Kv, id: string) => kv.get<Extraction>(keys.extraction(id));

describe("processEnquiry", () => {
  it("reads the row, decides, and creates the draft", async () => {
    const { kv, deps, ids: [id] } = await setup();
    expect(await processEnquiry(deps, id, TODAY)).toBe("drafted");
    expect(await extraction(kv, id)).toEqual({ reading: exact, error: null });
    expect(await kv.get(keys.draft(id))).toEqual({ uuid: "p-1", url: "https://p/1" });
    expect(await kv.get(keys.processLock(id))).toBeNull();
  });

  it("skips the AI when the row was already read, so retries cost nothing", async () => {
    const { kv, deps, reads, ids: [id] } = await setup();
    await kv.set(keys.extraction(id), { reading: exact, error: null });
    expect(await processEnquiry(deps, id, TODAY)).toBe("drafted");
    expect(reads).toEqual([]);
  });

  it("does nothing for a row that already has a draft", async () => {
    const { kv, deps, reads, ids: [id] } = await setup();
    await kv.set(keys.draft(id), { uuid: "x", url: "https://p/x" });
    expect(await processEnquiry(deps, id, TODAY)).toBe("drafted");
    expect(reads).toEqual([]);
  });

  it("saves an AI failure with its reason, and Retry sends the row to the AI again", async () => {
    let fail = true;
    const { kv, deps, reads, ids: [id] } = await setup({
      read: async () => (fail ? { ok: false, error: "the AI took too long to answer." } : { ok: true, reading: exact }),
    });
    expect(await processEnquiry(deps, id, TODAY)).toBe("failed");
    expect(await extraction(kv, id)).toEqual({
      reading: null,
      error: { stage: "ai", message: "The AI couldn't read this enquiry: the AI took too long to answer." },
    });
    expect(await kv.get(keys.draft(id))).toBeNull();

    fail = false;
    expect(await processEnquiry(deps, id, TODAY)).toBe("drafted");
    expect(reads).toHaveLength(2);
    expect(await extraction(kv, id)).toEqual({ reading: exact, error: null });
  });

  it("blocks without calling Proposales", async () => {
    const calls: string[] = [];
    const proposales: ProposalesClient = {
      createProposal: async () => (calls.push("create"), { uuid: "x", url: "x" }),
      findByEnquiryId: async () => (calls.push("search"), null),
    };
    const { kv, deps, ids: [id] } = await setup({ proposales, read: async () => ({ ok: true, reading: { ...exact, guests: { kind: "missing" } } }) });
    expect(await processEnquiry(deps, id, TODAY)).toBe("blocked");
    expect(calls).toEqual([]);
    expect((await extraction(kv, id))?.error).toBeNull();
  });

  it("saves a Proposales failure, and Retry goes straight to creating the draft", async () => {
    let fail = true;
    const p = fakeProposales({ failCreate: () => (fail ? new ProposalesError("Proposales responded 500") : null) });
    const { kv, deps, reads, ids: [id] } = await setup({ proposales: p.client });

    expect(await processEnquiry(deps, id, TODAY)).toBe("failed");
    expect(await extraction(kv, id)).toEqual({
      reading: exact,
      error: { stage: "draft", message: "Couldn't create the draft in Proposales: Proposales responded 500" },
    });

    fail = false;
    expect(await processEnquiry(deps, id, TODAY)).toBe("drafted");
    expect(reads).toHaveLength(1);
    expect(await extraction(kv, id)).toEqual({ reading: exact, error: null });
  });

  it("doesn't leak unexpected errors as row messages", async () => {
    const p = fakeProposales({ failCreate: () => new Error("socket hang up at 10.0.0.1") });
    const { kv, deps, ids: [id] } = await setup({ proposales: p.client });
    expect(await processEnquiry(deps, id, TODAY)).toBe("failed");
    expect((await extraction(kv, id))?.error?.message).toBe("Couldn't create the draft in Proposales: something unexpected went wrong.");
  });

  it("leaves the row alone while another worker holds it", async () => {
    const { kv, deps, reads, ids: [id] } = await setup();
    await acquireLock(kv, keys.processLock(id), 300);
    expect(await processEnquiry(deps, id, TODAY)).toBe("busy");
    expect(reads).toEqual([]);
  });

  it("runs the AI once when two workers race for the same row", async () => {
    const { deps, reads, ids: [id] } = await setup({
      read: async () => {
        await new Promise((r) => setTimeout(r, 10));
        return { ok: true, reading: exact };
      },
    });
    const outcomes = await Promise.all([processEnquiry(deps, id, TODAY), processEnquiry(deps, id, TODAY)]);
    expect(outcomes.sort()).toEqual(["busy", "drafted"]);
    expect(reads).toHaveLength(1);
  });
});

describe("createDraft (the Create draft button and the draft route)", () => {
  it("needs a reading first", async () => {
    const { deps, ids: [id] } = await setup();
    expect(await createDraft(deps, id, TODAY)).toEqual({ outcome: "not_read" });
  });

  it("reports an unknown enquiry", async () => {
    const { deps } = await setup();
    expect(await createDraft(deps, "nope", TODAY)).toEqual({ outcome: "not_found" });
  });

  it("creates once; a second click sees it already exists", async () => {
    const { kv, deps, ids: [id] } = await setup();
    await kv.set(keys.extraction(id), { reading: exact, error: null });
    expect(await createDraft(deps, id, TODAY)).toMatchObject({ outcome: "created" });
    expect(await createDraft(deps, id, TODAY)).toMatchObject({ outcome: "exists" });
  });

  it("racing the background job, exactly one draft is created", async () => {
    const p = fakeProposales({ createDelayMs: 20 });
    const { kv, deps, ids: [id] } = await setup({ proposales: p.client });
    await kv.set(keys.extraction(id), { reading: exact, error: null });

    const [background, ...clicks] = await Promise.all([
      processEnquiry(deps, id, TODAY),
      createDraft(deps, id, TODAY),
      createDraft(deps, id, TODAY),
    ]);
    expect(p.created).toEqual([id]);
    expect(["drafted", "in_progress"]).toContain(background);
    for (const click of clicks) expect(["created", "exists", "in_progress"]).toContain(click.outcome);
    expect(await kv.get(keys.draft(id))).toEqual({ uuid: "p-1", url: "https://p/1" });
  });

  it("saves a Proposales failure on the row", async () => {
    const p = fakeProposales({ failCreate: () => new ProposalesError("Proposales responded 503") });
    const { kv, deps, ids: [id] } = await setup({ proposales: p.client });
    await kv.set(keys.extraction(id), { reading: exact, error: null });
    expect(await createDraft(deps, id, TODAY)).toEqual({
      outcome: "failed",
      error: "Couldn't create the draft in Proposales: Proposales responded 503",
    });
  });
});

describe("processMany", () => {
  it("processes rows 4 at a time", async () => {
    let running = 0;
    let peak = 0;
    const { kv, deps, ids } = await setup({
      rows: 10,
      read: async () => {
        peak = Math.max(peak, ++running);
        await new Promise((r) => setTimeout(r, 5));
        running--;
        return { ok: true, reading: exact };
      },
    });
    await processMany(deps, ids, TODAY);
    expect(peak).toBe(4);
    for (const id of ids) expect(await kv.get(keys.draft(id))).not.toBeNull();
  });

  it("keeps going when one row throws", async () => {
    const { kv, deps, ids } = await setup({ rows: 3 });
    const broken: ProcessDeps = {
      ...deps,
      kv: { ...kv, get: async (key) => (key === keys.enquiry(ids[1]) ? Promise.reject(new Error("redis down")) : kv.get(key)) },
    };
    await processMany(broken, ids, TODAY, { log: () => {} });
    expect(await kv.get(keys.draft(ids[0]))).not.toBeNull();
    expect(await kv.get(keys.draft(ids[2]))).not.toBeNull();
  });
});
