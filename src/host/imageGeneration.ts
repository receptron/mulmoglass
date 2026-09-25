// Image generation straight from the browser with the user's key: Gemini's
// generateContent or OpenAI's Images API. The same ToolResult shape as
// MulmoChat's server-side context.app.generateImage
// (server/plugins/appContext.ts), so generateImage's View renders it.
import type { ToolResult } from "gui-chat-protocol";
import {
  DEFAULT_GEMINI_IMAGE_MODEL,
  DEFAULT_OPENAI_IMAGE_MODEL,
  type ImageBackend,
} from "../config/models";

export interface ImageSettings {
  backend: ImageBackend;
  geminiKey: string;
  openaiKey: string;
}

interface GeminiPart {
  text?: string;
  inlineData?: { data?: string; mimeType?: string };
}

async function geminiImage(prompt: string, key: string): Promise<string> {
  if (!key) throw new Error("no Gemini API key in Settings");
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_IMAGE_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    },
  );
  if (!response.ok) {
    throw new Error(`Gemini: ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as {
    candidates?: { content?: { parts?: GeminiPart[] } }[];
  };
  const parts = body.candidates?.[0]?.content?.parts ?? [];
  const image = parts.find((part) => part.inlineData?.data)?.inlineData;
  if (!image?.data) {
    const text = parts.find((part) => part.text)?.text;
    throw new Error(text || "Gemini returned no image");
  }
  return `data:${image.mimeType || "image/png"};base64,${image.data}`;
}

async function openaiImage(prompt: string, key: string): Promise<string> {
  if (!key) throw new Error("no OpenAI API key in Settings");
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: DEFAULT_OPENAI_IMAGE_MODEL,
      prompt,
      size: "1024x1024",
    }),
  });
  if (!response.ok) {
    throw new Error(`OpenAI: ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as { data?: { b64_json?: string }[] };
  const b64 = body.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI returned no image");
  return `data:image/png;base64,${b64}`;
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
        : await geminiImage(prompt, settings.geminiKey);
    return {
      data: { imageData, prompt },
      message: "image generation succeeded",
      instructions:
        "Acknowledge that the image was generated and has been already presented to the user.",
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("Image generation failed", reason);
    return {
      message: `image generation failed: ${reason}`,
      instructions:
        "Acknowledge that the image generation failed and briefly tell the user the reason.",
    };
  }
}
