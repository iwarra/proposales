import { describe, expect, it } from "vitest";
import type { Reading } from "../ai";
import { createMemoryKv } from "../kv";
import { isBeingRead, listRows, rowStatus, STUCK_AFTER_MS } from "./status";
import { keys, saveUpload, type Enquiry, type Extraction } from "./store";

const TODAY = "2026-10-25";
const NOW = 1_000_000;

const enquiry: Enquiry = {
  id: "e1",
  uploadedAt: NOW - 1000,
  columns: { Info: "x" },
  message: "x",
  company: null,
  contactName: null,
  contactEmail: null,
  receivedAt: null,
};

const reading: Reading = {
  isEnquiry: true,
  eventName: null,
  dates: { kind: "exact", startDate: "2027-03-12", endDate: "2027-03-13" },
  guests: { kind: "exact", count: 40 },
  rooms: { kind: "missing" },
  meetingSpace: null,
  catering: null,
  notes: null,
  contact: { company: null, name: null, email: null },
};

const draft = { uuid: "u1", url: "https://p/u1" };
const read = (r: Reading): Extraction => ({ reading: r, error: null });
const base = { enquiry, extraction: null, draft: null, locked: false, now: NOW, today: TODAY };

describe("rowStatus: the first rule that matches wins", () => {
  it("1. a saved draft id → Drafted, even if a worker holds the lock or decide() would now block", () => {
    const past = read({ ...reading, dates: { kind: "exact", startDate: "2026-01-01", endDate: "2026-01-01" } });
    expect(rowStatus({ ...base, draft, locked: true, extraction: past })).toEqual({ status: "drafted", draft });
  });

  it("2. a worker holds the lock → Reading", () => {
    expect(rowStatus({ ...base, locked: true })).toEqual({ status: "reading" });
    expect(rowStatus({ ...base, locked: true, extraction: { reading: null, error: { stage: "ai", message: "x" } } })).toEqual({
      status: "reading",
    });
  });

  it("3. not read yet → Received; stuck after 60 s with no worker", () => {
    expect(rowStatus(base)).toEqual({ status: "received", stuck: false });
    const old = { ...enquiry, uploadedAt: NOW - STUCK_AFTER_MS };
    expect(rowStatus({ ...base, enquiry: old })).toEqual({ status: "received", stuck: true });
  });

  it("4. the last attempt saved an error → Failed", () => {
    const aiFailed: Extraction = { reading: null, error: { stage: "ai", message: "The AI couldn't read this enquiry: timeout." } };
    expect(rowStatus({ ...base, extraction: aiFailed })).toEqual({
      status: "failed",
      stage: "ai",
      error: "The AI couldn't read this enquiry: timeout.",
    });
    const draftFailed: Extraction = { reading, error: { stage: "draft", message: "Couldn't create the draft in Proposales: 500" } };
    expect(rowStatus({ ...base, extraction: draftFailed })).toMatchObject({ status: "failed", stage: "draft" });
  });

  it("5. decide() blocks → Blocked, with every reason", () => {
    const blocked = read({ ...reading, isEnquiry: false, guests: { kind: "missing" } });
    expect(rowStatus({ ...base, extraction: blocked })).toEqual({
      status: "blocked",
      reasons: ["This isn't an event enquiry.", "Guests: not given in the enquiry."],
    });
  });

  it("6. otherwise → Ready", () => {
    expect(rowStatus({ ...base, extraction: read(reading) })).toEqual({ status: "ready" });
  });

  it("a Ready row whose exact start date has passed becomes Blocked", () => {
    expect(rowStatus({ ...base, extraction: read(reading), today: "2027-03-13" })).toEqual({
      status: "blocked",
      reasons: ["Start date 2027-03-12 is in the past."],
    });
  });
});

describe("isBeingRead: the AI is still on the row", () => {
  it("Reading → yes", () => {
    expect(isBeingRead({ status: "reading" })).toBe(true);
  });

  it("Received, not stuck yet → yes", () => {
    expect(isBeingRead({ status: "received", stuck: false })).toBe(true);
  });

  it("Received and stuck → no, it waits for Retry", () => {
    expect(isBeingRead({ status: "received", stuck: true })).toBe(false);
  });

  it("Drafted, Blocked, Ready, Failed → no", () => {
    expect(isBeingRead({ status: "drafted", draft })).toBe(false);
    expect(isBeingRead({ status: "blocked", reasons: ["x"] })).toBe(false);
    expect(isBeingRead({ status: "ready" })).toBe(false);
    expect(isBeingRead({ status: "failed", stage: "ai", error: "x" })).toBe(false);
  });

  it("a row past STUCK_AFTER_MS with no worker stops counting", () => {
    const old = { ...enquiry, uploadedAt: NOW - STUCK_AFTER_MS };
    expect(isBeingRead(rowStatus({ ...base, enquiry: old }))).toBe(false);
    expect(isBeingRead(rowStatus({ ...base, enquiry: old, locked: true }))).toBe(true);
  });
});

describe("listRows", () => {
  it("reads every row's keys and works out its status, newest upload first", async () => {
    const kv = createMemoryKv();
    const row = (info: string) => ({ ...enquiry, columns: { Info: info }, message: info });
    const { added: [a] } = await saveUpload(kv, [row("a")], NOW - 2000);
    const { added: [b, c] } = await saveUpload(kv, [row("b"), row("c")], NOW - 1000);
    await kv.set(keys.extraction(a.id), read(reading));
    await kv.set(keys.draft(b.id), draft);
    await kv.set(keys.processLock(c.id), "token");

    const rows = await listRows(kv, NOW, TODAY);
    expect(rows.map((r) => [r.enquiry.message, r.status.status])).toEqual([
      ["b", "drafted"],
      ["c", "reading"],
      ["a", "ready"],
    ]);
    expect(rows.find((r) => r.enquiry.id === a.id)?.reading).toEqual(reading);
  });

  it("is empty with no uploads", async () => {
    expect(await listRows(createMemoryKv(), NOW, TODAY)).toEqual([]);
  });
});
