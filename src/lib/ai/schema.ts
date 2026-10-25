import { z } from "zod";

// z.union gives anyOf in the JSON Schema. z.discriminatedUnion would give oneOf,
// which Anthropic's structured output doesn't list as supported.
// Each case has only its own fields: an approximate date has no startDate at all.

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("YYYY-MM-DD");

const countField = z.union([
  z.object({ kind: z.literal("exact"), count: z.number().int() }),
  z.object({ kind: z.literal("approximate"), asStated: z.string() }),
  z.object({ kind: z.literal("ambiguous"), asStated: z.string(), reason: z.string() }),
  z.object({ kind: z.literal("missing") }),
]);

export const readingSchema = z.object({
  isEnquiry: z.boolean(),
  eventName: z.string().nullable(),
  dates: z.union([
    z.object({ kind: z.literal("exact"), startDate: isoDate, endDate: isoDate }),
    z.object({ kind: z.literal("approximate"), asStated: z.string() }),
    z.object({ kind: z.literal("ambiguous"), asStated: z.string(), reason: z.string() }),
    z.object({ kind: z.literal("missing") }),
  ]),
  guests: countField,
  rooms: countField,
  meetingSpace: z.string().nullable(),
  catering: z.string().nullable(),
  notes: z.string().nullable(),
  contact: z.object({
    company: z.string().nullable(),
    name: z.string().nullable(),
    email: z.string().nullable(),
  }),
});

/** The AI's reading of one row. It labels the fields; decide() decides. */
export type Reading = z.infer<typeof readingSchema>;
export type DatesField = Reading["dates"];
export type CountField = Reading["guests"];
