# Multimodal Model Input

OpenCat's model API supports OpenAI-compatible text and image content blocks.
The first provider profile that enables image input is Volcengine Ark.

## Supported input

- Plain text: `content: "..."`
- Mixed text and public image URLs
- Mixed text and Base64 image data URLs
- Multiple images in one user message
- Image detail levels: `auto`, `low`, and `high`

PDF and other document files are intentionally not represented as image
content. Ark handles those through its Files API and document preprocessing
flow, which will be implemented separately.

## Example

```ts
import {
  createImageBase64ContentPart,
  createImageUrlContentPart,
  createTextContentPart,
} from "./src/openai-compatible/content.js";

await modelClient.create({
  model: "your-ark-vision-endpoint",
  messages: [
    {
      role: "user",
      content: [
        createTextContentPart("Compare these two images."),
        createImageUrlContentPart("https://example.com/first.png"),
        createImageBase64ContentPart(secondImageBytes, "image/png", {
          detail: "high",
        }),
      ],
    },
  ],
});
```

`createImageBase64ContentPart` accepts raw Base64 text or a `Uint8Array` and
creates the `data:image/...;base64,...` URL required by the Chat API.

The DeepSeek provider profile remains text-only. Sending an image content part
through that profile fails locally before an HTTP request is made.
