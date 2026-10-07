import { FEATURE_NAMES, type FeatureName } from "@form/domain";
import { z } from "zod";

/**
 * A recorded set trace: per-frame joint angle + form features measured on the device, with gated
 * frames marked by reason. The server re-runs verification, form and ROM over it; the client never
 * submits verified reps, form scores or ROM.
 */
const features = z.object(Object.fromEntries(FEATURE_NAMES.map((n) => [n, z.number().finite().optional()])) as Record<FeatureName, z.ZodOptional<z.ZodNumber>>).strict();

export const angleSample = z
  .object({
    tMs: z.number(),
    angleDeg: z.number(),
    confidence: z.number(),
    features: features.optional(),
    gate: z.string().regex(/^[a-z_]{1,32}$/).optional(),
  })
  .strict();

export const traceSchema = z.object({ poseStatus: z.enum(["ok", "unavailable", "permission_denied"]), samples: z.array(angleSample).max(20_000) }).strict();
