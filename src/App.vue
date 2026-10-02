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
      <!-- First launch (no key at all): explain why keys are needed before
           asking for one. -->
      <div
        v-else-if="noKeys && !chatActive"
        class="h-full w-full overflow-y-auto flex flex-col items-center justify-center gap-6 px-8 py-8 text-center"
        data-testid="welcome"
      >
        <span class="material-icons text-sky-400" style="font-size: 96px"
          >view_in_ar</span
        >
        <h1 class="text-4xl font-semibold">Welcome to MulmoGlass</h1>
        <p class="text-xl text-slate-300 max-w-3xl">
          Talk to an AI that shows its answers in front of you: images,
          documents, charts, web pages and 3D models.
        </p>
        <p class="text-xl text-slate-300 max-w-3xl">
          MulmoGlass runs on
          <strong class="text-slate-100">your own API keys</strong>. To use it,
          add at least one key in Settings. Your keys stay on this device and
          are sent only to the provider they belong to; you pay that provider
          directly for what you use.
        </p>
        <ul class="text-lg text-left flex flex-col gap-2">
          <li v-for="(use, name) in KEY_USES" :key="name" class="flex gap-3">
            <span class="material-icons text-amber-400">key</span>
            <span
              ><strong>{{ API_KEYS[name].label }}</strong> — {{ use }}</span
            >
          </li>
        </ul>
        <button
          class="h-16 px-10 rounded-full bg-sky-600 hover:bg-sky-500 text-xl flex items-center gap-3"
          @click="openSettings(VOICE_KEY[settings.voiceProvider])"
        >
          <span class="material-icons" style="font-size: 32px">settings</span>
          Open Settings
        </button>
      </div>
      <!-- No key for the selected voice: say which, and where to put it. -->
      <div
        v-else-if="missingKey && !chatActive"
        class="h-full w-full flex flex-col items-center justify-center gap-6 px-8 text-center"
        data-testid="key-guide"
      >
        <span class="material-icons text-amber-400" style="font-size: 96px"
          >key</span
        >
        <h1 class="text-3xl font-semibold">
          Add your {{ API_KEYS[missingKey].label }} API key to start
        </h1>
        <p class="text-xl text-slate-300 max-w-2xl">
          {{ voiceLabel }} needs your own {{ API_KEYS[missingKey].label }} key.
          It stays on this device and is sent only to
          {{ API_KEYS[missingKey].label }}.
        </p>
        <div class="flex flex-wrap items-center justify-center gap-4">
          <button
            class="h-16 px-8 rounded-full bg-sky-600 hover:bg-sky-500 text-xl flex items-center gap-3"
            @click="openSettings(missingKey)"
          >
            <span class="material-icons" style="font-size: 32px">settings</span>
            Open Settings
          </button>
          <a
            :href="API_KEYS[missingKey].consoleUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="h-16 px-8 rounded-full bg-slate-800 hover:bg-slate-700 text-xl flex items-center gap-3"
          >
            Get a key
            <span class="material-icons">open_in_new</span>
          </a>
        </div>
        <p class="text-lg text-slate-400">Or pick another voice in Settings.</p>
      </div>
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

      <!-- Small, in a corner: a slide or a panel is often being drawn while
           the one on the screen is explained. -->
      <div
        v-if="runningMessage"
        class="absolute bottom-3 right-3 rounded-full bg-slate-800/70 px-3 py-1 text-sm text-slate-300 flex items-center gap-1.5 pointer-events-none"
        data-testid="running"
      >
        <span class="material-icons animate-spin text-base!">autorenew</span>
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
      @open-settings="openSettings()"
      :send-text="sendTypedText"
    />

    <SettingsPanel
      v-if="settingsOpen"
      :locked="chatActive || connecting"
      :focus-key="settingsFocusKey"
      @close="settingsOpen = false"
    />

    <audio ref="remoteAudio" autoplay></audio>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import ControlBar from "./components/ControlBar.vue";
import SettingsPanel from "./components/SettingsPanel.vue";
import {
  hasNoKeys,
  missingVoiceKey,
  useSettings,
} from "./composables/useSettings";
import { useToolResults } from "./composables/useToolResults";
import { createSequenceKeeper } from "gui-chat-protocol";
import { useVoiceSession } from "./voice/useVoiceSession";
import {
  getToolPlugin,
  pluginSystemPrompts,
  pluginTools,
  setPluginLocale,
} from "./tools";
import { setImageSettingsSource } from "./host/pluginHost";
import { getLanguageName } from "./config/languages";
import {
  API_KEYS,
  VOICE_KEY,
  VOICE_MODELS,
  type ApiKeyName,
  type VoiceProvider,
} from "./config/models";

