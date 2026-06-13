import { z } from "zod";

// 解决业务里「布尔值被序列化为字符串」的通用问题
export function semanticBoolean<T extends z.ZodType>(
  inner: T = z.boolean() as unknown as T
) {
  return z.preprocess(
    (v: unknown) => (v === 'true' ? true : v === 'false' ? false : v),
    inner,
  )
}
