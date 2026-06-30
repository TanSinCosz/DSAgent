import { z } from "zod";

export const inputSchema = () =>
  z.strictObject({
    url: z
      .string()
      .trim()
      .url()
      .refine((value) => {
        try {
          const url = new URL(value);
          return url.protocol === "http:" || url.protocol === "https:";
        } catch {
          return false;
        }
      }, {
        message: "WebFetch only supports http and https URLs.",
      })
      .describe("The public HTTP(S) URL to fetch."),
    prompt: z
      .string()
      .trim()
      .min(1)
      .max(4_000)
      .describe(
        "The extraction goal for the fetched page. Initial implementation returns extracted page text and does not run a model over this prompt yet.",
      ),
  });

export const outputSchema = () =>
  z.object({
    url: z.string(),
    finalUrl: z.string(),
    code: z.number(),
    codeText: z.string(),
    contentType: z.string(),
    bytes: z.number(),
    text: z.string(),
    durationMs: z.number(),
    redirected: z.boolean(),
    truncated: z.boolean(),
    note: z.string().optional(),
  });
