import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { developmentRecognitionProvider, fail, type FoodRecognitionProvider, type ProviderRegistry, type RecognitionResult } from "@form/domain";
import * as z from "zod/v4";
import type { AppConfig } from "../config";

/**
 * Food recognition providers, chosen by configuration:
 *
 * - "anthropic": Claude vision identifies foods, estimates portions with a range, and gives
 *   per-100 g reference nutrition. The photo is sent in the request body only — never stored.
 * - "gemini": Google Gemini vision, same output and the same checks. Gemini has a free tier;
 *   Google may use free-tier requests to improve its products.
 * - "development": a labelled sample meal for local testing (refused in production).
 * - "none": the registry's unconfigured provider stays in place and scanning reports unavailable.
 */
export function foodRecognitionFromConfig(config: AppConfig): Partial<ProviderRegistry> {
  const fr = config.foodRecognition;
  if (fr.provider === "anthropic") return { food: anthropicFoodRecognition({ model: fr.model, effort: fr.effort, timeoutMs: fr.timeoutMs }) };
  if (fr.provider === "gemini") return { food: geminiFoodRecognition({ model: fr.geminiModel, timeoutMs: fr.timeoutMs }) };
  if (fr.provider === "development") return { food: developmentRecognitionProvider() };
  return {};
}

// No numeric bounds in the schema (structured outputs keep schemas simple); the domain clamps
// and validates everything afterwards — model output is untrusted input.
const macros = z.object({ kcal: z.number(), proteinG: z.number(), carbsG: z.number(), fatG: z.number() });
const RecognitionSchema = z.object({
  imageQuality: z.enum(["ok", "too_dark", "blurry", "too_far", "obstructed"]),
  containsFood: z.boolean(),
  items: z.array(
    z.object({
      label: z.string(),
      confidence: z.number(),
      alternatives: z.array(z.object({ label: z.string(), confidence: z.number(), per100g: macros })),
      servingGrams: z.number(),
      servingLowGrams: z.number(),
      servingHighGrams: z.number(),
      per100g: macros,
      hiddenIngredients: z.array(z.string()),
      composite: z.boolean(),
    }),
  ),
});

const SYSTEM = `You identify foods in a single meal photo for a nutrition-logging app. Your output is shown to the user as an ESTIMATE they review before anything is logged, so be honest about uncertainty rather than precise-sounding.

For the photo:
- imageQuality: "ok" unless the photo is too dark, blurry, taken from too far away, or the food is blocked.
- containsFood: false if there is no food or drink in the photo.
- items: one entry per distinct food on the plate (at most 8). Use a mixed dish (curry, salad, sandwich, stir-fry) as one item with composite=true rather than guessing its ingredients.

For each item:
- label: a plain, common food name (e.g. "white rice", "grilled chicken breast"), without brands.
- confidence: 0 to 1, how sure you are about WHAT the food is. Use values below 0.45 when you are genuinely unsure, and give alternatives.
- alternatives: up to 3 other plausible identities, each with its own confidence and per-100 g nutrition.
- servingGrams with servingLowGrams and servingHighGrams: your best portion estimate in grams and a realistic range. Portion size from a photo is uncertain; make the range honest (commonly ±25–40%).
- per100g: typical reference nutrition per 100 g of the food as served (kcal, protein, carbohydrate, fat in grams).
- hiddenIngredients: things likely present but not visible that change the numbers (cooking oil, butter, dressing, sauce, sugar). Empty if none are likely.
- composite: true for a mixed dish.

Never invent food that isn't visible. If you can't tell what something is, still list it with low confidence and alternatives.`;

