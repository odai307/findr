import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { AppError, type ErrorCode } from '../../shared/errors.js';

function send(
  reply: FastifyReply,
  request: FastifyRequest,
  status: number,
  code: ErrorCode,
  message: string,
  details = {},
) {
  return reply.status(status).send({ error: { code, message, details, requestId: request.id } });
}

/** Turns every thrown error into the standard `{ error: { code, message, details, requestId } }` shape. */
export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof AppError) {
    return send(reply, request, error.statusCode, error.code, error.message, error.details);
  }
  if (hasZodFastifySchemaValidationErrors(error)) {
    return send(reply, request, 400, 'VALIDATION_FAILED', 'The request is invalid.', {
      issues: error.validation.map((v) => ({ path: v.instancePath, message: v.message })),
    });
  }
  if (error.statusCode === 429) {
    return send(reply, request, 429, 'RATE_LIMITED', 'Too many requests. Try again shortly.');
  }
  if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
    return send(reply, request, error.statusCode, 'VALIDATION_FAILED', error.message);
  }
  request.log.error({ err: error }, 'Unhandled error');
  return send(reply, request, 500, 'INTERNAL', 'Something went wrong.');
}
