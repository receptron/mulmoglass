// Image generation straight from the browser with the user's key: Gemini's
// generateContent, OpenAI's Images API or xAI's (Grok Imagine). The same ToolResult shape as
// MulmoChat's server-side context.app.generateImage
// (server/plugins/appContext.ts), so generateImage's View renders it.
import type { ToolResult } from "gui-chat-protocol";
import { IMAGE_MODELS, type ImageBackend } from "../config/models";
import { loadSourceImages, saveImage, type SourceImage } from "./imageStore";

export interface ImageSettings {
  backend: ImageBackend;
  geminiKey: string;
  openaiKey: string;
  xaiKey: string;
}

// File extensions of the image types the APIs return.
const EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

// Said to the model, which tells the user what to do.
const missingKey = (name: string) =>
  new Error(
    `the ${name} API key isn't set; the user can add it in Settings, or pick another image service there`,
  );

// A failure's reason goes to the model, which tells the user, so it says what
// went wrong in a sentence. Passing the raw response made the model guess: a
// text-only Gemini answer (an essay about ATP) came back as the "reason", and
// the model told the user the prompt had been too long.
const REASON_MAX = 300;
const clip = (text: string, max = REASON_MAX) =>
  text.length > max ? `${text.slice(0, max)}…` : text;

const STATUS_HINTS: Readonly<Record<number, string>> = {
  400: "the request was rejected",
  401: "the API key was rejected; the user can check it in Settings",
  403: "the API key isn't allowed to use this model; the user can check it in Settings",
  404: "the image model wasn't found",
  429: "the rate limit or quota was exceeded",
};

/** An HTTP error from an image API, with the API's own message. */
async function httpFailure(service: string, response: Response) {
  const text = await response.text();
  let detail = "";
  try {
    const error = (JSON.parse(text) as { error?: unknown }).error;
    if (typeof error === "string") detail = error;
    else if (typeof (error as { message?: unknown })?.message === "string") {
      detail = (error as { message: string }).message;
    }
  } catch {
    detail = text;
  }
  const hint =
    STATUS_HINTS[response.status] ??
    (response.status >= 500
      ? "the service had an error; trying again may work"
      : "the request failed");
  const details = detail.trim() ? `: ${clip(detail.trim())}` : "";
  return new Error(`${service} (HTTP ${response.status}): ${hint}${details}`);
}

/** fetch, with a failure to get a readable answer said as one. OpenAI's
 *  401 for a wrong key has no CORS header, so the browser sees it as a
 *  network error too: the reason names both. */
async function request(service: string, url: string, init: RequestInit) {
  try {
    return await fetch(url, init);
  } catch {
    throw new Error(
      `couldn't reach ${service}, or it refused the request without a readable answer (a wrong API key does this with OpenAI); the user can check the connection and the key in Settings`,
    );
  }
}

// Finish reasons that mean Gemini refused the picture under its policies
// (PROHIBITED_CONTENT for "official Disney artwork of Mickey Mouse", in
// testing), said as such rather than as a code.
const GEMINI_REFUSALS = new Set([
  "SAFETY",
  "IMAGE_SAFETY",
  "PROHIBITED_CONTENT",
  "IMAGE_PROHIBITED_CONTENT",
  "BLOCKLIST",
  "SPII",
  "RECITATION",
  "IMAGE_RECITATION",
]);

interface GeminiPart {
  text?: string;
  inlineData?: { data?: string; mimeType?: string };
}

// A reference image as the APIs take it: base64 and its type.
interface ReferenceImage {
  mimeType: string;
  base64: string;
}

