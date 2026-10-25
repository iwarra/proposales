import { describe, expect, it } from "vitest";
import type { Reading } from "../ai";
import { decide } from "./decide";

const TODAY = "2026-10-25";

const exact: Reading = {
  isEnquiry: true,
  eventName: "Kick-off",
  dates: { kind: "exact", startDate: "2027-03-12", endDate: "2027-03-13" },
  guests: { kind: "exact", count: 40 },
  rooms: { kind: "exact", count: 20 },
  meetingSpace: null,
  catering: null,
  notes: null,
  contact: { company: "Northwind", name: null, email: null },
};

const with_ = (patch: Partial<Reading>): Reading => ({ ...exact, ...patch });

describe("decide(): the policy table", () => {
  describe("dates", () => {
    it("exact → draft", () => {
      expect(decide(exact, TODAY)).toEqual({ action: "draft" });
    });
    it("approximate → draft, to confirm", () => {
      expect(decide(with_({ dates: { kind: "approximate", asStated: "mid March" } }), TODAY)).toEqual({
        action: "draft_with_checks",
        toCheck: ['Dates: the enquiry says "mid March".'],
      });
    });
    it("ambiguous → block, with the AI's reason", () => {
      const dates = { kind: "ambiguous", asStated: "2027.12.03", reason: "2027.12.03 could mean 3 Dec 2027 or 12 Mar 2027." } as const;
      expect(decide(with_({ dates }), TODAY)).toEqual({
        action: "block",
        reasons: ["Dates: 2027.12.03 could mean 3 Dec 2027 or 12 Mar 2027."],
      });
    });
    it("missing → block", () => {
      expect(decide(with_({ dates: { kind: "missing" } }), TODAY)).toEqual({
        action: "block",
        reasons: ["Dates: not given in the enquiry."],
      });
    });
  });

  describe("guests", () => {
    it("exact → draft", () => {
      expect(decide(with_({ guests: { kind: "exact", count: 1 } }), TODAY)).toEqual({ action: "draft" });
    });
    it("approximate → draft, to confirm", () => {
      expect(decide(with_({ guests: { kind: "approximate", asStated: "30–40" } }), TODAY)).toEqual({
        action: "draft_with_checks",
        toCheck: ['Guests: the enquiry says "30–40".'],
      });
    });
    it("ambiguous → block", () => {
      const guests = { kind: "ambiguous", asStated: "60", reason: "The Pax column says 60 but the text says 40." } as const;
      expect(decide(with_({ guests }), TODAY)).toEqual({
        action: "block",
        reasons: ["Guests: The Pax column says 60 but the text says 40."],
      });
    });
    it("missing → block", () => {
      expect(decide(with_({ guests: { kind: "missing" } }), TODAY)).toEqual({
        action: "block",
        reasons: ["Guests: not given in the enquiry."],
      });
    });
  });

  describe("rooms", () => {
    it("exact → draft (0 means no rooms needed)", () => {
      expect(decide(with_({ rooms: { kind: "exact", count: 0 } }), TODAY)).toEqual({ action: "draft" });
    });
    it("approximate → draft, to confirm", () => {
      expect(decide(with_({ rooms: { kind: "approximate", asStated: "about 20" } }), TODAY)).toEqual({
        action: "draft_with_checks",
        toCheck: ['Rooms: the enquiry says "about 20".'],
      });
    });
    it("ambiguous → block", () => {
      const rooms = { kind: "ambiguous", asStated: "20", reason: "20 could mean rooms or room nights." } as const;
      expect(decide(with_({ rooms }), TODAY)).toEqual({ action: "block", reasons: ["Rooms: 20 could mean rooms or room nights."] });
    });
    it("missing → draft (rooms are optional)", () => {
      expect(decide(with_({ rooms: { kind: "missing" } }), TODAY)).toEqual({ action: "draft" });
    });
  });
});