const settings = useSettings();

// Tools are for answering the request, not for decorating it: an earlier
// "present things visually" rule, together with generateImage's own "MUST draw
// places" prompt, made the model paint a picture of "Tokyo's weather" when
// asked for the forecast.
const BASE_PROMPT =
  "You are MulmoGlass, a voice assistant running on the user's VR glasses. The user talks to you; they can't type. Tool results appear on a large screen in front of them. Whenever the user asks you to explain or describe something, to walk them through it, or for a commentary on it (説明して, 解説して; a topic, an idea, a condition and its treatment, a formula, a process, data, news), answer with a slideshow: call presentSlide for slide 1 right away, then explain each slide as it appears (a chart slide for numbers, a Markdown slide for equations and short lists, a picture for a scene). Don't answer such a request in words alone or with a document: this rule comes before the tool descriptions below, and presentSlide is for any explanation, not only when the user says \"slides\". Answer in words alone only when the question takes a sentence or two. Otherwise, use a tool when it answers the request (a chart for data, a document when the user asks for one to keep, the weather tool for a forecast), not just to put something on the screen. Never make up facts you don't have, such as live weather, news or prices: use a tool that provides them, or say you can't check. Keep your spoken replies short.";

const buildInstructions = () =>
  `${BASE_PROMPT}\n${pluginSystemPrompts()}\nThe user's native language is ${getLanguageName(settings.language)}.`;

const keyOf = (provider: VoiceProvider) => settings.keys[VOICE_KEY[provider]];

// First launch: no key at all. The welcome screen explains keys first.
const noKeys = computed(() => hasNoKeys(settings));

// What each key unlocks, for the welcome screen.
const KEY_USES: Record<ApiKeyName, string> = {
  openai: "voice (OpenAI Realtime) and images",
  gemini: "voice (Gemini Live) and images",
  xai: "voice (Grok) and images",
};

// The key the selected voice still needs (null when it is set).
const missingKey = computed(() => missingVoiceKey(settings));
const voiceLabel = computed(() => VOICE_MODELS[settings.voiceProvider].label);

const session = useVoiceSession({
  getProvider: () => settings.voiceProvider,
  getApiKey: keyOf,
  getModelId: (provider) => VOICE_MODELS[provider].model,
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
} = useToolResults({
  sendFunctionCallOutput,
  sendInstructions,
  isConnected,
  onResult: (result, startedAt) => sequence.observe(result, startedAt),
  getUserSpokeAt: () => sequence.userSpokeAt(),
  waitForSpeechEnd,
});

// Keeps a slideshow or a story going (gui-chat-protocol's sequence keeper):
// asks the model once to go on when it ends a reply mid-sequence. The
// results say where the sequence is (ToolResult.sequence), and the user
// speaking stops it.
const sequence = createSequenceKeeper({
  isIdle: () =>
    chatActive.value &&
    !conversationActive.value &&
    !isAudioPlaying.value &&
    !userSpeaking.value &&
    !runningMessage.value,
  sendInstructions,
  log: (message) => console.info(`[sequence] ${message}`),
});

setImageSettingsSource(() => ({
  backend: settings.imageBackend,
  geminiKey: settings.keys.gemini,
  openaiKey: settings.keys.openai,
  xaiKey: settings.keys.xai,
}));

const settingsOpen = ref(false);
const settingsFocusKey = ref<ApiKeyName | null>(null);

function openSettings(focusKey: ApiKeyName | null = null) {
  settingsFocusKey.value = focusKey;
  settingsOpen.value = true;
}
const errorMessage = ref("");
const isAudioPlaying = ref(false);

// The longest a sequence step waits for the model's voice to finish: a
// playback-stopped event that never comes must not hold the step forever.
const SPEECH_WAIT_MAX_MS = 120_000;
// How long playback must stay stopped to count as the end of the voice. The
// audio queue can run dry for a moment while a reply's audio is still
// arriving (seen with Grok: stopped and started again within a second),
// which would otherwise release a step mid-explanation.
const SPEECH_END_QUIET_MS = 800;

// How long a step queued behind another waits, once that one is shown, for
// the model to start explaining it; past that the step is shown.
const SPEECH_START_WAIT_MS = 6_000;

// The step being held, when one is: a step asked for meanwhile waits for it.
let heldStep: Promise<boolean> | null = null;

/** Resolves when the model's voice has finished playing (stopped for
 *  SPEECH_END_QUIET_MS) or SPEECH_WAIT_MAX_MS has passed: true; or when the
 *  chat ended while waiting: false, so the step isn't shown after Stop. A
 *  chat that isn't active (text chat) doesn't wait.
 *
 *  One step at a time. A held step's result hasn't reached the model, so it
 *  may ask for the next step meanwhile (in MulmoChat, Grok asked for slide 3
 *  six seconds after slide 2); both would then appear the moment the voice
 *  stopped, and slide 2 would be replaced at once. A step asked for while
 *  another is held waits until that one is shown, then for the model to
 *  explain it: its voice to start (at most SPEECH_START_WAIT_MS) and end.
 *  The same as MulmoChat's HomeView. */
function waitForSpeechEnd(): Promise<boolean> {
  if (!chatActive.value) return Promise.resolve(true);
  const before = heldStep;
  const mine: Promise<boolean> = (async () => {
    if (before) {
      console.info("[sequence] step queued behind the one held");
      if (!(await before)) return false;
      if (!(await waitForSpeechStart())) return false;
    }
    return waitForQuiet();
  })();
  heldStep = mine;
  void mine.finally(() => {
    if (heldStep === mine) heldStep = null;
  });
  return mine;
}

/** Resolves when the model's voice starts playing, or after
 *  SPEECH_START_WAIT_MS without it: true; when the chat ends first: false. */
function waitForSpeechStart(): Promise<boolean> {
  if (!chatActive.value) return Promise.resolve(false);
  if (isAudioPlaying.value) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (goOn: boolean) => {
      stopWatching();
      clearTimeout(limit);
      resolve(goOn);
    };
    const limit = setTimeout(() => done(true), SPEECH_START_WAIT_MS);
    const stopWatching = watch([isAudioPlaying, chatActive], () => {
      if (!chatActive.value) done(false);
      else if (isAudioPlaying.value) done(true);
    });
  });
}

