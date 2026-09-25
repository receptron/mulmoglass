// The voice services MulmoGlass talks to, one model each. Settings shows the
// model name; the transport connects with the same entry's id. The models come
// from MulmoChat's src/config/models.ts.

export type VoiceProvider = "openai" | "google" | "grok";

export interface VoiceModelOption {
  /** The model the session connects with. */
  model: string;
  /** What Settings shows. */
  label: string;
}

export const VOICE_MODELS: Record<VoiceProvider, VoiceModelOption> = {
  openai: { model: "gpt-realtime-2.1", label: "GPT Realtime 2.1" },
  google: { model: "gemini-3.8-live", label: "Gemini 3.8 Live" },
  grok: {
    model: "grok-voice-think-fast-2.0",
    label: "Grok Voice Think Fast 2.0",
  },
};

export const DEFAULT_VOICE_PROVIDER: VoiceProvider = "openai";

export type ImageBackend = "openai" | "gemini" | "xai";

export interface ImageModelOption {
  /** The model the API call names. */
  model: string;
  /** What Settings shows. */
  label: string;
}

// One model per image service; the label and the API call read the same
// entry. Labels are the model names (MulmoChat's src/config/imageModels.ts), kept
// short enough for the half-width dropdown.
// Listed in the Voice dropdown's order (OpenAI, Google, xAI): the dropdown
// renders the entries in this order.
export const IMAGE_MODELS: Record<ImageBackend, ImageModelOption> = {
  openai: { model: "gpt-image-2.5-flare", label: "GPT Image 2.5 Flare" },
  gemini: { model: "gemini-3.1-flash-image", label: "Gemini 3.1 Flash Image" },
  xai: { model: "grok-imagine-image-2.0", label: "Grok Imagine Image 2.0" },
};

export type ApiKeyName = "openai" | "gemini" | "xai";

export interface ApiKeyInfo {
  label: string;
  // Where the user creates one
  consoleUrl: string;
  placeholder?: string;
}

export const API_KEYS: Record<ApiKeyName, ApiKeyInfo> = {
  openai: {
    label: "OpenAI",
    consoleUrl: "https://platform.openai.com/api-keys",
    placeholder: "sk-…",
  },
  gemini: {
    label: "Gemini",
    consoleUrl: "https://aistudio.google.com/apikey",
  },
  xai: {
    label: "xAI (Grok)",
    consoleUrl: "https://console.x.ai/",
    placeholder: "xai-…",
  },
};

/** The key a voice provider connects with. */
export const VOICE_KEY: Record<VoiceProvider, ApiKeyName> = {
  openai: "openai",
  google: "gemini",
  grok: "xai",
};

/** The key an image backend generates with. */
export const IMAGE_KEY: Record<ImageBackend, ApiKeyName> = {
  openai: "openai",
  gemini: "gemini",
  xai: "xai",
};
