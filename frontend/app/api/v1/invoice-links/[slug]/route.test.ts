import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";

function makeParams(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

function makeRequest(): Request {
  return new Request("http://localhost/api/v1/invoice-links/abc123");
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/v1/invoice-links/[slug]", () => {
  it("returns 400 when slug is missing", async () => {
    const res = await GET(makeRequest(), makeParams(""));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("forwards the slug to the backend and proxies a 200 response", async () => {
    const invoice = {
      id: "inv_1",
      slug: "abc123",
      status: "DRAFT",
      shareUrl: "http://localhost:5173/invoice/abc123",
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(invoice),
    });

    const res = await GET(makeRequest(), makeParams("abc123"));

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/invoice-links/abc123"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(invoice);
  });

  it("URL-encodes the slug when forwarding to the backend", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });

    await GET(makeRequest(), makeParams("has space"));

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent("has space")),
    );
  });

  it("returns 404 when the backend reports the link is missing or expired", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: "Invoice link not found or expired" }),
    });

    const res = await GET(makeRequest(), makeParams("missing-slug"));

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Invoice link not found or expired");
  });

  it("returns 502 when the backend is unreachable", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("connection refused"));

    const res = await GET(makeRequest(), makeParams("abc123"));

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });
});
