// The voice providers MulmoGlass talks to, each with the key it needs. The
// model lists come from MulmoChat's src/config/models.ts.

export type VoiceProvider = "openai" | "google" | "grok";

export interface VoiceModelOption {
  id: string;
  label: string;
  // Gemini Live: sent as generationConfig.thinkingConfig.thinkingLevel
  thinkingLevel?: "low" | "high";
}

export interface VoiceProviderOption {
  id: VoiceProvider;
  label: string;
  models: VoiceModelOption[];
}

export const VOICE_PROVIDERS: VoiceProviderOption[] = [
  {
    id: "openai",
    label: "OpenAI Realtime",
    models: [
      { id: "gpt-realtime-2.1", label: "GPT Realtime 2.1" },
      { id: "gpt-realtime-2.1-mini", label: "GPT Realtime 2.1 Mini" },
    ],
  },
  {
    id: "google",
    label: "Gemini Live",
    models: [
      { id: "gemini-3.8-live", label: "Gemini 3.8 Live" },
      {
        id: "gemini-3.8-live-extended-thinking",
        label: "Gemini 3.8 Live Extended Thinking",
        thinkingLevel: "high",
      },
    ],
  },
  {
    id: "grok",
    label: "Grok Voice",
    models: [
      { id: "grok-voice-think-fast-2.0", label: "Grok Voice Think Fast 2.0" },
    ],
  },
];

export const getVoiceProvider = (id: VoiceProvider): VoiceProviderOption =>
  VOICE_PROVIDERS.find((p) => p.id === id) ?? VOICE_PROVIDERS[0];

export const DEFAULT_VOICE_PROVIDER: VoiceProvider = "openai";

export type ImageBackend = "gemini" | "openai";

export const DEFAULT_GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image";
export const DEFAULT_OPENAI_IMAGE_MODEL = "gpt-image-2.5-flare";
