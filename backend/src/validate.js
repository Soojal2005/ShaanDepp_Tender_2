import { z } from 'zod';
import { badRequest } from './errors.js';

/** Parse `input` with a zod schema or throw a 400 listing every problem. */
export function parse(schema, input) {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({ field: i.path.join('.') || '(body)', message: i.message }));
    throw badRequest(`Invalid input: ${issues.map((i) => `${i.field} ${i.message}`).join('; ')}`, issues);
  }
  return result.data;
}

export const email = z.string().trim().toLowerCase().max(150).pipe(z.email());
export const password = z
  .string()
  .min(10, 'must be at least 10 characters')
  .max(200)
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'must contain a letter and a digit');
export const id = z.coerce.number().int().positive();

export { z };
