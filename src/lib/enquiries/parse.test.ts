import xlsx from "node-xlsx";
import { describe, expect, it } from "vitest";
import { MAX_BYTES, parseSheet } from "./parse";

const csv = (text: string) => Buffer.from(text, "utf8");
const BOM = "﻿";

function rows(result: ReturnType<typeof parseSheet>) {
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
  return result.rows;
}

describe("parseSheet: messy .csv", () => {
  const messy =
    BOM +
    'Firma;Pax;Info;E-post;Telefon\n' +
    'Åkerö AB;30-40;"Kick-off mitten av mars,\nlunch båda dagarna";anna@akero.se;0701234567\n';

  it("handles semicolons, a BOM, å/ä/ö, a line break in a quoted cell and keeps 30-40 as text", () => {
    const [row] = rows(parseSheet(csv(messy), "enquiries.csv"));
    expect(row.columns).toEqual({
      Firma: "Åkerö AB",
      Pax: "30-40",
      Info: "Kick-off mitten av mars,\nlunch båda dagarna",
      "E-post": "anna@akero.se",
      Telefon: "0701234567",
    });
  });

  it("reads UTF-8 without a BOM", () => {
    const [row] = rows(parseSheet(csv("Firma;Pax\nÅkerö AB;60\n"), "a.csv"));
    expect(row.columns).toEqual({ Firma: "Åkerö AB", Pax: "60" });
  });

  it("reads tabs and commas", () => {
    expect(rows(parseSheet(csv("Firma\tPax\nNorthwind\t40\n"), "a.csv"))[0].columns).toEqual({ Firma: "Northwind", Pax: "40" });
    expect(rows(parseSheet(csv('Firma,Info\nNorthwind,"A; B, C"\n'), "a.csv"))[0].columns).toEqual({ Firma: "Northwind", Info: "A; B, C" });
  });

  it("leaves unrecognised headers to the AI and builds the message from the other cells", () => {
    const [row] = rows(parseSheet(csv(messy), "enquiries.csv"));
    expect(row.company).toBeNull();
    expect(row.contactEmail).toBeNull();
    expect(row.message).toBe(
      "Firma: Åkerö AB · Pax: 30-40 · Info: Kick-off mitten av mars,\nlunch båda dagarna · E-post: anna@akero.se · Telefon: 0701234567",
    );
  });

  it("skips blank lines and keeps only non-empty cells", () => {
    const result = rows(parseSheet(csv("Company,Pax,Notes\nNorthwind,40,\n,,\n\n"), "a.csv"));
    expect(result).toHaveLength(1);
    expect(result[0].columns).toEqual({ Company: "Northwind", Pax: "40" });
  });
});

describe("parseSheet: .xlsx", () => {
  const book = xlsx.build(
    [
      { name: "First", data: [["Company", "Arrival", "Pax", "Phone"], ["Northwind", new Date(Date.UTC(2027, 2, 12)), 40, "0701"]], options: {} },
      { name: "Second", data: [["Ignored"], ["x"]], options: {} },
    ],
    { parseOptions: { cellDates: true } },
  );

  it("reads the first sheet, dates as ISO dates and every cell as text", () => {
    const result = rows(parseSheet(book, "enquiries.xlsx"));
    expect(result).toHaveLength(1);
    expect(result[0].columns).toEqual({ Company: "Northwind", Arrival: "2027-03-12", Pax: "40", Phone: "0701" });
  });
});

describe("parseSheet: recognised headers", () => {
  it("maps known headers after lowercasing and keeping only letters", () => {
    const [row] = rows(
      parseSheet(
        csv("Enquiry;Organisation;Contact name;Email address;Received at\nKick-off for 40;Northwind;Anna Berg;Anna@Northwind.SE;2026-10-01\n"),
        "a.csv",
      ),
    );
    expect(row).toMatchObject({
      message: "Kick-off for 40",
      company: "Northwind",
      contactName: "Anna Berg",
      contactEmail: "anna@northwind.se",
      receivedAt: "2026-10-01",
    });
  });

  it.each([
    ["inquiry", "message"],
    ["Request", "message"],
    ["BODY", "message"],
    ["description", "message"],
    ["client", "company"],
    ["organization", "company"],
    ["Name", "contactName"],
    ["contact", "contactName"],
    ["contact_email", "contactEmail"],
    ["E-mail", "contactEmail"],
    ["submitted", "receivedAt"],
    ["Submitted at", "receivedAt"],
    ["received", "receivedAt"],
  ])("%s → %s", (header, field) => {
    const [row] = rows(parseSheet(csv(`${header};Other\nvalue;more\n`), "a.csv"));
    expect(row[field as keyof typeof row]).toBe("value");
  });

  it("uses the other cells as the message when the message cell is empty", () => {
    const [row] = rows(parseSheet(csv("Message;Company;Pax\n;Northwind;40\n"), "a.csv"));
    expect(row.message).toBe("Pax: 40");
  });
});

describe("parseSheet: rejected rows", () => {
  it("rejects a row with only contact details", () => {
    const result = parseSheet(csv("Company;Email;Pax\nNorthwind;anna@northwind.se;\nContoso;;40\n"), "a.csv");
    if (!result.ok) throw new Error(result.error);
    expect(result.rows.map((r) => r.company)).toEqual(["Contoso"]);
    expect(result.rejected).toEqual([{ line: 2, label: "Northwind", reason: "Only contact details, no enquiry" }]);
  });
});

describe("parseSheet: file checks", () => {
  it.each([
    ["enquiries.pdf", csv("a;b\n1;2\n"), "Upload a .csv or .xlsx file."],
    ["enquiries.csv", csv(""), "The file is empty."],
    ["enquiries.csv", Buffer.alloc(MAX_BYTES + 1, "a"), "The file is over 1 MB. Split it into smaller files."],
    ["enquiries.csv", csv("Company;Pax\n"), "The file has no enquiries. Put headers in the first row and one enquiry per row below."],
    ["enquiries.xlsx", Buffer.from([0x50, 0x4b, 3, 4, 255, 254, 0, 7]), "This file couldn't be read. Save it again as .csv or .xlsx and upload it."],
  ])("%s → %s", (name, buffer, error) => {
    expect(parseSheet(buffer, name)).toEqual({ ok: false, error });
  });

  it("allows 500 rows and rejects 501", () => {
    const sheet = (n: number) => csv("Company;Pax\n" + Array.from({ length: n }, (_, i) => `C${i};${i + 1}`).join("\n"));
    expect(rows(parseSheet(sheet(500), "a.csv"))).toHaveLength(500);
    expect(parseSheet(sheet(501), "a.csv")).toEqual({
      ok: false,
      error: "The limit is 500 rows per upload. Split it into smaller files.",
    });
  });

  it("names blank and repeated headers so no cell is lost", () => {
    const [row] = rows(parseSheet(csv("Pax;;Pax\n40;note;60\n"), "a.csv"));
    expect(row.columns).toEqual({ Pax: "40", "Column 2": "note", "Pax (2)": "60" });
  });
});

describe("samples/enquiries-3-rows.csv", () => {
  it("parses into the three rows of the end-to-end test", async () => {
    const { readFileSync } = await import("node:fs");
    const result = rows(parseSheet(readFileSync("samples/enquiries-3-rows.csv"), "enquiries-3-rows.csv"));
    expect(result.map((r) => r.company)).toEqual(["[TEST] Northwind", "[TEST] Contoso", "[TEST] Fabrikam"]);
    expect(result[2].message).toBe("Board dinner on 2027.12.03 for 12, private dining room");
  });
});
