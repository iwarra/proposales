import { describe, expect, it } from "vitest";
import type { ProposalBody } from "./body";
import { createProposalesClient, ProposalesError } from "./client";

type Reply = Response | Error;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const networkError = () => new TypeError("fetch failed");
const timeout = () => new DOMException("The operation was aborted due to timeout", "TimeoutError");

function setup(replies: Reply[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const sleeps: number[] = [];
  const client = createProposalesClient({
    baseUrl: "https://api.proposales.test",
    token: "secret-token",
    companyId: 1234,
    fetch: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      const reply = replies.shift();
      if (!reply) throw new Error("no more replies");
      if (reply instanceof Error) throw reply;
      return reply;
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { client, calls, sleeps };
}

const body: ProposalBody = {
  company_id: 1234,
  language: "en",
  title_md: "Northwind: Kick-off, mid March",
  description_md: "…",
  data: { enquiry_id: "abc", source: "enquiry-desk" },
};
const created = () => json(200, { proposal: { uuid: "u-1", url: "https://p/u-1" } });
const found = () => json(200, { data: [{ uuid: "u-1", url: "https://p/u-1", title: "x", status: "draft", data: {} }] });

describe("createProposal", () => {
  it("posts the body with auth and JSON headers, and returns uuid and url", async () => {
    const { client, calls } = setup([created()]);
    expect(await client.createProposal(body)).toEqual({ uuid: "u-1", url: "https://p/u-1" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.proposales.test/v3/proposals");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toEqual({
      Authorization: "Bearer secret-token",
      "Content-Type": "application/json",
      Accept: "application/json",
    });
    expect(JSON.parse(String(calls[0].init.body))).toEqual(body);
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ["a network error", networkError()],
    ["a timeout", timeout()],
    ["a 5xx", json(502, { error: { message: "Bad gateway" } })],
  ])("doesn't retry %s: the draft may exist", async (_, reply) => {
    const { client, calls } = setup([reply, created()]);
    await expect(client.createProposal(body)).rejects.toBeInstanceOf(ProposalesError);
    expect(calls).toHaveLength(1);
  });

  it("retries a 429, since nothing was created", async () => {
    const { client, calls, sleeps } = setup([json(429, {}), json(429, {}), created()]);
    expect(await client.createProposal(body)).toEqual({ uuid: "u-1", url: "https://p/u-1" });
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([250, 500]);
  });

  it("doesn't retry other 4xx, and shows Proposales' message", async () => {
    const { client, calls } = setup([json(400, { error: { message: "recipient.email is invalid", code: "invalid" } })]);
    await expect(client.createProposal(body)).rejects.toThrow("recipient.email is invalid");
    expect(calls).toHaveLength(1);
  });

  it("fails when the response has no proposal", async () => {
    const { client } = setup([json(200, {})]);
    await expect(client.createProposal(body)).rejects.toThrow("Proposales returned no proposal id.");
  });
});

describe("findByEnquiryId", () => {
  it("searches by data.enquiry_id, including archived, limit 1", async () => {
    const { client, calls } = setup([found()]);
    expect(await client.findByEnquiryId("abc")).toEqual({ uuid: "u-1", url: "https://p/u-1" });
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/v3/proposal-search");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      company_id: "1234",
      "filter[enquiry_id]": "abc",
      include_archived: "true",
      limit: "1",
    });
    expect(calls[0].init.method).toBe("GET");
  });

  it("returns null when nothing is found", async () => {
    const { client } = setup([json(200, { data: [] })]);
    expect(await client.findByEnquiryId("abc")).toBeNull();
  });

  it("retries a network error, a timeout, a 5xx and a 429, with 250 then 500 ms backoff", async () => {
    for (const first of [networkError(), timeout(), json(500, {}), json(429, {})]) {
      const { client, calls, sleeps } = setup([first, json(503, {}), found()]);
      expect(await client.findByEnquiryId("abc")).toEqual({ uuid: "u-1", url: "https://p/u-1" });
      expect(calls).toHaveLength(3);
      expect(sleeps).toEqual([250, 500]);
    }
  });

  it("gives up after 3 attempts", async () => {
    const { client, calls } = setup([networkError(), networkError(), networkError(), found()]);
    await expect(client.findByEnquiryId("abc")).rejects.toThrow("Couldn't reach Proposales.");
    expect(calls).toHaveLength(3);
  });

  it("doesn't retry a 400", async () => {
    const { client, calls } = setup([json(400, { error: { message: "Bad filter" } })]);
    await expect(client.findByEnquiryId("abc")).rejects.toThrow("Bad filter");
    expect(calls).toHaveLength(1);
  });
});

describe("error messages", () => {
  it("says a 401 or 403 is a setup problem", async () => {
    for (const status of [401, 403]) {
      const { client } = setup([json(status, { error: { message: "Unauthorized" } })]);
      await expect(client.createProposal(body)).rejects.toThrow(
        `Proposales rejected the API token or company id (${status}: Unauthorized). Check PROPOSALES_API_TOKEN and PROPOSALES_COMPANY_ID.`,
      );
    }
  });

  it("falls back to the status when the body can't be read", async () => {
    const { client } = setup([new Response("<html>oops</html>", { status: 404 })]);
    await expect(client.createProposal(body)).rejects.toThrow("Proposales responded 404");
  });

  it("names a timeout", async () => {
    const { client } = setup([timeout()]);
    await expect(client.createProposal(body)).rejects.toThrow("Proposales didn't respond within 8 s.");
  });

  it("never includes the token", async () => {
    const { client } = setup([json(401, { error: { message: "Unauthorized" } })]);
    await expect(client.createProposal(body)).rejects.not.toThrow(/secret-token/);
  });
});
