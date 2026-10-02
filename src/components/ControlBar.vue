<template>
  <!-- Large targets: on the glasses, the user points with gaze and pinch.
       Below `sm` (a phone) the targets are smaller and the status and caption
       take a row of their own, so every button stays on the screen. -->
  <footer
    class="shrink-0 border-t border-slate-800 bg-slate-900 px-3 py-3 sm:px-6 sm:py-4 flex flex-wrap items-center gap-2 sm:gap-5"
  >
    <button
      class="h-14 w-14 sm:h-20 sm:w-20 rounded-full flex items-center justify-center shrink-0 transition-colors"
      :class="
        chatActive
          ? 'bg-red-600 hover:bg-red-500'
          : 'bg-sky-600 hover:bg-sky-500 disabled:opacity-60'
      "
      :aria-label="chatActive ? 'Disconnect' : 'Connect'"
      :disabled="connecting && !chatActive"
      @click="$emit('toggle-chat')"
    >
      <span class="material-icons text-[32px]! sm:text-[44px]!">{{
        chatActive ? "call_end" : connecting ? "hourglass_top" : "mic"
      }}</span>
    </button>

    <button
      v-if="chatActive"
      class="h-12 w-12 sm:h-16 sm:w-16 rounded-full flex items-center justify-center shrink-0 bg-slate-700 hover:bg-slate-600"
      :aria-label="isMuted ? 'Unmute' : 'Mute'"
      @click="$emit('toggle-mute')"
    >
      <span class="material-icons text-[28px]! sm:text-[36px]!">{{
        isMuted ? "mic_off" : "mic_none"
      }}</span>
    </button>

    <!-- With the microphone muted, the user types to the model instead (the
         same as MulmoChat's visual mode). The box lies over the status and
         caption, which stay, hidden, so the bar keeps its height. -->
    <div
      class="order-first basis-full sm:order-none sm:basis-0 flex-1 min-w-0 relative"
    >
      <div :class="{ invisible: typing }">
        <div class="text-base sm:text-lg text-slate-400" data-testid="status">
          {{ status }}
        </div>
        <p
          class="text-lg sm:text-2xl leading-snug line-clamp-2 min-h-[2lh]"
          data-testid="caption"
        >
          {{ caption }}
        </p>
      </div>
      <form
        v-if="typing"
        class="absolute inset-0 flex items-center gap-2 sm:gap-3"
        @submit.prevent="send"
      >
        <input
          ref="textInput"
          v-model="text"
          type="text"
          aria-label="Message"
          placeholder="Muted: type a message"
          class="flex-1 min-w-0 h-12 sm:h-14 rounded-full bg-slate-800 px-5 text-lg sm:text-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
          @keydown.enter="holdWhileComposing"
          @compositionstart="composing = true"
          @compositionend="composing = false"
        />
        <button
          type="submit"
          class="h-12 w-12 sm:h-14 sm:w-14 rounded-full flex items-center justify-center shrink-0 bg-sky-600 hover:bg-sky-500 disabled:opacity-40"
          aria-label="Send"
          :disabled="!text.trim()"
        >
          <span class="material-icons text-[26px]! sm:text-[30px]!">send</span>
        </button>
      </form>
    </div>

    <div v-if="resultCount > 0" class="flex items-center gap-2 shrink-0">
      <button
        class="h-12 w-12 sm:h-16 sm:w-16 rounded-full flex items-center justify-center bg-slate-800 hover:bg-slate-700 disabled:opacity-40"
        aria-label="Previous result"
        :disabled="selectedIndex <= 0"
        @click="$emit('select', selectedIndex - 1)"
      >
        <span class="material-icons text-[28px]! sm:text-[36px]!"
          >chevron_left</span
        >
      </button>
      <span class="text-lg sm:text-xl tabular-nums w-14 sm:w-20 text-center"
        >{{ selectedIndex + 1 }} / {{ resultCount }}</span
      >
      <button
        class="h-12 w-12 sm:h-16 sm:w-16 rounded-full flex items-center justify-center bg-slate-800 hover:bg-slate-700 disabled:opacity-40"
        aria-label="Next result"
        :disabled="selectedIndex >= resultCount - 1"
        @click="$emit('select', selectedIndex + 1)"
      >
        <span class="material-icons text-[28px]! sm:text-[36px]!"
          >chevron_right</span
        >
      </button>
    </div>

    <button
      class="h-12 w-12 sm:h-16 sm:w-16 rounded-full flex items-center justify-center shrink-0 bg-slate-800 hover:bg-slate-700"
      aria-label="Settings"
      @click="$emit('open-settings')"
    >
      <span class="material-icons text-[28px]! sm:text-[36px]!">settings</span>
    </button>
  </footer>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";

const props = defineProps<{
  chatActive: boolean;
  connecting: boolean;
  isMuted: boolean;
  status: string;
  caption: string;
  resultCount: number;
  selectedIndex: number;
}>();

const emit = defineEmits<{
  "toggle-chat": [];
  "toggle-mute": [];
  select: [index: number];
  "open-settings": [];
  "send-text": [text: string];
}>();

const text = ref("");
const textInput = ref<HTMLInputElement | null>(null);
const typing = computed(() => props.chatActive && props.isMuted);
const composing = ref(false);

// Enter that confirms an IME conversion (Japanese kana to kanji) must not
// send the half-typed message. Safari ends the composition before that
// Enter's keydown, which then has isComposing false and keyCode 229.
const IME_KEY_CODE = 229;
function holdWhileComposing(event: KeyboardEvent): void {
  if (event.isComposing || composing.value || event.keyCode === IME_KEY_CODE) {
    event.preventDefault();
  }
}

// The box takes the focus when it appears (the user just muted).
watch(typing, async (shown) => {
  if (!shown) return;
  await nextTick();
  textInput.value?.focus();
});

function send(): void {
  const message = text.value.trim();
  if (!message) return;
  emit("send-text", message);
  text.value = "";
}
</script>
