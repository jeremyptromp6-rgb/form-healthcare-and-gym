import { describe, expect, it } from "vitest";
import { geminiFoodRecognition, geminiResponseSchema } from "../src/providers/foodRecognition";

/**
 * The Gemini food-recognition provider against a stubbed transport: checks the request we send
 * (model, key header, image, structured output) and how every kind of response is mapped.
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

const IMAGE = { mimeType: "image/jpeg" as const, data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const answer = (text: string, finishReason = "STOP") => json(200, { candidates: [{ finishReason, content: { role: "model", parts: [{ text }] } }] });

function stubbed(respond: () => Response | Promise<Response>, apiKey = "test-gemini-key") {
  const requests: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const provider = geminiFoodRecognition({
    model: "gemini-3.8-flash",
    apiKey,
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), headers: new Headers(init?.headers as HeadersInit), body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
      return respond();
    }) as typeof fetch,
  });
  return { requests, provider };
}

describe("Gemini food recognition provider", () => {
  it("sends the photo with the key in a header and asks for structured JSON", async () => {
    const { requests, provider } = stubbed(() => answer(JSON.stringify(RESULT)));
    const r = await provider.recognize(IMAGE);
    expect(r).toEqual({ ok: true, value: RESULT });
    const req = requests[0]!;
    expect(req.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
    expect(req.url).not.toContain("test-gemini-key");
    expect(req.headers.get("x-goog-api-key")).toBe("test-gemini-key");
    const contents = req.body.contents as { parts: { inlineData?: { mimeType: string; data: string }; text?: string }[] }[];
    expect(contents[0]!.parts[0]!.inlineData).toEqual({ mimeType: "image/jpeg", data: Buffer.from(IMAGE.data).toString("base64") });
    const config = req.body.generationConfig as { responseFormat: { text: { mimeType: string; schema: unknown } } };
    expect(config.responseFormat.text.mimeType).toBe("APPLICATION_JSON");
    expect(config.responseFormat.text.schema).toEqual(geminiResponseSchema());
    expect(JSON.stringify(geminiResponseSchema())).not.toMatch(/\$schema|additionalProperties/);
    expect(provider.status()).toEqual({ state: "ready", provider: "Gemini (gemini-3.8-flash)" });
  });

  it("ignores thought parts and joins the answer text", async () => {
    const text = JSON.stringify(RESULT);
    const { provider } = stubbed(() =>
      json(200, { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "thinking…", thought: true }, { text: text.slice(0, 40) }, { text: text.slice(40) }] } }] }),
    );
    expect(await provider.recognize(IMAGE)).toEqual({ ok: true, value: RESULT });
  });

  it("falls back to the older structured-output fields if the API doesn't know responseFormat", async () => {
    let call = 0;
    const { requests, provider } = stubbed(() =>
      ++call === 1 ? json(400, { error: { message: 'Invalid JSON payload received. Unknown name "responseFormat" at \'generation_config\'.' } }) : answer(JSON.stringify(RESULT)),
    );
    expect(await provider.recognize(IMAGE)).toEqual({ ok: true, value: RESULT });
    expect(requests).toHaveLength(2);
    const legacy = requests[1]!.body.generationConfig as Record<string, unknown>;
    expect(legacy.responseFormat).toBeUndefined();
    expect(legacy).toMatchObject({ responseMimeType: "application/json", responseJsonSchema: geminiResponseSchema() });
  });

  it("is unconfigured without a key and never calls out", async () => {
    const { requests, provider } = stubbed(() => answer("{}"), "");
    expect(provider.status()).toMatchObject({ state: "unconfigured", missing: ["GEMINI_API_KEY"] });
    expect(await provider.recognize(IMAGE)).toMatchObject({ ok: false, code: "unconfigured" });
    expect(requests).toHaveLength(0);
  });

  it.each([
    ["rate limit", () => json(429, { error: { code: 429, status: "RESOURCE_EXHAUSTED" } }), "rate_limited"],
    ["bad key", () => json(400, { error: { message: "API key not valid. Please pass a valid API key.", details: [{ reason: "API_KEY_INVALID" }] } }), "unavailable"],
    ["forbidden", () => json(403, { error: { status: "PERMISSION_DENIED" } }), "unavailable"],
    ["bad request", () => json(400, { error: { message: "Unable to process input image." } }), "invalid_input"],
    ["server error", () => json(503, { error: { status: "UNAVAILABLE" } }), "unavailable"],
    ["blocked prompt", () => json(200, { promptFeedback: { blockReason: "SAFETY" } }), "invalid_input"],
    ["safety stop", () => answer("", "SAFETY"), "invalid_input"],
    ["cut off", () => answer('{"imageQuality":"ok"', "MAX_TOKENS"), "unavailable"],
    ["no candidates", () => json(200, { candidates: [] }), "unavailable"],
    ["not JSON", () => answer("a banana"), "unavailable"],
    ["wrong shape", () => answer(JSON.stringify({ imageQuality: "ok", containsFood: true, items: [{ label: "banana" }] })), "unavailable"],
  ] as const)("maps %s to %s", async (_name, respond, code) => {
    const { provider } = stubbed(respond);
    expect(await provider.recognize(IMAGE)).toMatchObject({ ok: false, code });
  });

  it("reports a network failure as retryable", async () => {
    const provider = geminiFoodRecognition({ model: "gemini-3.8-flash", apiKey: "k", fetch: (async () => Promise.reject(new TypeError("fetch failed"))) as typeof fetch });
    expect(await provider.recognize(IMAGE)).toMatchObject({ ok: false, code: "network", retryable: true });
  });

  it("gives up when the caller aborts", async () => {
    const controller = new AbortController();
    const provider = geminiFoodRecognition({
      model: "gemini-3.8-flash",
      apiKey: "k",
      fetch: ((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as typeof fetch,
    });
    const pending = provider.recognize(IMAGE, { signal: controller.signal });
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, code: "network" });
  });
});
