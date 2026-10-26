import { describe, expect, it } from "vitest";
import type { Reading } from "../ai";
import type { Enquiry } from "../enquiries";
import { buildProposalBody, formatDateRange } from "./body";

const enquiry: Enquiry = {
  id: "abc123",
  uploadedAt: 0,
  columns: { Firma: "Northwind", Pax: "30–40", Info: "Kick-off mid March, lunch both days, 2 breakouts, no rooms needed" },
  message: "Kick-off mid March, lunch both days, 2 breakouts, no rooms needed",
  company: null,
  contactName: null,
  contactEmail: null,
  receivedAt: null,
};

const approximate: Reading = {
  isEnquiry: true,
  eventName: "Kick-off",
  dates: { kind: "approximate", asStated: "mid March" },
  guests: { kind: "approximate", asStated: "30–40" },
  rooms: { kind: "exact", count: 0 },
  meetingSpace: "2 breakout rooms",
  catering: "Lunch both days",
  notes: null,
  contact: { company: "Northwind", name: null, email: null },
};

const exact: Reading = {
  ...approximate,
  dates: { kind: "exact", startDate: "2027-03-12", endDate: "2027-03-13" },
  guests: { kind: "exact", count: 40 },
  rooms: { kind: "exact", count: 20 },
  notes: "Vegetarian options for 5.",
  contact: { company: "Northwind", name: "Anna Berg", email: "Anna@Northwind.se" },
};