describe("decide(): row rules", () => {
  it("blocks anything that isn't an event enquiry", () => {
    expect(decide(with_({ isEnquiry: false }), TODAY)).toEqual({ action: "block", reasons: ["This isn't an event enquiry."] });
  });

  it("blocks when an exact value fails a check, even if others are approximate", () => {
    const reading = with_({ guests: { kind: "exact", count: 0 }, rooms: { kind: "approximate", asStated: "a few" } });
    expect(decide(reading, TODAY)).toEqual({ action: "block", reasons: ["Number of guests must be at least 1."] });
  });

  it("lists every reason, not just the first", () => {
    const reading = with_({
      isEnquiry: false,
      dates: { kind: "missing" },
      guests: { kind: "ambiguous", asStated: "60", reason: "Pax says 60, text says 40." },
      rooms: { kind: "exact", count: -1 },
    });
    expect(decide(reading, TODAY)).toEqual({
      action: "block",
      reasons: [
        "This isn't an event enquiry.",
        "Dates: not given in the enquiry.",
        "Guests: Pax says 60, text says 40.",
        "Number of rooms can't be negative.",
      ],
    });
  });

  it("lists one line per approximate field, in field order", () => {
    const reading = with_({
      dates: { kind: "approximate", asStated: "mid March" },
      guests: { kind: "approximate", asStated: "30–40" },
    });
    expect(decide(reading, TODAY)).toEqual({
      action: "draft_with_checks",
      toCheck: ['Dates: the enquiry says "mid March".', 'Guests: the enquiry says "30–40".'],
    });
  });
});

describe("decide(): code checks on exact values", () => {
  const dates = (startDate: string, endDate: string) => with_({ dates: { kind: "exact", startDate, endDate } });

  it("blocks a start date that isn't a real date", () => {
    expect(decide(dates("2027-02-30", "2027-03-01"), TODAY)).toEqual({
      action: "block",
      reasons: ["Start date 2027-02-30 isn't a real date."],
    });
  });

  it("blocks an end date that isn't a real date", () => {
    expect(decide(dates("2027-03-01", "2027-13-01"), TODAY)).toEqual({
      action: "block",
      reasons: ["End date 2027-13-01 isn't a real date."],
    });
  });

  it("rejects malformed dates that Date would still parse", () => {
    expect(decide(dates("2027-3-1", "2027-03-01"), TODAY)).toMatchObject({ reasons: ["Start date 2027-3-1 isn't a real date."] });
  });

  it("accepts 29 February in a leap year only", () => {
    expect(decide(dates("2028-02-29", "2028-02-29"), TODAY)).toEqual({ action: "draft" });
    expect(decide(dates("2027-02-29", "2027-03-01"), TODAY)).toMatchObject({ action: "block" });
  });

  it("blocks a start date in the past", () => {
    expect(decide(dates("2026-10-24", "2026-10-26"), TODAY)).toEqual({
      action: "block",
      reasons: ["Start date 2026-10-24 is in the past."],
    });
  });

  it("allows a start date of today", () => {
    expect(decide(dates(TODAY, TODAY), TODAY)).toEqual({ action: "draft" });
  });

  it("blocks an end date before the start date", () => {
    expect(decide(dates("2027-03-13", "2027-03-12"), TODAY)).toEqual({
      action: "block",
      reasons: ["End date is before the start date."],
    });
  });

  it("blocks fewer than 1 guest", () => {
    expect(decide(with_({ guests: { kind: "exact", count: 0 } }), TODAY)).toEqual({
      action: "block",
      reasons: ["Number of guests must be at least 1."],
    });
  });

  it("blocks a negative number of rooms", () => {
    expect(decide(with_({ rooms: { kind: "exact", count: -2 } }), TODAY)).toEqual({
      action: "block",
      reasons: ["Number of rooms can't be negative."],
    });
  });

  it("doesn't check approximate values", () => {
    expect(decide(with_({ dates: { kind: "approximate", asStated: "last March" } }), TODAY)).toMatchObject({
      action: "draft_with_checks",
    });
  });
});
