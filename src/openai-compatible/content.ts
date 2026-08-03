import { Buffer } from "node:buffer";

import type {
  ModelImageDetail,
  ModelImageUrlContentPart,
  ModelTextContentPart,
  ModelUserContent,
} from "./types.js";

export type ModelImageMimeType = `image/${string}`;

export function createTextContentPart(text: string): ModelTextContentPart {
  return {
    type: "text",
    text,
  };
}

export function createImageUrlContentPart(
  url: string,
  options: { detail?: ModelImageDetail } = {},
): ModelImageUrlContentPart {
  if (!url.trim()) {
    throw new Error("Image URL must not be empty.");
  }

  return {
    type: "image_url",
    image_url: {
      url,
      ...(options.detail ? { detail: options.detail } : {}),
    },
  };
}

export function createImageBase64ContentPart(
  data: string | Uint8Array,
  mimeType: ModelImageMimeType,
  options: { detail?: ModelImageDetail } = {},
): ModelImageUrlContentPart {
  if (!/^image\/[a-z0-9.+-]+$/i.test(mimeType)) {
    throw new Error(`Invalid image MIME type: ${mimeType}`);
  }

  const encoded = typeof data === "string"
    ? normalizeBase64(data)
    : Buffer.from(data).toString("base64");
  if (!encoded) {
    throw new Error("Base64 image data must not be empty.");
  }

  return createImageUrlContentPart(
    `data:${mimeType};base64,${encoded}`,
    options,
  );
}

export function getModelUserContentText(content: ModelUserContent): string {
  if (typeof content === "string") {
    return content;
  }

  return content
    .filter((part): part is ModelTextContentPart => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function normalizeBase64(data: string): string {
  const trimmed = data.trim();
  if (trimmed.startsWith("data:")) {
    throw new Error(
      "Pass raw Base64 data to createImageBase64ContentPart, or pass the complete data URL to createImageUrlContentPart.",
    );
  }

  return trimmed.replace(/\s+/g, "");
}