async function geminiImage(
  prompt: string,
  key: string,
  references: ReferenceImage[],
): Promise<string> {
  if (!key) throw missingKey("Gemini");
  const response = await request(
    "Gemini",
    `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODELS.gemini.model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      // Without responseModalities the model may answer a prompt that reads
      // like a question ("ATP's structure: …") with text alone: one call in
      // three in testing, which ended a slideshow. IMAGE alone always gave an
      // image. (MulmoClaude also asks for 16:9; here that image is taller than
      // the canvas in ui-image's View, which fits it to the width.)
      body: JSON.stringify({
        contents: [
          {
            parts: [
              ...references.map(({ mimeType, base64 }) => ({
                inlineData: { mimeType, data: base64 },
              })),
              { text: prompt },
            ],
          },
        ],
        generationConfig: { responseModalities: ["IMAGE"] },
      }),
    },
  );
  if (!response.ok) throw await httpFailure("Gemini", response);
  const body = (await response.json()) as {
    promptFeedback?: { blockReason?: string };
    candidates?: {
      finishReason?: string;
      finishMessage?: string;
      content?: { parts?: GeminiPart[] };
    }[];
  };
  const blocked = body.promptFeedback?.blockReason;
  if (blocked) {
    throw new Error(
      `Gemini blocked the prompt (${blocked}); rewording it may work`,
    );
  }
  const candidate = body.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const image = parts.find((part) => part.inlineData?.data)?.inlineData;
  if (!image?.data) {
    const finish = candidate?.finishReason;
    const note = candidate?.finishMessage?.trim();
    if (finish && GEMINI_REFUSALS.has(finish)) {
      const explained = note ? `: ${clip(note)}` : "";
      throw new Error(
        `Gemini refused to make this picture under its content policy (${finish})${explained}; a different subject or wording may work`,
      );
    }
    const text = parts.find((part) => part.text)?.text?.trim();
    const finished =
      finish && finish !== "STOP" ? ` (finish reason ${finish})` : "";
    const answered = text
      ? `; it answered with text instead: "${clip(text, 120)}"`
      : "";
    throw new Error(`Gemini returned no image${finished}${answered}`);
  }
  return `data:${image.mimeType || "image/png"};base64,${image.data}`;
}

// Reference images go to the edits endpoint, as multipart image[] files.
function openaiRequest(
  prompt: string,
  references: ReferenceImage[],
): { url: string; headers: Record<string, string>; body: BodyInit } {
  if (!references.length) {
    return {
      url: "https://api.openai.com/v1/images/generations",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: IMAGE_MODELS.openai.model,
        prompt,
        size: "1024x1024",
      }),
    };
  }
  const form = new FormData();
  form.append("model", IMAGE_MODELS.openai.model);
  form.append("prompt", prompt);
  form.append("size", "1024x1024");
  references.forEach(({ mimeType, base64 }, i) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const ext = EXTENSIONS[mimeType] ?? "png";
    form.append(
      "image[]",
      new Blob([bytes], { type: mimeType }),
      `ref${i}.${ext}`,
    );
  });
  return {
    url: "https://api.openai.com/v1/images/edits",
    headers: {},
    body: form,
  };
}

async function openaiImage(
  prompt: string,
  key: string,
  references: ReferenceImage[],
): Promise<string> {
  if (!key) throw missingKey("OpenAI");
  const { url, headers, body: requestBody } = openaiRequest(prompt, references);
  const response = await request("OpenAI", url, {
    method: "POST",
    headers: { ...headers, Authorization: `Bearer ${key}` },
    body: requestBody,
  });
  if (!response.ok) throw await httpFailure("OpenAI", response);
  const body = (await response.json()) as { data?: { b64_json?: string }[] };
  const b64 = body.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI returned no image");
  return `data:image/png;base64,${b64}`;
}

// xAI's Images API (OpenAI-shaped). It returns JPEG and says so in mime_type.
// Reference images go to the edits endpoint, as an `images` list of data
// URLs (a single `image` takes one).
async function xaiImage(
  prompt: string,
  key: string,
  references: ReferenceImage[],
): Promise<string> {
  if (!key) throw missingKey("xAI");
  const edits = references.length > 0;
  const response = await request(
    "xAI",
    `https://api.x.ai/v1/images/${edits ? "edits" : "generations"}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: IMAGE_MODELS.xai.model,
        prompt,
        response_format: "b64_json",
        ...(edits && {
          images: references.map(({ mimeType, base64 }) => ({
            type: "image_url",
            url: `data:${mimeType};base64,${base64}`,
          })),
        }),
      }),
    },
  );
  if (!response.ok) throw await httpFailure("xAI", response);
  const body = (await response.json()) as {
    data?: { b64_json?: string; mime_type?: string }[];
  };
  const image = body.data?.[0];
  if (!image?.b64_json) throw new Error("xAI returned no image");
  return `data:${image.mime_type || "image/jpeg"};base64,${image.b64_json}`;
}

