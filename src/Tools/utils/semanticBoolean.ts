import { z } from "zod";

export function semanticBoolean<T extends z.ZodType>(
  inner: T = z.boolean() as unknown as T
) {
  return z.preprocess(
    (v: unknown) => (v === 'true' ? true : v === 'false' ? false : v),
    inner,
  )
}
