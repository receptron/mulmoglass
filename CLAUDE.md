# CLAUDE.md

MulmoGlass is a voice-only, server-less offshoot of MulmoChat (`../chat`) for VR glasses (Horizon OS). It is a Vite + Vue 3 PWA: the user brings their own API keys, and the app talks to the model providers directly. There is no backend and there must not be one: do not add a server, proxy or hosted service.

## Commands

- `yarn dev` — Vite dev server
- `yarn typecheck` — `vue-tsc --noEmit`
- `yarn lint` — eslint (`yarn format` for prettier)

## Layout

- `src/App.vue` — the whole UI: the selected result's View full-size, the control bar (`components/ControlBar.vue`), Settings (`components/SettingsPanel.vue`). No text input and no history pane: the user only talks.
- `src/voice/` — the three voice transports behind one `VoiceSession` interface (`types.ts`), chosen by `useVoiceSession.ts`:
  - `openaiRealtime.ts` — WebRTC; mints its ephemeral key with the user's key (`/v1/realtime/client_secrets`).
  - `geminiLive.ts` — WebSocket with the user's Gemini key; PCM16 through `audio/audioStreamManager.ts`.
  - `grokVoice.ts` — WebSocket; mints an xAI client secret, passed as the `xai-client-secret.<secret>` subprotocol.
  - OpenAI and Grok hold a `response.create` asked for while a response runs and send it after `response.done` (both providers reject overlapping responses). `sendUserText` is only for Views (a quiz answer, a game move).
- `src/composables/` — `useSettings.ts` (keys, provider, model, language, image backend; localStorage) and `useToolResults.ts` (runs tool calls, keeps results, always sends follow-up instructions).
- `src/tools/` — the plugin registry (`index.ts`) and the browser plugin runtime (`pluginRuntime.ts`, adapted from MulmoChat/MulmoTerminal): `useRuntime().dispatch` goes to the in-page host, `pubsub` is local.
- `src/host/` — what MulmoChat's server does, in the page:
  - `opfsFileOps.ts` / `workspace.ts` — gui-chat-protocol `FileOps` over the Origin Private File System (`workspace/artifacts/…`); writes publish `file:<path>` so open Views reload.
  - `pluginHost.ts` — the plugin context (`files.artifacts`, `app.generateImage`, the markdown host) and View dispatch routing (html and shapescript have their own handlers).
  - `imageGeneration.ts` — Gemini / OpenAI image APIs with the user's key.
  - `markdownHost.ts`, `htmlHost.ts` — ports of MulmoChat's server hosts (no PDF export).
  - `htmlFrames.ts` + `public/html-frame.html` — presentHtml pages. The View's iframe is `sandbox="allow-scripts"`, and Chrome doesn't route a sandboxed iframe's navigation through a service worker, so the result's `previewUrl` points at a static shell that asks the app for its page by postMessage. The shell carries MulmoChat's CSP (CDN allowlist, `connect-src 'none'`) as a meta tag.
- `public/sw.js` — a pass-through service worker, for installability only.

## Plugins

Add a gui-chat-protocol package to `package.json` and `registeredPlugins` in `src/tools/index.ts`. A plugin that needs a server, a headless browser or ffmpeg doesn't belong here. Code copied from MulmoChat or MulmoTerminal keeps its attribution comment.
