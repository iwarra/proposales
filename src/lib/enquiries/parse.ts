import xlsx from "node-xlsx";

export const MAX_BYTES = 1024 * 1024;
export const MAX_ROWS = 500;

/** One spreadsheet row, before it's stored. */
export type ParsedRow = {
  /** Every non-empty cell, under its original header. */
  columns: Record<string, string>;
  /** The message column, or the row's other cells joined. Quoted in the draft. */
  message: string;
  company: string | null;
  contactName: string | null;
  contactEmail: string | null;
  receivedAt: string | null;
};

export type RejectedRow = { line: number; label: string; reason: string };

export type ParseResult =
  | { ok: true; rows: ParsedRow[]; rejected: RejectedRow[] }
  | { ok: false; error: string };

type Field = "message" | "company" | "contactName" | "contactEmail" | "receivedAt";

const KNOWN_HEADERS: Record<Field, string[]> = {
  message: ["enquiry", "inquiry", "message", "request", "body", "description"],
  company: ["company", "organisation", "organization", "client"],
  contactName: ["contactname", "name", "contact"],
  contactEmail: ["contactemail", "email", "emailaddress"],
  receivedAt: ["receivedat", "received", "submittedat", "submitted"],
};

const CONTACT_FIELDS: Field[] = ["company", "contactName", "contactEmail", "receivedAt"];
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

const normalise = (header: string) => header.toLowerCase().replace(/[^\p{L}]/gu, "");

function fieldOf(header: string): Field | null {
  const key = normalise(header);
  for (const [field, names] of Object.entries(KNOWN_HEADERS) as [Field, string[]][]) {
    if (names.includes(key)) return field;
  }
  return null;
}

/** Blank headers become "Column N" and repeats get " (2)", so no cell is lost. */
function uniqueHeaders(raw: string[], width: number): string[] {
  const seen = new Map<string, number>();
  return Array.from({ length: width }, (_, i) => {
    const base = raw[i]?.trim() || `Column ${i + 1}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  });
}

function readSheet(buffer: Buffer, isCsv: boolean): string[][] {
  // SheetJS reads a CSV buffer as Latin-1 unless it starts with a BOM.
  const input = isCsv && !buffer.subarray(0, 3).equals(BOM) ? Buffer.concat([BOM, buffer]) : buffer;
  const [first] = xlsx.parse(input, { raw: false, cellDates: true, dateNF: "yyyy-mm-dd" });
  return (first?.data ?? []).map((row: unknown[]) => Array.from(row, (cell) => (cell == null ? "" : String(cell).trim())));
}

export function parseSheet(buffer: Buffer, fileName: string): ParseResult {
  const extension = fileName.toLowerCase().match(/\.(csv|xlsx)$/)?.[1];
  if (!extension) return { ok: false, error: "Upload a .csv or .xlsx file." };
  if (buffer.length === 0) return { ok: false, error: "The file is empty." };
  if (buffer.length > MAX_BYTES) return { ok: false, error: "The file is over 1 MB. Split it into smaller files." };

  let table: string[][];
  try {
    table = readSheet(buffer, extension === "csv");
  } catch {
    return { ok: false, error: "This file couldn't be read. Save it again as .csv or .xlsx and upload it." };
  }

  const [headerRow = [], ...body] = table;
  const lines = body.map((cells, i) => ({ cells, line: i + 2 })).filter(({ cells }) => cells.some(Boolean));
  if (lines.length === 0) {
    return { ok: false, error: "The file has no enquiries. Put headers in the first row and one enquiry per row below." };
  }
  if (lines.length > MAX_ROWS) {
    return { ok: false, error: `The limit is ${MAX_ROWS} rows per upload. Split it into smaller files.` };
  }

  const width = Math.max(headerRow.length, ...lines.map(({ cells }) => cells.length));
  const headers = uniqueHeaders(headerRow, width);
  const fields = headers.map(fieldOf);

  const rows: ParsedRow[] = [];
  const rejected: RejectedRow[] = [];
  for (const { cells, line } of lines) {
    const known: Partial<Record<Field, string>> = {};
    const columns: Record<string, string> = {};
    const others: string[] = [];
    cells.forEach((value, i) => {
      if (!value) return;
      columns[headers[i]] = value;
      const field = fields[i];
      if (field && known[field] === undefined) known[field] = value;
      if (!field || !CONTACT_FIELDS.includes(field)) others.push(`${headers[i]}: ${value}`);
    });

    const contact = {
      company: known.company ?? null,
      contactName: known.contactName ?? null,
      contactEmail: known.contactEmail?.toLowerCase() ?? null,
      receivedAt: known.receivedAt ?? null,
    };
    if (others.length === 0) {
      const label = contact.company ?? contact.contactName ?? contact.contactEmail ?? `Row ${line}`;
      rejected.push({ line, label, reason: "Only contact details, no enquiry" });
      continue;
    }
    rows.push({ columns, message: known.message ?? others.join(" · "), ...contact });
  }
  return { ok: true, rows, rejected };
}
