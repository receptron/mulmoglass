// The user's settings, kept on this device only (localStorage). API keys never
// leave the browser except in requests to the provider they belong to.
import { reactive, watch } from "vue";
import {
  DEFAULT_VOICE_PROVIDER,
  VOICE_KEY,
  type ApiKeyName,
  type ImageBackend,
  type VoiceProvider,
} from "../config/models";
import { DEFAULT_LANGUAGE_CODE } from "../config/languages";

export type ApiKeys = Record<ApiKeyName, string>;

export interface Settings {
  keys: ApiKeys;
  voiceProvider: VoiceProvider;
  language: string;
  imageBackend: ImageBackend;
}

const STORAGE_KEY = "mulmoglass_settings_v1";

const defaults = (): Settings => ({
  keys: { openai: "", gemini: "", xai: "" },
  voiceProvider: DEFAULT_VOICE_PROVIDER,
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
  if (typeof stored.language === "string") settings.language = stored.language;
  if (
    stored.imageBackend === "gemini" ||
    stored.imageBackend === "openai" ||
    stored.imageBackend === "xai"
  ) {
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

/** The key the selected voice needs, if it isn't set yet. */
export const missingVoiceKey = (s: Settings): ApiKeyName | null => {
  const name = VOICE_KEY[s.voiceProvider];
  return s.keys[name] ? null : name;
};

/** No key at all: a first launch. */
export const hasNoKeys = (s: Settings): boolean =>
  !Object.values(s.keys).some((key) => key);

export function useSettings(): Settings {
  return settings;
}