// A reference image is sent at most this many pixels on its longer side, as
// a JPEG: a character sheet is 0.7–1 MB as generated, and a panel with three
// characters sent them all, over the glasses' connection.
const REFERENCE_MAX_SIDE = 768;
const REFERENCE_QUALITY = 0.85;

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

/** A base64 data URL's bytes (every image API answers in base64). */
const bytesOf = (dataUrl: string): Uint8Array =>
  Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(",") + 1)), (c) =>
    c.charCodeAt(0),
  );

/** A saved image as a reference image, made smaller when it can be. */
async function referenceImage({
  mimeType,
  bytes,
}: SourceImage): Promise<ReferenceImage> {
  try {
    const bitmap = await createImageBitmap(
      new Blob([new Uint8Array(bytes)], { type: mimeType }),
    );
    const scale = Math.min(
      1,
      REFERENCE_MAX_SIDE / Math.max(bitmap.width, bitmap.height),
    );
    const canvas = new OffscreenCanvas(
      Math.round(bitmap.width * scale),
      Math.round(bitmap.height * scale),
    );
    canvas
      .getContext("2d")
      ?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await canvas.convertToBlob({
      type: "image/jpeg",
      quality: REFERENCE_QUALITY,
    });
    return {
      mimeType: "image/jpeg",
      base64: toBase64(new Uint8Array(await blob.arrayBuffer())),
    };
  } catch {
    // Sent as it is.
    return { mimeType, base64: toBase64(bytes) };
  }
}

/** gui-chat-protocol's ToolContext.app.generateImage: (prompt) → ToolResult.
 *  `sourceImages` are saved pictures the new one should follow, such as a
 *  storyboard's character sheets; every image service takes them.
 *
 *  Every generated image is saved (./imageStore.ts) and its path goes to the
 *  model in the result, so a later tool call can refer to it. The result keeps
 *  the data URL too: MulmoGlass has no server to turn a path into a picture,
 *  so the Views show the data URL. */
export async function generateImage(
  prompt: string,
  settings: ImageSettings,
  sourceImages: readonly SourceImage[] = [],
): Promise<ToolResult> {
  try {
    const references = await Promise.all(sourceImages.map(referenceImage));
    // Tests, dev builds only (./mockImage.ts); a production build leaves
    // the import out.
    const mocked = import.meta.env.DEV
      ? await (await import("./mockImage")).mockImage(prompt, references.length)
      : undefined;
    const imageData =
      mocked ??
      (settings.backend === "openai"
        ? await openaiImage(prompt, settings.openaiKey, references)
        : settings.backend === "xai"
          ? await xaiImage(prompt, settings.xaiKey, references)
          : await geminiImage(prompt, settings.geminiKey, references));
    const imagePath = await saveImage(bytesOf(imageData));
    // As in MulmoChat: the model is told when there is no path, so it doesn't
    // look for one.
    const savedTo = imagePath
      ? `; saved to ${imagePath}`
      : "; it could not be saved, so it has no path";
    return {
      data: { imageData, prompt, ...(imagePath ? { imagePath } : {}) },
      message: `image generation succeeded${savedTo}`,
      instructions:
        "Acknowledge that the image was generated and has been already presented to the user.",
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("Image generation failed", reason);
    return {
      message: `image generation failed: ${reason}`,
      instructions:
        "Tell the user briefly that the image couldn't be made and why, using the reason in the result. Don't guess at another reason.",
    };
  }
}

/**
 * context.app.editImages: (prompt, imagePaths) → ToolResult. A new image from
 * saved images (artifacts/images/…, at most 8) and a prompt: one image to
 * restyle, or references such as character sheets to draw with. The same
 * arguments and refusals as MulmoChat's (server/plugins/appContext.ts) and
 * MulmoClaude's editImages.
 */
export async function editImages(
  prompt: unknown,
  imagePaths: unknown,
  settings: ImageSettings,
): Promise<ToolResult> {
  if (typeof prompt !== "string" || !prompt.trim()) {
    return { message: "image edit failed: prompt is required" };
  }
  let sources: SourceImage[];
  try {
    sources = await loadSourceImages(imagePaths);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      message: `image edit failed: ${reason}`,
      instructions:
        "Acknowledge that the image edit failed and briefly tell the user the reason.",
    };
  }
  return generateImage(prompt, settings, sources);
}
