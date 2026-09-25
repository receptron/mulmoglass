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

      <p v-if="locked" class="rounded-lg bg-slate-800 px-4 py-3 text-slate-300">
        Disconnect to change the voice provider or model.
      </p>

      <label class="flex flex-col gap-2">
        <span class="text-slate-300">Voice</span>
        <select
          v-model="settings.voiceProvider"
          :disabled="locked"
          class="field"
        >
          <option v-for="p in VOICE_PROVIDERS" :key="p.id" :value="p.id">
            {{ p.label }}
          </option>
        </select>
      </label>

      <label class="flex flex-col gap-2">
        <span class="text-slate-300">Model</span>
        <select
          v-model="settings.voiceModel[settings.voiceProvider]"
          :disabled="locked"
          class="field"
        >
          <option
            v-for="m in getVoiceProvider(settings.voiceProvider).models"
            :key="m.id"
            :value="m.id"
          >
            {{ m.label }}
          </option>
        </select>
      </label>

      <label class="flex flex-col gap-2">
        <span class="text-slate-300">Language</span>
        <select v-model="settings.language" class="field">
          <option v-for="l in LANGUAGES" :key="l.code" :value="l.code">
            {{ l.name }}
          </option>
        </select>
      </label>

      <label class="flex flex-col gap-2">
        <span class="text-slate-300">Images</span>
        <select v-model="settings.imageBackend" class="field">
          <option value="gemini">Gemini (Gemini key)</option>
          <option value="openai">OpenAI (OpenAI key)</option>
        </select>
      </label>

      <fieldset class="flex flex-col gap-4">
        <legend class="text-slate-300 mb-2">
          API keys — stored on this device only, and sent only to their
          provider.
        </legend>
        <label class="flex flex-col gap-2">
          <span>OpenAI</span>
          <input
            v-model.trim="settings.keys.openai"
            type="password"
            autocomplete="off"
            placeholder="sk-…"
            class="field"
          />
        </label>
        <label class="flex flex-col gap-2">
          <span>Gemini</span>
          <input
            v-model.trim="settings.keys.gemini"
            type="password"
            autocomplete="off"
            class="field"
          />
        </label>
        <label class="flex flex-col gap-2">
          <span>xAI (Grok)</span>
          <input
            v-model.trim="settings.keys.xai"
            type="password"
            autocomplete="off"
            placeholder="xai-…"
            class="field"
          />
        </label>
      </fieldset>
    </section>
  </div>
</template>

<script setup lang="ts">
import { useSettings } from "../composables/useSettings";
import { LANGUAGES } from "../config/languages";
import { VOICE_PROVIDERS, getVoiceProvider } from "../config/models";

defineProps<{ locked: boolean }>();
defineEmits<{ close: [] }>();

const settings = useSettings();
</script>

<style scoped>
@reference "../index.css";

.field {
  @apply rounded-lg bg-slate-800 border border-slate-700 px-4 py-3 text-lg text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50;
}
</style>