export function anthropicFoodRecognition(opts: { model: string; effort: AppConfig["foodRecognition"]["effort"]; timeoutMs?: number; client?: Anthropic }): FoodRecognitionProvider {
  const hasCredentials = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  // One retry at most: a user is waiting on the other end.
  const client = opts.client ?? (hasCredentials ? new Anthropic({ maxRetries: 1 }) : null);

  return {
    kind: "food_recognition",
    development: false,
    status: () => (client ? { state: "ready", provider: `Claude (${opts.model})` } : { state: "unconfigured", provider: "Claude food recognition", missing: ["ANTHROPIC_API_KEY"] }),
    async recognize(image, { signal } = {}) {
      if (!client) return fail("unconfigured", "Food recognition is not configured");
      try {
        const response = await client.beta.messages.parse(
          {
            model: opts.model,
            max_tokens: 4096,
            // Refusal fallback: if the model declines, the API re-runs the request on a fallback model.
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            output_config: { effort: opts.effort, format: betaZodOutputFormat(RecognitionSchema) },
            system: SYSTEM,
            messages: [
              {
                role: "user",
                content: [
                  { type: "image", source: { type: "base64", media_type: image.mimeType, data: Buffer.from(image.data).toString("base64") } },
                  { type: "text", text: "Identify the foods in this photo." },
                ],
              },
            ],
          },
          { signal, timeout: opts.timeoutMs ?? 30_000 },
        );
        if (response.stop_reason === "refusal") return fail("invalid_input", "This photo couldn't be analysed. Try another photo, or log the food by search.", false);
        if (response.stop_reason === "max_tokens" || !response.parsed_output) return fail("unavailable", "Food recognition returned an incomplete answer. Try again.");
        return { ok: true, value: response.parsed_output as RecognitionResult };
      } catch (error) {
        if (signal?.aborted || error instanceof Anthropic.APIUserAbortError) return fail("network", "Food recognition took too long.");
        if (error instanceof Anthropic.RateLimitError) return fail("rate_limited", "Food recognition is busy. Try again in a moment.");
        if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return fail("unavailable", "Food recognition is misconfigured.", false);
        if (error instanceof Anthropic.BadRequestError) return fail("invalid_input", "This photo couldn't be analysed. Try a clearer photo.", false);
        if (error instanceof Anthropic.APIConnectionTimeoutError || error instanceof Anthropic.APIConnectionError) return fail("network", "Couldn't reach food recognition. Check your connection and try again.");
        if (error instanceof Anthropic.APIError) return fail("unavailable", "Food recognition is temporarily unavailable.");
        throw error;
      }
    },
  };
}

/** The recognition schema as plain JSON Schema for Gemini (without $schema / additionalProperties). */
export function geminiResponseSchema(): unknown {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) if (k !== "$schema" && k !== "additionalProperties") out[k] = strip(val);
      return out;
    }
    return v;
  };
  return strip(z.toJSONSchema(RecognitionSchema));
}

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const BLOCKED_FINISH = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "IMAGE_SAFETY", "SPII", "RECITATION"]);

type GeminiResponse = {
  promptFeedback?: { blockReason?: string };
  candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[];
};

/**
 * Google Gemini vision (REST generateContent). Same system prompt, structured output and
 * downstream checks as Claude: the reply must parse against RecognitionSchema or it's treated as
 * unavailable. The key travels in a header, never in the URL.
 */
/** A stable model tried when the configured one is unknown to the API or out of free-tier quota. */
export const GEMINI_FALLBACK_MODEL = "gemini-3.5-flash";

