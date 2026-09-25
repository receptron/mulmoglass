<template>
  <!-- Large targets: on the glasses, the user points with gaze and pinch. -->
  <footer
    class="shrink-0 border-t border-slate-800 bg-slate-900 px-6 py-4 flex items-center gap-5"
  >
    <button
      class="h-20 w-20 rounded-full flex items-center justify-center shrink-0 transition-colors"
      :class="
        chatActive
          ? 'bg-red-600 hover:bg-red-500'
          : 'bg-sky-600 hover:bg-sky-500 disabled:opacity-60'
      "
      :aria-label="chatActive ? 'Disconnect' : 'Connect'"
      :disabled="connecting && !chatActive"
      @click="$emit('toggle-chat')"
    >
      <span class="material-icons" style="font-size: 44px">{{
        chatActive ? "call_end" : connecting ? "hourglass_top" : "mic"
      }}</span>
    </button>

    <button
      v-if="chatActive"
      class="h-16 w-16 rounded-full flex items-center justify-center shrink-0 bg-slate-700 hover:bg-slate-600"
      :aria-label="isMuted ? 'Unmute' : 'Mute'"
      @click="$emit('toggle-mute')"
    >
      <span class="material-icons" style="font-size: 36px">{{
        isMuted ? "mic_off" : "mic_none"
      }}</span>
    </button>

    <div class="flex-1 min-w-0">
      <div class="text-lg text-slate-400" data-testid="status">
        {{ status }}
      </div>
      <p
        class="text-2xl leading-snug line-clamp-2 min-h-[2lh]"
        data-testid="caption"
      >
        {{ caption }}
      </p>
    </div>

    <div v-if="resultCount > 0" class="flex items-center gap-2 shrink-0">
      <button
        class="h-16 w-16 rounded-full flex items-center justify-center bg-slate-800 hover:bg-slate-700 disabled:opacity-40"
        aria-label="Previous result"
        :disabled="selectedIndex <= 0"
        @click="$emit('select', selectedIndex - 1)"
      >
        <span class="material-icons" style="font-size: 36px">chevron_left</span>
      </button>
      <span class="text-xl tabular-nums w-20 text-center"
        >{{ selectedIndex + 1 }} / {{ resultCount }}</span
      >
      <button
        class="h-16 w-16 rounded-full flex items-center justify-center bg-slate-800 hover:bg-slate-700 disabled:opacity-40"
        aria-label="Next result"
        :disabled="selectedIndex >= resultCount - 1"
        @click="$emit('select', selectedIndex + 1)"
      >
        <span class="material-icons" style="font-size: 36px"
          >chevron_right</span
        >
      </button>
    </div>

    <button
      class="h-16 w-16 rounded-full flex items-center justify-center shrink-0 bg-slate-800 hover:bg-slate-700"
      aria-label="Settings"
      @click="$emit('open-settings')"
    >
      <span class="material-icons" style="font-size: 36px">settings</span>
    </button>
  </footer>
</template>

<script setup lang="ts">
defineProps<{
  chatActive: boolean;
  connecting: boolean;
  isMuted: boolean;
  status: string;
  caption: string;
  resultCount: number;
  selectedIndex: number;
}>();

defineEmits<{
  "toggle-chat": [];
  "toggle-mute": [];
  select: [index: number];
  "open-settings": [];
}>();
</script>
