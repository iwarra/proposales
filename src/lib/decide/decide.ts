import type { CountField, DatesField, Reading } from "../ai";

export type Decision =
  | { action: "draft" }
  | { action: "draft_with_checks"; toCheck: string[] }
  | { action: "block"; reasons: string[] };

/**
 * The policy table, one row per field. ✅ = "ok", ✅ to confirm = "check", ❌ = "block".
 * Exact values are drafted only if they pass the code checks below.
 */
const POLICY = {
  dates: { exact: "ok", approximate: "check", ambiguous: "block", missing: "block" },
  guests: { exact: "ok", approximate: "check", ambiguous: "block", missing: "block" },
  rooms: { exact: "ok", approximate: "check", ambiguous: "block", missing: "ok" },
} as const;

const LABELS = { dates: "Dates", guests: "Guests", rooms: "Rooms" } as const;

/** A real date survives a round trip through Date unchanged, so 2027-02-30 is rejected. */
export function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function checkDates(dates: Extract<DatesField, { kind: "exact" }>, today: string): string[] {
  const { startDate, endDate } = dates;
  const reasons: string[] = [];
  if (!isRealDate(startDate)) reasons.push(`Start date ${startDate} isn't a real date.`);
  if (!isRealDate(endDate)) reasons.push(`End date ${endDate} isn't a real date.`);
  if (reasons.length > 0) return reasons;
  // ISO dates compare correctly as strings.
  if (startDate < today) reasons.push(`Start date ${startDate} is in the past.`);
  if (endDate < startDate) reasons.push("End date is before the start date.");
  return reasons;
}

function checkCount(field: "guests" | "rooms", count: number): string[] {
  if (field === "guests" && count < 1) return ["Number of guests must be at least 1."];
  if (field === "rooms" && count < 0) return ["Number of rooms can't be negative."];
  return [];
}

/**
 * The only place that decides whether a row gets a draft. Pure: `today` is a YYYY-MM-DD date.
 * Lists every reason, not just the first.
 */
export function decide(reading: Reading, today: string): Decision {
  const reasons: string[] = [];
  const toCheck: string[] = [];
  if (!reading.isEnquiry) reasons.push("This isn't an event enquiry.");

  for (const field of ["dates", "guests", "rooms"] as const) {
    const value: DatesField | CountField = reading[field];
    const label = LABELS[field];
    const policy = POLICY[field][value.kind];

    if (policy === "block") {
      reasons.push(value.kind === "ambiguous" ? `${label}: ${value.reason}` : `${label}: not given in the enquiry.`);
    } else if (policy === "check" && "asStated" in value) {
      toCheck.push(`${label}: the enquiry says "${value.asStated}".`);
    } else if (value.kind === "exact") {
      reasons.push(...("startDate" in value ? checkDates(value, today) : checkCount(field as "guests" | "rooms", value.count)));
    }
  }

  // Only against a valid guest count, so 0 guests isn't reported twice.
  const { guests, rooms } = reading;
  if (guests.kind === "exact" && guests.count >= 1 && rooms.kind === "exact" && rooms.count > guests.count) {
    reasons.push(`${rooms.count} rooms for ${guests.count} guests.`);
  }

  if (reasons.length > 0) return { action: "block", reasons };
  if (toCheck.length > 0) return { action: "draft_with_checks", toCheck };
  return { action: "draft" };
}