/** The key as pasted into a dashboard: surrounding spaces, newlines and quotes are dropped. */
export function cleanApiKey(raw: string | undefined): string {
  return (raw ?? "").trim().replace(/^["']+|["']+$/g, "").trim();
}

export function geminiFoodRecognition(opts: { model: string; fallbackModel?: string | null; timeoutMs?: number; apiKey?: string; fetch?: typeof fetch }): FoodRecognitionProvider & { lastFailure(): RecognitionFailureInfo | null } {
  // GOOGLE_API_KEY is the name Google's own tools use; accept it too.
  const apiKey = cleanApiKey(opts.apiKey ?? (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY));
  const models = [...new Set([opts.model, ...(opts.fallbackModel === null ? [] : [opts.fallbackModel ?? GEMINI_FALLBACK_MODEL])])];
  const doFetch = opts.fetch ?? fetch;
  const schema = geminiResponseSchema();
  const unreadable = () => fail("invalid_input", "This photo couldn't be analysed. Try another photo, or log the food by search.", false);
  let lastFailure: RecognitionFailureInfo | null = null;

  return {
    kind: "food_recognition",
    development: false,
    status: () => (apiKey ? { state: "ready", provider: `Gemini (${opts.model})` } : { state: "unconfigured", provider: "Gemini food recognition", missing: ["GEMINI_API_KEY"] }),
    async recognize(image, { signal } = {}) {
      if (!apiKey) return fail("unconfigured", "Food recognition is not configured");
      const timeout = AbortSignal.timeout(opts.timeoutMs ?? 45_000);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const note = (stage: string, model: string, detail: string, status?: number) => {
        lastFailure = { at: new Date().toISOString(), stage, model, status: status ?? null, detail: scrub(detail) };
      };
      const send = (model: string, step: number) =>
        doFetch(`${GEMINI_URL}/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
          signal: combined,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: step === OUTPUT_STEPS.length - 1 ? `${SYSTEM}\n\n${JSON_SHAPE}` : SYSTEM }] },
            contents: [
              {
                role: "user",
                parts: [{ inlineData: { mimeType: image.mimeType, data: Buffer.from(image.data).toString("base64") } }, { text: "Identify the foods in this photo. Reply with JSON only." }],
              },
            ],
            // Thinking counts against maxOutputTokens: keep it low and leave plenty of room for the answer.
            generationConfig: { ...OUTPUT_STEPS[step]!(schema), maxOutputTokens: 16_384 },
          }),
        });
      let res!: Response;
      let usedModel = models[0]!;
      try {
        models: for (const [i, model] of models.entries()) {
          usedModel = model;
          // A request shape this model or API version rejects (400) moves to the next, simpler one.
          for (let step = 0; step < OUTPUT_STEPS.length; step++) {
            res = await send(model, step);
            if (res.status !== 400) break;
            const err = await errorOf(res.clone());
            if (isKeyProblem(err)) break;
            note(`request shape ${step + 1} rejected`, model, err.message, 400);
          }
          // Unknown model, quota used up, or a Google-side error: try the next model.
          if ((res.status === 404 || res.status === 429 || res.status >= 500) && i < models.length - 1) {
            note("model unavailable, trying fallback", model, (await errorOf(res.clone())).message, res.status);
            continue models;
          }
          break;
        }
      } catch (e) {
        note("network", usedModel, e instanceof Error ? `${e.name}: ${e.message}` : String(e));
        if (signal?.aborted || timeout.aborted) return fail("network", "Food recognition took too long. Try again.");
        return fail("network", "Couldn't reach food recognition. Try again.");
      }
      if (!res.ok) {
        const err = await errorOf(res);
        note("http error", usedModel, err.message, res.status);
        if (res.status === 429) return fail("rate_limited", "Lots of scans right now. Try again in a minute.");
        if (res.status === 401 || res.status === 403 || isKeyProblem(err)) return fail("unavailable", "Food recognition is misconfigured.", false);
        if (res.status === 400) return fail("invalid_input", "This photo couldn't be analysed. Try a clearer photo.", false);
        return fail("unavailable", "Food recognition is temporarily unavailable. Try again.");
      }
      const body = (await res.json().catch(() => null)) as GeminiResponse | null;
      if (body?.promptFeedback?.blockReason) {
        note("blocked", usedModel, body.promptFeedback.blockReason);
        return unreadable();
      }
      const candidate = body?.candidates?.[0];
      if (!candidate) {
        note("no answer", usedModel, "no candidates");
        return fail("unavailable", "Food recognition returned no answer. Try again.");
      }
      if (candidate.finishReason && BLOCKED_FINISH.has(candidate.finishReason)) {
        note("blocked", usedModel, candidate.finishReason);
        return unreadable();
      }
      const text = (candidate.content?.parts ?? [])
        .filter((p) => !p.thought && typeof p.text === "string")
        .map((p) => p.text)
        .join("");
      const parsed = parseLenient(text);
      if (parsed === undefined) {
        note("unreadable answer", usedModel, `${candidate.finishReason ?? "?"}: ${text.slice(0, 160)}`);
        return fail("unavailable", candidate.finishReason === "MAX_TOKENS" ? "Food recognition returned an incomplete answer. Try again." : "Food recognition returned an unreadable answer. Try again.");
      }
      // Model output is untrusted: normalised, then it must match the schema; the domain clamps the values after.
      const checked = RecognitionSchema.safeParse(normaliseRecognition(parsed));
      if (!checked.success) {
        note("unexpected answer", usedModel, checked.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
        return fail("unavailable", "Food recognition returned an unexpected answer. Try again.");
      }
      lastFailure = null;
      return { ok: true, value: checked.data as RecognitionResult };
    },
    lastFailure: () => lastFailure,
  };
}

/** What the last failed recognition ran into, for operators (/status). No photo, no user, no key. */
export type RecognitionFailureInfo = { at: string; stage: string; model: string; status: number | null; detail: string };

/** The food provider's last failure, when it records one (Gemini does). */
export function lastRecognitionFailure(ctx: { providers: { food: unknown } }): RecognitionFailureInfo | null {
  const food = ctx.providers.food as { lastFailure?: () => RecognitionFailureInfo | null };
  return typeof food.lastFailure === "function" ? food.lastFailure() : null;
}

/**
 * generationConfig shapes, most capable first: generateContent's JSON Schema output with low
 * thinking (as a level, then as a budget for models that use budgets), then without a thinking
 * setting, then plain JSON mode with the shape spelled out in the instructions.
 */
const OUTPUT_STEPS: ((schema: unknown) => Record<string, unknown>)[] = [
  (schema) => ({ responseMimeType: "application/json", responseJsonSchema: schema, thinkingConfig: { thinkingLevel: "low" } }),
  (schema) => ({ responseMimeType: "application/json", responseJsonSchema: schema, thinkingConfig: { thinkingBudget: 1024 } }),
  (schema) => ({ responseMimeType: "application/json", responseJsonSchema: schema }),
  () => ({ responseMimeType: "application/json" }),
];

const JSON_SHAPE = `Reply with one JSON object exactly like:
{"imageQuality":"ok"|"too_dark"|"blurry"|"too_far"|"obstructed","containsFood":true,"items":[{"label":"white rice","confidence":0.8,"alternatives":[{"label":"jasmine rice","confidence":0.1,"per100g":{"kcal":130,"proteinG":2.7,"carbsG":28,"fatG":0.3}}],"servingGrams":150,"servingLowGrams":110,"servingHighGrams":190,"per100g":{"kcal":130,"proteinG":2.7,"carbsG":28,"fatG":0.3},"hiddenIngredients":[],"composite":false}]}`;

const scrub = (s: string) => s.replace(/AIza[0-9A-Za-z_-]{10,}/g, "[key]").replace(/\s+/g, " ").slice(0, 300);

async function errorOf(res: Response): Promise<{ message: string; reasons: string[] }> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string; status?: string; details?: { reason?: string }[] } } | null;
  const message = [body?.error?.status, body?.error?.message].filter(Boolean).join(": ") || `HTTP ${res.status}`;
  return { message, reasons: (body?.error?.details ?? []).map((d) => d.reason ?? "").filter(Boolean) };
}

const isKeyProblem = (e: { message: string; reasons: string[] }) => /api key/i.test(e.message) || e.reasons.includes("API_KEY_INVALID");

/** JSON from a model reply: as is, or inside a ```json fence, or the outermost {...}. */
export function parseLenient(text: string): unknown {
  const tries = [text, text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ""), text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)];
  for (const t of tries) {
    if (!t.trim()) continue;
    try {
      return JSON.parse(t);
    } catch {
      // try the next form
    }
  }
  return undefined;
}

/**
 * Fills what a model commonly leaves out or words differently (numbers as strings, "protein"
 * for proteinG, a missing range or empty lists) so a good answer isn't thrown away over form.
 * Items without a name, portion or nutrition are dropped; the schema and domain check the rest.
 */
export function normaliseRecognition(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const r = raw as Record<string, unknown>;
  // Only fill gaps in something that is recognisably an answer; anything else fails the schema.
  if (!Array.isArray(r.items) && typeof r.containsFood !== "boolean") return raw;
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
  const macros = (m: unknown) => {
    const o = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
    return { kcal: num(o.kcal ?? o.calories) ?? 0, proteinG: num(o.proteinG ?? o.protein) ?? 0, carbsG: num(o.carbsG ?? o.carbohydrates ?? o.carbs) ?? 0, fatG: num(o.fatG ?? o.fat) ?? 0 };
  };
  const QUALITY = ["ok", "too_dark", "blurry", "too_far", "obstructed"];
  const items = (Array.isArray(r.items) ? r.items : []).flatMap((it: unknown) => {
    const i = (it && typeof it === "object" ? it : {}) as Record<string, unknown>;
    const label = typeof i.label === "string" ? i.label.trim() : typeof i.name === "string" ? i.name.trim() : "";
    const grams = num(i.servingGrams ?? i.grams);
    if (!label || grams === null || !i.per100g) return [];
    return [
      {
        label,
        confidence: num(i.confidence) ?? 0.5,
        alternatives: (Array.isArray(i.alternatives) ? i.alternatives : []).flatMap((a: unknown) => {
          const x = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
          return typeof x.label === "string" && x.label.trim() ? [{ label: x.label.trim(), confidence: num(x.confidence) ?? 0.2, per100g: macros(x.per100g) }] : [];
        }),
        servingGrams: grams,
        servingLowGrams: num(i.servingLowGrams) ?? Math.round(grams * 0.7),
        servingHighGrams: num(i.servingHighGrams) ?? Math.round(grams * 1.3),
        per100g: macros(i.per100g),
        hiddenIngredients: (Array.isArray(i.hiddenIngredients) ? i.hiddenIngredients : []).filter((h: unknown): h is string => typeof h === "string"),
        composite: i.composite === true,
      },
    ];
  });
  return {
    imageQuality: typeof r.imageQuality === "string" && QUALITY.includes(r.imageQuality) ? r.imageQuality : "ok",
    containsFood: typeof r.containsFood === "boolean" ? r.containsFood : items.length > 0,
    items,
  };
}
