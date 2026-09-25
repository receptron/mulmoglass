<template>
  <div
    class="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6"
    @click.self="$emit('close')"
  >
    <section
      class="w-full max-w-2xl max-h-full overflow-y-auto rounded-2xl bg-slate-900 p-8 flex flex-col gap-6 text-lg"
      aria-label="Settings"
    >
      <header class="flex items-center justify-between">
        <h2 class="text-3xl font-semibold">Settings</h2>
        <button
          class="h-14 w-14 rounded-full flex items-center justify-center bg-slate-800 hover:bg-slate-700"
          aria-label="Close settings"
          @click="$emit('close')"
        >
          <span class="material-icons" style="font-size: 32px">close</span>
        </button>
      </header>

      <p
        v-if="noKeys"
        class="rounded-lg bg-sky-950 border border-sky-800 px-4 py-3 text-slate-200"
        data-testid="settings-intro"
      >
        MulmoGlass uses your own API keys. Choose a voice and an image service,
        then paste the keys they need below (marked in amber). You can add the
        others later.
      </p>

      <p v-if="locked" class="rounded-lg bg-slate-800 px-4 py-3 text-slate-300">
        Disconnect to change the voice.
      </p>

      <!-- The two choices that decide which keys are needed, side by side. -->
      <div class="grid grid-cols-2 gap-4">
        <label class="flex flex-col gap-2">
          <span class="text-slate-300">Voice</span>
          <select
            v-model="settings.voiceProvider"
            :disabled="locked"
            class="field"
          >
            <option v-for="(m, id) in VOICE_MODELS" :key="id" :value="id">
              {{ m.label }}
            </option>
          </select>
        </label>
        <label class="flex flex-col gap-2">
          <span class="text-slate-300">Images</span>
          <select v-model="settings.imageBackend" class="field">
            <option v-for="(m, id) in IMAGE_MODELS" :key="id" :value="id">
              {{ m.label }}
            </option>
          </select>
        </label>
      </div>

      <!-- Keys come right after those choices: they are what stops a first
           launch. The one the selected voice needs is marked and focused. -->
      <fieldset class="flex flex-col gap-4">
        <legend class="text-slate-300 mb-2">
          API keys — stored on this device only, and sent only to their
          provider.
        </legend>
        <div
          v-for="(info, name) in API_KEYS"
          :key="name"
          class="flex flex-col gap-2 rounded-xl p-3"
          :class="
            needed(name) && !settings.keys[name] ? 'ring-2 ring-amber-400' : ''
          "
        >
          <div class="flex items-center justify-between gap-3">
            <label :for="`key-${name}`" class="flex items-center gap-2">
              {{ info.label }}
              <span
                v-if="needed(name)"
                class="text-sm rounded-full px-2 py-0.5"
                :class="
                  settings.keys[name]
                    ? 'bg-slate-700 text-slate-300'
                    : 'bg-amber-400 text-slate-900'
                "
                :data-testid="`key-needed-${name}`"
                >{{ neededFor(name) }}</span
              >
            </label>
            <a
              :href="info.consoleUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="text-sky-400 hover:text-sky-300 flex items-center gap-1"
            >
              Get a key
              <span class="material-icons text-base">open_in_new</span>
            </a>
          </div>
          <input
            :id="`key-${name}`"
            :ref="(el) => setInputRef(name, el)"
            v-model.trim="settings.keys[name]"
            type="password"
            autocomplete="off"
            :placeholder="info.placeholder"
            class="field"
          />
        </div>
      </fieldset>

      <label class="flex flex-col gap-2">
        <span class="text-slate-300">Language</span>
        <select v-model="settings.language" class="field">
          <option v-for="l in LANGUAGES" :key="l.code" :value="l.code">
            {{ l.name }}
          </option>
        </select>
      </label>

      <button
        class="self-end h-14 px-8 rounded-full bg-sky-600 hover:bg-sky-500 text-xl"
        @click="$emit('close')"
      >
        Done
      </button>
    </section>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted } from "vue";
import { hasNoKeys, useSettings } from "../composables/useSettings";
import { LANGUAGES } from "../config/languages";
import {
  API_KEYS,
  IMAGE_KEY,
  IMAGE_MODELS,
  VOICE_KEY,
  VOICE_MODELS,
  type ApiKeyName,
} from "../config/models";

const props = defineProps<{
  locked: boolean;
  /** A key to focus on open (the one a connect attempt was missing). */
  focusKey?: ApiKeyName | null;
}>();
defineEmits<{ close: [] }>();

const settings = useSettings();
// Only while nothing is set: once a key is typed the note has done its job.
// Read at open, so it doesn't vanish mid-sentence on the first keystroke.
const noKeys = hasNoKeys(settings);

const neededFor = (name: ApiKeyName): string => {
  const uses: string[] = [];
  if (VOICE_KEY[settings.voiceProvider] === name) uses.push("voice");
  if (IMAGE_KEY[settings.imageBackend] === name) uses.push("images");
  return uses.length ? `Needed for ${uses.join(" and ")}` : "";
};
const needed = (name: ApiKeyName): boolean => neededFor(name) !== "";

const inputs: Partial<Record<ApiKeyName, HTMLInputElement>> = {};
const setInputRef = (name: ApiKeyName, el: unknown) => {
  if (el instanceof HTMLInputElement) inputs[name] = el;
};

onMounted(async () => {
  if (!props.focusKey) return;
  await nextTick();
  inputs[props.focusKey]?.focus();
  inputs[props.focusKey]?.scrollIntoView({ block: "nearest" });
});
</script>

<style scoped>
@reference "../index.css";

.field {
  @apply rounded-lg bg-slate-800 border border-slate-700 px-4 py-3 text-lg text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50;
}
</style>
