// The user's settings, kept on this device only (localStorage). API keys never
// leave the browser except in requests to the provider they belong to.
import { reactive, watch } from "vue";
import {
  DEFAULT_VOICE_PROVIDER,
  getVoiceProvider,
  type ImageBackend,
  type VoiceProvider,
} from "../config/models";
import { DEFAULT_LANGUAGE_CODE } from "../config/languages";

export interface ApiKeys {
  openai: string;
  gemini: string;
  xai: string;
}

export interface Settings {
  keys: ApiKeys;
  voiceProvider: VoiceProvider;
  voiceModel: Record<VoiceProvider, string>;
  language: string;
  imageBackend: ImageBackend;
}

const STORAGE_KEY = "mulmoglass_settings_v1";

const defaults = (): Settings => ({
  keys: { openai: "", gemini: "", xai: "" },
  voiceProvider: DEFAULT_VOICE_PROVIDER,
  voiceModel: {
    openai: getVoiceProvider("openai").models[0].id,
    google: getVoiceProvider("google").models[0].id,
    grok: getVoiceProvider("grok").models[0].id,
  },
  language: DEFAULT_LANGUAGE_CODE,
  imageBackend: "gemini",
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function load(): Settings {
  const settings = defaults();
  let stored: unknown;
  try {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
  } catch {
    return settings;
  }
  if (!isRecord(stored)) return settings;
  if (isRecord(stored.keys)) {
    for (const name of ["openai", "gemini", "xai"] as const) {
      const key = stored.keys[name];
      if (typeof key === "string") settings.keys[name] = key;
    }
  }
  if (
    stored.voiceProvider === "openai" ||
    stored.voiceProvider === "google" ||
    stored.voiceProvider === "grok"
  ) {
    settings.voiceProvider = stored.voiceProvider;
  }
  if (isRecord(stored.voiceModel)) {
    for (const provider of ["openai", "google", "grok"] as const) {
      const model = stored.voiceModel[provider];
      // A model no longer offered falls back to the provider's first.
      if (getVoiceProvider(provider).models.some((m) => m.id === model)) {
        settings.voiceModel[provider] = model as string;
      }
    }
  }
  if (typeof stored.language === "string") settings.language = stored.language;
  if (stored.imageBackend === "gemini" || stored.imageBackend === "openai") {
    settings.imageBackend = stored.imageBackend;
  }
  return settings;
}

const settings = reactive<Settings>(load());

watch(
  settings,
  (value) => localStorage.setItem(STORAGE_KEY, JSON.stringify(value)),
  { deep: true },
);

export function useSettings(): Settings {
  return settings;
}
