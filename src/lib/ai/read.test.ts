import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { readEnquiry } from "./read";
import type { Reading } from "./schema";

const northwind: Reading = {
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

const answer = (text: string) => ({
  content: [{ type: "text" as const, text }],
  finishReason: { unified: "stop" as const, raw: undefined },
  usage: {
    inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 1, text: 1, reasoning: undefined },
  },
  warnings: [],
});

const input = {
  columns: { Firma: "Northwind", Pax: "30–40", Info: "Kick-off mid March, lunch both days, 2 breakouts, no rooms needed" },
  receivedAt: "2026-10-20",
};

describe("readEnquiry", () => {
  it("returns the reading when the answer fits the schema", async () => {
    const model = new MockLanguageModelV4({ doGenerate: answer(JSON.stringify(northwind)) });
    expect(await readEnquiry(model, input, "2026-10-25", { maxRetries: 0 })).toEqual({ ok: true, reading: northwind });
  });

  it("sends today, the received date and the row, with the schema as structured output", async () => {
    const model = new MockLanguageModelV4({ doGenerate: answer(JSON.stringify(northwind)) });
    await readEnquiry(model, input, "2026-10-25", { maxRetries: 0 });

    const [call] = model.doGenerateCalls;
    const sent = JSON.stringify(call.prompt);
    expect(sent).toContain("Today's date: 2026-10-25");
    expect(sent).toContain("Date the enquiry was received: 2026-10-20");
    expect(sent).toContain("Kick-off mid March");
    expect(sent).toContain("Never invent.");

    expect(call.responseFormat?.type).toBe("json");
    const schema = JSON.stringify(call.responseFormat?.type === "json" ? call.responseFormat.schema : null);
    expect(schema).toContain('"anyOf"');
    expect(schema).not.toContain('"oneOf"');
  });

  it("says when there is no received date", async () => {
    const model = new MockLanguageModelV4({ doGenerate: answer(JSON.stringify(northwind)) });
    await readEnquiry(model, { ...input, receivedAt: null }, "2026-10-25", { maxRetries: 0 });
    expect(JSON.stringify(model.doGenerateCalls[0].prompt)).toContain("Date the enquiry was received: not given");
  });

  it("fails when the answer doesn't fit the schema", async () => {
    const wrong = { ...northwind, dates: { kind: "approximate", startDate: "2027-03-12" } };
    const model = new MockLanguageModelV4({ doGenerate: answer(JSON.stringify(wrong)) });
    expect(await readEnquiry(model, input, "2026-10-25", { maxRetries: 0 })).toEqual({
      ok: false,
      error: "its answer didn't have the expected shape.",
    });
  });

  it("fails when the answer isn't JSON", async () => {
    const model = new MockLanguageModelV4({ doGenerate: answer("Sorry, I can't help with that.") });
    expect(await readEnquiry(model, input, "2026-10-25", { maxRetries: 0 })).toEqual({
      ok: false,
      error: "its answer didn't have the expected shape.",
    });
  });

  it("fails with the service's status when the proxy is down", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new APICallError({ message: "Bad Gateway", url: "https://proxy", requestBodyValues: {}, statusCode: 502, isRetryable: false });
      },
    });
    expect(await readEnquiry(model, input, "2026-10-25", { maxRetries: 0 })).toEqual({
      ok: false,
      error: "the AI service responded 502.",
    });
  });

  it("fails clearly on a timeout", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      },
    });
    expect(await readEnquiry(model, input, "2026-10-25", { maxRetries: 0 })).toEqual({
      ok: false,
      error: "the AI took too long to answer.",
    });
  });

  it("retries a failed call", async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        if (++calls === 1) {
          throw new APICallError({ message: "Overloaded", url: "https://proxy", requestBodyValues: {}, statusCode: 529, isRetryable: true });
        }
        return answer(JSON.stringify(northwind));
      },
    });
    expect(await readEnquiry(model, input, "2026-10-25", { maxRetries: 1 })).toEqual({ ok: true, reading: northwind });
    expect(calls).toBe(2);
  });
});
