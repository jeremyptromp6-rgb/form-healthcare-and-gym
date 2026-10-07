import { DomainValidationError } from "@form/domain";
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Every error leaves the API in one shape: { error: { code, message, details? } }. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError | Error, req: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: "invalid_request",
          message: "Request validation failed",
          details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      });
    }
    if (err instanceof DomainValidationError) {
      return reply.status(422).send({ error: { code: "invalid_value", message: err.message, details: { field: err.field } } });
    }
    const status = (err as FastifyError).statusCode;
    if (status && status < 500) {
      const code = status === 429 ? "rate_limited" : status === 401 ? "unauthorized" : "bad_request";
      return reply.status(status).send({ error: { code, message: err.message } });
    }
    // Logged with its stack for operations; the client only gets a reference to quote.
    req.log.error({ err }, "unhandled error");
    return reply.status(500).send({ error: { code: "internal", message: "Something went wrong", details: { requestId: req.id } } });
  });

  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: { code: "not_found", message: "Not found" } }));
}
