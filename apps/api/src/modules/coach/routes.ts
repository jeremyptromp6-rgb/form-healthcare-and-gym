import { COACH_TOPICS } from "@form/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../../shared/context";
import { dateKey } from "../../shared/dates";
import { userClock } from "../../shared/userClock";
import { loadSettings } from "../users/repo";
import { CHAT_MAX_CHARS, chatHistory, clearChat, coachChat, coachInsight, coachMode, COACH_RETENTION_DAYS } from "./service";

/**
 * AI Coach. Clients send only a question or a topic; the server builds the context from its own
 * records, picks the provider, validates the answer and says honestly which provider produced it.
 */
export function coachRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/coach/status", async (req) => {
    const mode = coachMode(ctx, req.user.sub);
    const settings = loadSettings(ctx.db, req.user.sub);
    return {
      mode: mode.type,
      provider: mode.provider,
      reason: mode.reason,
      aiAvailable: mode.aiAvailable,
      settings: { enabled: settings.aiCoachEnabled, aiConsent: settings.aiCoachConsent, keepHistory: settings.coachKeepHistory },
      chat: { available: mode.type !== "unavailable", maxChars: CHAT_MAX_CHARS, perHour: ctx.config.coach.chatPerHour },
      retentionDays: COACH_RETENTION_DAYS,
    };
  });

  app.get("/coach/insight", async (req) => {
    const q = z
      .object({ topic: z.enum(COACH_TOPICS).exclude(["chat", "weekly_report"]).default("daily_insight"), today: dateKey.optional() })
      .parse(req.query);
    return { insight: await coachInsight(ctx, req.user.sub, userClock(ctx, req.user.sub, q.today), q.topic) };
  });

  app.get("/coach/messages", async (req) => ({ messages: chatHistory(ctx.db, req.user.sub, ctx.now()), retentionDays: COACH_RETENTION_DAYS }));

  app.post("/coach/messages", async (req, reply) => {
    const body = z
      .object({ message: z.string().trim().min(1).max(CHAT_MAX_CHARS), clientMessageId: z.string().uuid(), today: dateKey.optional() })
      .strict()
      .parse(req.body);
    const result = await coachChat(ctx, req.user.sub, userClock(ctx, req.user.sub, body.today), body);
    return reply.status(result.duplicate ? 200 : 201).send(result);
  });

  app.delete("/coach/messages", async (req, reply) => {
    clearChat(ctx.db, req.user.sub);
    return reply.status(204).send();
  });
}
