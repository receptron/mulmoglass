// Image generation straight from the browser with the user's key: Gemini's
// generateContent, OpenAI's Images API or xAI's (Grok Imagine). The same ToolResult shape as
// MulmoChat's server-side context.app.generateImage
// (server/plugins/appContext.ts), so generateImage's View renders it.
import type { ToolResult } from "gui-chat-protocol";
import { IMAGE_MODELS, type ImageBackend } from "../config/models";
import { artifactsFileOps } from "./workspace";

export interface ImageSettings {
  backend: ImageBackend;
  geminiKey: string;
  openaiKey: string;
  xaiKey: string;
}

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

async function geminiImage(prompt: string, key: string): Promise<string> {
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
        contents: [{ parts: [{ text: prompt }] }],
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

async function openaiImage(prompt: string, key: string): Promise<string> {
  if (!key) throw missingKey("OpenAI");
  const response = await request(
    "OpenAI",
    "https://api.openai.com/v1/images/generations",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: IMAGE_MODELS.openai.model,
        prompt,
        size: "1024x1024",
      }),
    },
  );
  if (!response.ok) throw await httpFailure("OpenAI", response);
  const body = (await response.json()) as { data?: { b64_json?: string }[] };
  const b64 = body.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI returned no image");
  return `data:image/png;base64,${b64}`;
}

// xAI's Images API (OpenAI-shaped). It returns JPEG and says so in mime_type.
async function xaiImage(prompt: string, key: string): Promise<string> {
  if (!key) throw missingKey("xAI");
  const response = await request(
    "xAI",
    "https://api.x.ai/v1/images/generations",
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

// Every generated image is saved as artifacts/images/<YYYY>/<MM>/<id>.<ext>,
// as MulmoClaude does (server/utils/files/image-store.ts), and its path goes
// to the model in the result, so a later tool call can refer to it. The
// result keeps the data URL too: MulmoGlass has no server to turn a path into
// a picture, so the Views show the data URL.
const IMAGES_DIR = "images";
const EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** Save a data URL; returns its workspace path, or null when it can't be. */
async function saveImage(dataUrl: string): Promise<string | null> {
  const match = /^data:([^;,]+);base64,(.*)$/.exec(dataUrl);
  const ext = match ? EXTENSIONS[match[1]] : undefined;
  if (!match || !ext) return null;
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const id = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  const rel = `${IMAGES_DIR}/${now.getUTCFullYear()}/${month}/${id}.${ext}`;
  try {
    const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
    await artifactsFileOps.write(rel, bytes);
    return `artifacts/${rel}`;
  } catch (error) {
    // Out of storage, say: the picture still shows, just without a path.
    console.warn("[image] could not save the image", error);
    return null;
  }
}

/** gui-chat-protocol's ToolContext.app.generateImage: (prompt) → ToolResult. */
export async function generateImage(
  prompt: string,
  settings: ImageSettings,
): Promise<ToolResult> {
  try {
    const imageData =
      settings.backend === "openai"
        ? await openaiImage(prompt, settings.openaiKey)
        : settings.backend === "xai"
          ? await xaiImage(prompt, settings.xaiKey)
          : await geminiImage(prompt, settings.geminiKey);
    const imagePath = await saveImage(imageData);
    return {
      data: { imageData, prompt, ...(imagePath ? { imagePath } : {}) },
      message: imagePath
        ? `image generation succeeded; saved to ${imagePath}`
        : "image generation succeeded",
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
