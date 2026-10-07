import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { anthropicFoodRecognition } from "../src/providers/foodRecognition";

/**
 * The Claude food-recognition provider against a stubbed transport: checks the request we send
 * (model, image, structured output, effort, fallback) and how every kind of response is mapped.
 * No network calls are made.
 */

const RESULT = {
  imageQuality: "ok",
  containsFood: true,
  items: [
    {
      label: "banana",
      confidence: 0.93,
      alternatives: [{ label: "plantain", confidence: 0.05, per100g: { kcal: 122, proteinG: 1.3, carbsG: 32, fatG: 0.4 } }],
      servingGrams: 118,
      servingLowGrams: 95,
      servingHighGrams: 140,
      per100g: { kcal: 89, proteinG: 1.1, carbsG: 22.8, fatG: 0.3 },
      hiddenIngredients: [],
      composite: false,
    },
  ],
};

function message(over: Record<string, unknown> = {}) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [{ type: "text", text: JSON.stringify(RESULT) }],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 1500, output_tokens: 200 },
    ...over,
  };
}

function stubbed(respond: (body: Record<string, unknown>) => Response | Promise<Response>) {
  const requests: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const client = new Anthropic({
    apiKey: "test-key",
    maxRetries: 0,
    fetch: async (url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      requests.push({ url: String(url), headers: new Headers(init?.headers as HeadersInit), body });
      return respond(body);
    },
  });
  return { requests, provider: anthropicFoodRecognition({ model: "claude-opus-5-5", effort: "medium", client }) };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const IMAGE = { mimeType: "image/jpeg" as const, data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) };

describe("Claude food recognition provider", () => {
  it("sends the photo with a JSON schema, explicit effort and the refusal fallback; parses the result", async () => {
    const { requests, provider } = stubbed(() => json(200, message()));
    const r = await provider.recognize(IMAGE);
    expect(r).toEqual({ ok: true, value: RESULT });
    const { body, headers } = requests[0]!;
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.fallbacks).toBe("default");
    expect(headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect((body.output_config as { effort: string; format: { type: string } }).effort).toBe("medium");
    expect((body.output_config as { format: { type: string } }).format.type).toBe("json_schema");
    const content = (body.messages as { content: { type: string; source?: { media_type: string; data: string } }[] }[])[0]!.content;
    expect(content[0]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: Buffer.from(IMAGE.data).toString("base64") } });
    expect(String(body.system)).toMatch(/ESTIMATE/);
  });

  it("maps refusals, truncation and API errors to honest provider failures", async () => {
    const cases: [Response | (() => Response), { code: string; retryable: boolean }][] = [
      [json(200, message({ stop_reason: "refusal", content: [] })), { code: "invalid_input", retryable: false }],
      [json(200, message({ stop_reason: "max_tokens" })), { code: "unavailable", retryable: true }],
      [json(429, { type: "error", error: { type: "rate_limit_error", message: "slow down" } }), { code: "rate_limited", retryable: true }],
      [json(401, { type: "error", error: { type: "authentication_error", message: "bad key" } }), { code: "unavailable", retryable: false }],
      [json(400, { type: "error", error: { type: "invalid_request_error", message: "bad image" } }), { code: "invalid_input", retryable: false }],
      [json(529, { type: "error", error: { type: "overloaded_error", message: "busy" } }), { code: "unavailable", retryable: true }],
    ];
    for (const [response, expected] of cases) {
      const { provider } = stubbed(() => (typeof response === "function" ? response() : response.clone()));
      expect(await provider.recognize(IMAGE)).toMatchObject({ ok: false, ...expected });
    }
  });

  it("an aborted request (our scan deadline) is a retryable network failure", async () => {
    const controller = new AbortController();
    const { provider } = stubbed(
      () =>
        new Promise<Response>((_, reject) => {
          controller.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const pending = provider.recognize(IMAGE, { signal: controller.signal });
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, code: "network", retryable: true });
  });

  it("is unconfigured without credentials", async () => {
    const saved = { key: process.env.ANTHROPIC_API_KEY, token: process.env.ANTHROPIC_AUTH_TOKEN };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    try {
      const p = anthropicFoodRecognition({ model: "claude-opus-5-5", effort: "medium" });
      expect(p.status()).toMatchObject({ state: "unconfigured", missing: ["ANTHROPIC_API_KEY"] });
      expect(await p.recognize(IMAGE)).toMatchObject({ ok: false, code: "unconfigured" });
    } finally {
      if (saved.key !== undefined) process.env.ANTHROPIC_API_KEY = saved.key;
      if (saved.token !== undefined) process.env.ANTHROPIC_AUTH_TOKEN = saved.token;
    }
  });
});
