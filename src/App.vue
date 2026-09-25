<template>
  <div class="h-full w-full flex flex-col bg-slate-950 text-slate-100">
    <!-- The canvas: the selected tool result's View, full size -->
    <main class="flex-1 min-h-0 relative">
      <component
        v-if="selectedView && selectedResult"
        :is="selectedView"
        :key="selectedResult.uuid"
        class="h-full w-full bg-white text-slate-900"
        :selected-result="selectedResult"
        :send-text-message="sendTextFromView"
        :set-mute="setMute"
        :is-audio-playing="isAudioPlaying"
        @update-result="updateResult"
      />
      <div
        v-else
        class="h-full w-full flex flex-col items-center justify-center gap-4 text-slate-400"
      >
        <span class="material-icons" style="font-size: 96px">view_in_ar</span>
        <p class="text-2xl">
          {{
            chatActive
              ? "Ask for anything — results appear here."
              : "Tap the microphone to start."
          }}
        </p>
      </div>

      <div
        v-if="runningMessage"
        class="absolute top-6 left-1/2 -translate-x-1/2 rounded-full bg-slate-800/90 px-6 py-3 text-xl flex items-center gap-3"
      >
        <span class="material-icons animate-spin">autorenew</span>
        {{ runningMessage }}
      </div>

      <div
        v-if="errorMessage"
        class="absolute top-6 inset-x-6 rounded-xl bg-red-900/95 px-6 py-4 text-lg flex items-start gap-4"
        role="alert"
      >
        <span class="material-icons">error</span>
        <p class="flex-1 break-words">{{ errorMessage }}</p>
        <button
          class="rounded-full p-2 hover:bg-red-800"
          aria-label="Dismiss"
          @click="errorMessage = ''"
        >
          <span class="material-icons">close</span>
        </button>
      </div>
    </main>

    <ControlBar
      :chat-active="chatActive"
      :connecting="connecting"
      :is-muted="isMuted"
      :status="status"
      :caption="caption"
      :result-count="results.length"
      :selected-index="selectedIndex"
      @toggle-chat="toggleChat"
      @toggle-mute="setMute(!isMuted)"
      @select="select"
      @open-settings="settingsOpen = true"
    />

    <SettingsPanel
      v-if="settingsOpen"
      :locked="chatActive || connecting"
      @close="settingsOpen = false"
    />

    <audio ref="remoteAudio" autoplay></audio>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import ControlBar from "./components/ControlBar.vue";
import SettingsPanel from "./components/SettingsPanel.vue";
import { useSettings } from "./composables/useSettings";
import { useToolResults } from "./composables/useToolResults";
import { useVoiceSession } from "./voice/useVoiceSession";
import {
  getToolPlugin,
  pluginSystemPrompts,
  pluginTools,
  setPluginLocale,
} from "./tools";
import { setImageSettingsSource } from "./host/pluginHost";
import { getLanguageName } from "./config/languages";
import type { VoiceProvider } from "./config/models";

const settings = useSettings();

const BASE_PROMPT =
  "You are MulmoGlass, a voice assistant running on the user's VR glasses. The user talks to you; they can't type. Tool results appear on a large screen in front of them, so present things visually with your tools, and keep your spoken replies short.";

const buildInstructions = () =>
  `${BASE_PROMPT}\n${pluginSystemPrompts()}\nThe user's native language is ${getLanguageName(settings.language)}.`;

const keyOf = (provider: VoiceProvider) =>
  provider === "openai"
    ? settings.keys.openai
    : provider === "google"
      ? settings.keys.gemini
      : settings.keys.xai;

const session = useVoiceSession({
  getProvider: () => settings.voiceProvider,
  getApiKey: keyOf,
  getModelId: (provider) => settings.voiceModel[provider],
  buildInstructions,
  buildTools: () => pluginTools(),
});

const {
  chatActive,
  connecting,
  conversationActive,
  isMuted,
  sendFunctionCallOutput,
  sendInstructions,
  sendUserText,
  isConnected,
} = session;

const {
  results,
  selectedIndex,
  selectedResult,
  runningMessage,
  handleToolCall,
  updateResult,
  select,
} = useToolResults({ sendFunctionCallOutput, sendInstructions, isConnected });

setImageSettingsSource(() => ({
  backend: settings.imageBackend,
  geminiKey: settings.keys.gemini,
  openaiKey: settings.keys.openai,
}));

const settingsOpen = ref(false);
const errorMessage = ref("");
const isAudioPlaying = ref(false);
const userSpeaking = ref(false);
const caption = ref("");
let captionDone = false;

const errorText = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
    if (error instanceof Event) return "The connection failed.";
    return JSON.stringify(error);
  }
  return String(error);
};

session.registerEventHandlers({
  onToolCall: (msg, __id, argStr) => handleToolCall(msg, argStr),
  onSpeechStarted: () => (userSpeaking.value = true),
  onSpeechStopped: () => (userSpeaking.value = false),
  onAudioPlaybackStarted: () => (isAudioPlaying.value = true),
  onAudioPlaybackStopped: () => (isAudioPlaying.value = false),
  onTranscriptDelta: (delta) => {
    // A new reply replaces the previous caption.
    if (captionDone) {
      caption.value = "";
      captionDone = false;
    }
    caption.value += delta;
  },
  onTranscriptDone: () => (captionDone = true),
  onError: (error) => {
    console.error("[voice]", error);
    errorMessage.value = errorText(error);
  },
});

const status = computed(() => {
  if (connecting.value) return "Connecting…";
  if (!chatActive.value) return "Not connected";
  if (isMuted.value) return "Muted";
  if (userSpeaking.value) return "Listening…";
  if (isAudioPlaying.value) return "Speaking";
  if (conversationActive.value) return "Thinking…";
  return "Listening";
});

const selectedView = computed(() => {
  const name = selectedResult.value?.toolName;
  return name ? (getToolPlugin(name)?.viewComponent ?? null) : null;
});

function setMute(muted: boolean) {
  session.setMute(muted);
}

async function toggleChat() {
  errorMessage.value = "";
  if (chatActive.value || connecting.value) {
    session.stopChat();
    return;
  }
  caption.value = "";
  await session.startChat();
}

// Views (a quiz answer, a game move) talk to the model as the user.
function sendTextFromView(text?: string) {
  if (text) sendUserText(text);
}

// A provider change stops the previous provider's session.
watch(
  () => settings.voiceProvider,
  (__next, previous) => session.stopChatFor(previous),
);

watch(
  () => settings.language,
  (language) => setPluginLocale(language),
  { immediate: true },
);

const remoteAudio = ref<HTMLAudioElement | null>(null);
onMounted(() => session.attachRemoteAudioElement(remoteAudio.value));
</script>
