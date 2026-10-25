import { describe, expect, it } from "vitest";
import { createMemoryKv } from "../kv";
import type { ParsedRow } from "./parse";
import { contentId, loadEnquiry, saveUpload } from "./store";

const row = (columns: Record<string, string>): ParsedRow => ({
  columns,
  message: Object.entries(columns).map(([k, v]) => `${k}: ${v}`).join(" · "),
  company: null,
  contactName: null,
  contactEmail: null,
  receivedAt: null,
});

describe("contentId", () => {
  it("is the same for the same content, whatever the column order", () => {
    expect(contentId(row({ Firma: "Northwind", Pax: "40" }))).toBe(contentId(row({ Pax: "40", Firma: "Northwind" })));
  });

  it("changes when any value changes", () => {
    expect(contentId(row({ Firma: "Northwind", Pax: "40" }))).not.toBe(contentId(row({ Firma: "Northwind", Pax: "41" })));
  });

  it("doesn't confuse values moving between columns", () => {
    expect(contentId(row({ A: "x", B: "" }))).not.toBe(contentId(row({ A: "", B: "x" })));
  });

  it("is a 32-character hex string", () => {
    expect(contentId(row({ A: "x" }))).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("saveUpload", () => {
  const rows = [row({ Firma: "Northwind", Pax: "40" }), row({ Firma: "Contoso", Pax: "12" })];

  it("stores new rows and lists them newest first", async () => {
    const kv = createMemoryKv();
    const result = await saveUpload(kv, rows, 1000);
    expect(result.added.map((e) => e.columns.Firma)).toEqual(["Northwind", "Contoso"]);
    expect(result.duplicates).toBe(0);
    expect(await kv.zrangeNewestFirst("enquiries")).toHaveLength(2);
    expect(await loadEnquiry(kv, result.added[0].id)).toEqual({ ...rows[0], id: result.added[0].id, uploadedAt: 1000 });
  });

  it("counts a re-upload as duplicates and stores nothing new", async () => {
    const kv = createMemoryKv();
    const first = await saveUpload(kv, rows, 1000);
    const again = await saveUpload(kv, rows, 2000);
    expect(again).toEqual({ added: [], duplicates: 2 });
    expect(await loadEnquiry(kv, first.added[0].id)).toMatchObject({ uploadedAt: 1000 });
    expect(await kv.zrangeNewestFirst("enquiries")).toHaveLength(2);
  });

  it("counts the same row twice in one file as a duplicate", async () => {
    const kv = createMemoryKv();
    expect(await saveUpload(kv, [rows[0], rows[0]], 1000)).toMatchObject({ duplicates: 1 });
  });

  it("lists a row again if a crash left it stored but unlisted", async () => {
    const kv = createMemoryKv();
    const id = contentId(rows[0]);
    await kv.set(`enquiry:${id}`, { ...rows[0], id, uploadedAt: 500 }, { nx: true });
    await saveUpload(kv, [rows[0]], 1000);
    expect(await kv.zrangeNewestFirst("enquiries")).toEqual([id]);
  });
});
