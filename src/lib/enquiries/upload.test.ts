import { describe, expect, it } from "vitest";
import { createMemoryKv } from "../kv";
import { uploadSheet } from "./upload";

const file = (text: string) => Buffer.from(text, "utf8");
const sheet = "Company;Email;Info\nNorthwind;anna@northwind.se;Kick-off for 40 on 12 March 2027\nContoso;bo@contoso.se;\n";

describe("uploadSheet", () => {
  it("parses, stores new rows and reports rejected ones", async () => {
    const kv = createMemoryKv();
    const result = await uploadSheet(kv, file(sheet), "enquiries.csv", 1000);
    if (!result.ok) throw new Error(result.error);
    expect(result.added.map((e) => e.company)).toEqual(["Northwind"]);
    expect(result.duplicates).toBe(0);
    expect(result.rejected).toEqual([{ line: 3, label: "Contoso", reason: "Only contact details, no enquiry" }]);
  });

  it("adds nothing new on a re-upload", async () => {
    const kv = createMemoryKv();
    await uploadSheet(kv, file(sheet), "enquiries.csv", 1000);
    const again = await uploadSheet(kv, file(sheet), "enquiries.csv", 2000);
    expect(again).toMatchObject({ ok: true, added: [], duplicates: 1 });
  });

  it("stores nothing when the file is rejected", async () => {
    const kv = createMemoryKv();
    expect(await uploadSheet(kv, file(sheet), "enquiries.txt", 1000)).toEqual({ ok: false, error: "Upload a .csv or .xlsx file." });
    expect(await kv.zrangeNewestFirst("enquiries")).toEqual([]);
  });
});