describe("buildProposalBody", () => {
  it("approximate values: shown as stated, marked, and listed under To check (the draft.md example)", () => {
    const body = buildProposalBody({
      enquiry,
      reading: approximate,
      toCheck: ['Dates: the enquiry says "mid March".', 'Guests: the enquiry says "30–40".'],
      companyId: 1234,
    });
    expect(body).toEqual({
      company_id: 1234,
      language: "en",
      title_md: "Northwind: Kick-off, mid March",
      description_md: [
        "*Dates:* mid March *(approximate — to confirm)*",
        "*Guests:* 30–40 *(approximate — to confirm)*",
        "*Rooms:* none",
        "*Meeting space:* 2 breakout rooms",
        "*Catering:* Lunch both days",
        "",
        "*To check*",
        '• Dates: the enquiry says "mid March".',
        '• Guests: the enquiry says "30–40".',
        "",
        "*Original enquiry*",
        "Kick-off mid March, lunch both days, 2 breakouts, no rooms needed",
      ].join("\n"),
      recipient: { company_name: "Northwind" },
      data: { enquiry_id: "abc123", source: "enquiry-desk" },
    });
  });

  it("exact values: formatted, no To check, full recipient", () => {
    const body = buildProposalBody({ enquiry, reading: exact, toCheck: [], companyId: 1234 });
    expect(body.title_md).toBe("Northwind: Kick-off, 12 Mar 2027 – 13 Mar 2027");
    expect(body.description_md).toBe(
      [
        "*Dates:* 12 Mar 2027 – 13 Mar 2027",
        "*Guests:* 40",
        "*Rooms:* 20",
        "*Meeting space:* 2 breakout rooms",
        "*Catering:* Lunch both days",
        "*Notes:* Vegetarian options for 5.",
        "",
        "*Original enquiry*",
        "Kick-off mid March, lunch both days, 2 breakouts, no rooms needed",
      ].join("\n"),
    );
    expect(body.recipient).toEqual({ first_name: "Anna", last_name: "Berg", email: "anna@northwind.se", company_name: "Northwind" });
  });

  it("missing rooms: the line is left out; no event name: the title uses the guest count", () => {
    const reading: Reading = { ...exact, eventName: null, rooms: { kind: "missing" }, meetingSpace: null, catering: null, notes: null };
    const body = buildProposalBody({ enquiry, reading, toCheck: [], companyId: 1 });
    expect(body.title_md).toBe("Northwind: 40 guests, 12 Mar 2027 – 13 Mar 2027");
    expect(body.description_md).toBe(
      ["*Dates:* 12 Mar 2027 – 13 Mar 2027", "*Guests:* 40", "", "*Original enquiry*", "Kick-off mid March, lunch both days, 2 breakouts, no rooms needed"].join(
        "\n",
      ),
    );
  });

  it("approximate rooms are marked too", () => {
    const reading: Reading = { ...exact, rooms: { kind: "approximate", asStated: "about 20" } };
    expect(buildProposalBody({ enquiry, reading, toCheck: [], companyId: 1 }).description_md).toContain(
      "*Rooms:* about 20 *(approximate — to confirm)*",
    );
  });

  it("keeps the line breaks of a multi-line enquiry, and blank lines don't split it into paragraphs", () => {
    const body = buildProposalBody({ enquiry: { ...enquiry, message: "Line one\n\nLine two" }, reading: exact, toCheck: [], companyId: 1 });
    expect(body.description_md.endsWith("*Original enquiry*\nLine one\nLine two")).toBe(true);
  });

  it("uses only the markup Proposales renders: single-asterisk bold and line breaks", () => {
    const body = buildProposalBody({ enquiry, reading: approximate, toCheck: ["Dates: x"], companyId: 1 });
    expect(body.description_md).not.toMatch(/\*\*|^- |^> /m);
  });

  it("keeps the client's asterisks from turning text bold", () => {
    const reading: Reading = { ...exact, catering: "Lunch *both* days" };
    const body = buildProposalBody({ enquiry: { ...enquiry, message: "Kick-off *ASAP*" }, reading, toCheck: [], companyId: 1 });
    expect(body.description_md).toContain("*Catering:* Lunch ∗both∗ days");
    expect(body.description_md.endsWith("Kick-off ∗ASAP∗")).toBe(true);
  });

  describe("recipient", () => {
    it("prefers the sheet's own contact details over the AI's", () => {
      const sheet = { ...enquiry, company: "Northwind AB", contactName: "Bo Ek", contactEmail: "bo@northwind.se" };
      const body = buildProposalBody({ enquiry: sheet, reading: exact, toCheck: [], companyId: 1 });
      expect(body.recipient).toEqual({ first_name: "Bo", last_name: "Ek", email: "bo@northwind.se", company_name: "Northwind AB" });
      expect(body.title_md.startsWith("Northwind AB: ")).toBe(true);
    });

    it("leaves out a malformed email", () => {
      const reading: Reading = { ...exact, contact: { company: null, name: "Anna", email: "anna at northwind" } };
      expect(buildProposalBody({ enquiry, reading, toCheck: [], companyId: 1 }).recipient).toEqual({ first_name: "Anna" });
    });

    it("splits a name at the last space", () => {
      const reading: Reading = { ...exact, contact: { company: null, name: "Anna Maria  Berg", email: null } };
      expect(buildProposalBody({ enquiry, reading, toCheck: [], companyId: 1 }).recipient).toEqual({
        first_name: "Anna Maria",
        last_name: "Berg",
      });
    });

    it("is left out entirely when empty, and the title falls back to the contact name or 'New enquiry'", () => {
      const named: Reading = { ...exact, contact: { company: null, name: "Anna Berg", email: null } };
      expect(buildProposalBody({ enquiry, reading: named, toCheck: [], companyId: 1 }).title_md.startsWith("Anna Berg: ")).toBe(true);

      const none: Reading = { ...exact, contact: { company: null, name: null, email: null } };
      const body = buildProposalBody({ enquiry, reading: none, toCheck: [], companyId: 1 });
      expect(body).not.toHaveProperty("recipient");
      expect(body.title_md.startsWith("New enquiry: ")).toBe(true);
    });
  });
});

describe("formatDateRange", () => {
  it("formats a range and a single day without timezone drift", () => {
    expect(formatDateRange("2027-03-12", "2027-03-13")).toBe("12 Mar 2027 – 13 Mar 2027");
    expect(formatDateRange("2027-12-01", "2027-12-01")).toBe("1 Dec 2027");
  });
});