/** The wait for the voice to stop (see waitForSpeechEnd). */
function waitForQuiet(): Promise<boolean> {
  if (!chatActive.value) return Promise.resolve(false);
  const started = Date.now();
  return new Promise((resolve) => {
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const done = (why: string, goOn = true) => {
      stopWatching();
      clearTimeout(limit);
      clearTimeout(quiet);
      const waited = Date.now() - started;
      if (waited > SPEECH_END_QUIET_MS) {
        console.info(
          `[sequence] step ${goOn ? "shown" : "dropped"} after ${waited} ms (${why})`,
        );
      }
      resolve(goOn);
    };
    const check = () => {
      clearTimeout(quiet);
      quiet = undefined;
      if (!chatActive.value) return done("chat ended", false);
      if (!isAudioPlaying.value) {
        quiet = setTimeout(() => done("voice ended"), SPEECH_END_QUIET_MS);
      }
    };
    const limit = setTimeout(() => done("waited too long"), SPEECH_WAIT_MAX_MS);
    const stopWatching = watch([isAudioPlaying, chatActive], check);
    check();
  });
}
const userSpeaking = ref(false);
// A session that ends mid-reply (stopped, dropped) may send no
// playback-stopped event (OpenAI's stopChat doesn't), and a stale
// isAudioPlaying would hold every sequence step of the next session for
// SPEECH_WAIT_MAX_MS. The same as MulmoChat's HomeView.
watch(chatActive, (active) => {
  if (active) return;
  userSpeaking.value = false;
  isAudioPlaying.value = false;
});
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
  onSpeechStarted: () => {
    userSpeaking.value = true;
    sequence.userSpoke();
  },
  onConversationFinished: () => sequence.replyEnded(),
  onSpeechStopped: () => (userSpeaking.value = false),
  onAudioPlaybackStarted: () => (isAudioPlaying.value = true),
  onAudioPlaybackStopped: () => {
    isAudioPlaying.value = false;
    sequence.replyEnded();
  },
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
  if (!chatActive.value) {
    if (noKeys.value) return "Add an API key in Settings to start";
    return missingKey.value
      ? `Add your ${API_KEYS[missingKey.value].label} key in Settings to start`
      : "Not connected";
  }
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
    sequence.stop();
    session.stopChat();
    return;
  }
  // Without the key, connecting can only fail: take the user to the field.
  if (missingKey.value) {
    openSettings(missingKey.value);
    return;
  }
  caption.value = "";
  await session.startChat();
}

// Typed in the control bar while muted: the user speaking, so a step that
// waits for them ("next") or a sequence they stop ("stop") hears it.
function sendTypedText(text: string): boolean {
  console.info("[typed] message", text);
  sequence.userSpoke();
  return sendUserText(text);
}

// Views (a quiz answer, a form) talk to the model as the user.
function sendTextFromView(text?: string) {
  if (text) console.info("[view] message", text);
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
onMounted(() => {
  session.attachRemoteAudioElement(remoteAudio.value);
});
</script>
