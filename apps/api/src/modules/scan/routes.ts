import { MEAL_TYPES, SCAN_LIMITS } from "@form/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../../shared/context";
import { dateKey } from "../../shared/dates";
import { userClock } from "../../shared/userClock";
import { confirmScan, createScan, discardScan, getScan, pruneExpiredScans } from "./service";

const scanBody = z
  .object({
    clientScanId: z.string().uuid(),
    image: z.object({ mimeType: z.enum(["image/jpeg", "image/png"]), data: z.string().min(1) }).strict(),
  })
  .strict();

// The client names options, foods and amounts — never nutrition numbers, sources or "measured".
const confirmBody = z
  .object({
    confirmKey: z.string().uuid(),
    localDate: dateKey.optional(),
    mealType: z.enum(MEAL_TYPES),
    mealName: z.string().trim().max(60).nullish(),
    items: z
      .array(
        z
          .object({
            itemId: z.string().regex(/^i\d{1,2}$/),
            remove: z.boolean().optional(),
            optionKey: z.string().regex(/^(primary|alt\d)$/).optional(),
            foodId: z.string().min(1).max(64).optional(),
            amount: z.number().positive().max(SCAN_LIMITS.maxServingGrams).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(SCAN_LIMITS.maxItems),
  })
  .strict();

const scanId = z.object({ id: z.string().uuid() });

/** Food scanner: photo → review → confirm → log. Every route is scoped to the caller. */
export function scanRoutes(app: FastifyInstance, ctx: AppContext): void {
  // ~5 MB image as base64 plus JSON overhead.
  app.post("/nutrition/scans", { bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
    const body = scanBody.parse(req.body);
    pruneExpiredScans(ctx.db, ctx.now());
    const result = await createScan(ctx, req.user.sub, body.clientScanId, { mimeType: body.image.mimeType, base64: body.image.data });
    return reply.status(result.created ? 201 : 200).send({ scan: result.scan });
  });

  app.get("/nutrition/scans/:id", async (req) => {
    const { id } = scanId.parse(req.params);
    return { scan: getScan(ctx, req.user.sub, id) };
  });

  app.post("/nutrition/scans/:id/confirm", async (req, reply) => {
    const { id } = scanId.parse(req.params);
    const body = confirmBody.parse(req.body);
    const result = confirmScan(ctx, req.user.sub, id, body, userClock(ctx, req.user.sub));
    return reply.status(result.duplicate ? 200 : 201).send({ duplicate: result.duplicate, scan: result.scan });
  });

  app.delete("/nutrition/scans/:id", async (req, reply) => {
    const { id } = scanId.parse(req.params);
    discardScan(ctx, req.user.sub, id);
    return reply.status(204).send();
  });
}
