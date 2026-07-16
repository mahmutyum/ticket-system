import { z } from 'zod';

export const errorResponseSchema = z.object({
  success: z.literal(false),
  error: z.string(),
});

export const successResponseSchema = z.object({ success: z.literal(true) });

export const commonErrorResponses = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  429: errorResponseSchema,
} as const;
