// The active voice transport, chosen in Settings. All three are created up
// front and share handlers; calls go to the selected one. Adapted from
// MulmoChat's src/composables/useSessionTransport.ts.
import { computed } from "vue";
import type { VoiceProvider } from "../config/models";
import type {
  VoiceSession,
  VoiceSessionEventHandlers,
  VoiceSessionOptions,
} from "./types";
import { useOpenAIRealtime } from "./openaiRealtime";
import { useGeminiLive } from "./geminiLive";
import { useGrokVoice } from "./grokVoice";

export interface VoiceSessionSelectorOptions extends Omit<
  VoiceSessionOptions,
  "getApiKey" | "getModelId"
> {
  getProvider: () => VoiceProvider;
  getApiKey: (provider: VoiceProvider) => string;
  getModelId: (provider: VoiceProvider) => string;
}

export interface ActiveVoiceSession extends VoiceSession {
  /** Stop one provider's session, active or not (after a provider change,
   *  the previous one is no longer the active session). */
  stopChatFor: (provider: VoiceProvider) => void;
}

export function useVoiceSession(
  options: VoiceSessionSelectorOptions,
): ActiveVoiceSession {
  const forProvider = (provider: VoiceProvider): VoiceSessionOptions => ({
    buildInstructions: options.buildInstructions,
    buildTools: options.buildTools,
    handlers: options.handlers,
    getApiKey: () => options.getApiKey(provider),
    getModelId: () => options.getModelId(provider),
  });

  const sessions: Record<VoiceProvider, VoiceSession> = {
    openai: useOpenAIRealtime(forProvider("openai")),
    google: useGeminiLive(forProvider("google")),
    grok: useGrokVoice(forProvider("grok")),
  };

  const active = computed(() => sessions[options.getProvider()]);

  return {
    chatActive: computed(() => active.value.chatActive.value),
    conversationActive: computed(() => active.value.conversationActive.value),
    connecting: computed(() => active.value.connecting.value),
    isMuted: computed(() => active.value.isMuted.value),
    isConnected: () => active.value.isConnected(),
    startChat: () => active.value.startChat(),
    stopChat: () => active.value.stopChat(),
    stopChatFor: (provider) => sessions[provider].stopChat(),
    sendFunctionCallOutput: (callId, output) =>
      active.value.sendFunctionCallOutput(callId, output),
    sendUserText: (text) => active.value.sendUserText(text),
    sendInstructions: (instructions) =>
      active.value.sendInstructions(instructions),
    setMute: (muted) => active.value.setMute(muted),
    attachRemoteAudioElement: (audio) => {
      // Only OpenAI Realtime plays through an audio element; attach it to all.
      for (const session of Object.values(sessions)) {
        session.attachRemoteAudioElement(audio);
      }
    },
    registerEventHandlers: (handlers: Partial<VoiceSessionEventHandlers>) => {
      for (const session of Object.values(sessions)) {
        session.registerEventHandlers(handlers);
      }
    },
  } as ActiveVoiceSession;
}
