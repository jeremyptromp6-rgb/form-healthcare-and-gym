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
 * - "development": a labelled sample meal for local testing (refused in production).
 * - "none": the registry's unconfigured provider stays in place and scanning reports unavailable.
 */
export function foodRecognitionFromConfig(config: AppConfig): Partial<ProviderRegistry> {
  const fr = config.foodRecognition;
  if (fr.provider === "anthropic") return { food: anthropicFoodRecognition({ model: fr.model, effort: fr.effort, timeoutMs: fr.timeoutMs }) };
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
