# CLAUDE.md — MulmoGlass

Working notes for AI coding agents in this repo: the rules, and the traps that typecheck, lint and
CI do not catch. What MulmoGlass is and how to run it is in `README.md`.

MulmoGlass is a voice-only, server-less offshoot of MulmoChat (`../chat`) for VR glasses (Horizon
OS: the Quest browser now, Meta VR Glasses from 2027). It is a Vite + Vue 3 PWA built on the same
[gui-chat-protocol](https://github.com/receptron/gui-chat-protocol) plugin packages. The user talks;
tool results fill the screen.

## Commands

- `yarn dev` — Vite dev server (no backend; there is nothing else to start).
- `yarn typecheck` (`vue-tsc --noEmit`), `yarn lint`, `yarn format`, `yarn knip` (dead code, report-only).
- `yarn build` is safe here (`dist/` is gitignored), and CI runs it.

There is no unit test suite. CI (`.github/workflows/pull_request.yaml`: typecheck, lint, build on
Node 22/24 × ubuntu/windows/macos, plus the jscpd and knip scans) is the safety net. Keep
`.gitattributes` (`* text=auto eol=lf`): without it the Windows runners check out CRLF and prettier
fails lint on every line (it did, on PR #1).

**Test voice end to end, not just the build.** Headless Chrome with
`--use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<wav>` plays a WAV as the
microphone; macOS `say -o prompt.aiff "…"` plus a long tail of silence makes the WAV (Chrome loops
the file). Seed the keys into `localStorage` before load, click Connect, then read the status and
caption (`data-testid="status"`, `"caption"`). This is how every plugin here was verified. Stop
editing files while a run is going: Vite reloads the page on save, and the run fails with a
"detached frame" that looks like an app bug.

## There is no server, and there must not be one

This is the invariant everything else follows from. Do not add a server, a proxy, a serverless
function or any hosted service of ours, even a small one.

- **The user brings their own keys** (Settings → `localStorage`, `mulmoglass_settings_v1`), and each
  key goes only to its own provider.
- **The app talks to the providers directly.** That only works because their endpoints allow
  browser calls: OpenAI's and xAI's `/v1/realtime/client_secrets`, Gemini Live's WebSocket, Gemini's
  `generateContent`, and OpenAI's and xAI's `/v1/images/generations` (each checked with a CORS preflight; the
  OpenAI image path has not run end to end yet). Before adding a provider call, check its
  CORS with a preflight (`curl -X OPTIONS -H "Origin: https://example.com" …`); a provider that
  blocks browsers can't be used here, and a proxy is not the fix.
- **Plugins run in the page**, with their files in the Origin Private File System (`src/host/`).
- So a feature that needs a server, a headless browser or ffmpeg doesn't belong here: web browsing,
  search, PDF export, renderShapeScript, MulmoScript movies. Leave it out rather than half-port it.

## MulmoChat is the parent; MulmoClaude is the reference host

Most of this code was ported from MulmoChat (transports, plugin runtime, the `server/plugins/*Host.ts`
bindings, now in `src/host/`). When fixing a bug in ported code, check whether MulmoChat has the same
bug, and say so in the PR.

For the `@mulmoclaude/*` packages (markdown, html, shapescript, chart), **MulmoClaude
(`../mulmoclaude`) is the reference host**: match its wire shapes, which failures throw and which are
fields on a result, and its user-facing wording, before inventing ours. `typecheck` can't see a
divergence: we own both the host binding and the call site, so a mismatch is self-consistent and
works.

Deliberate divergences, each commented at its site:

- **Files live in OPFS** under `workspace/artifacts/…`, not on disk; paths stay inside it (no
  absolute paths, no `files.byPath`).
- **presentHtml pages** reach the View through a shell page, not an `/artifacts/html/` route (next
  section). packHtml builds its zip in the browser.
- **presentDocument has no PDF export** (its button shows an error) and no Marp themes.

## presentHtml pages: why the shell exists

The html package's View loads `data.previewUrl` (else a server path) in an iframe with
`sandbox="allow-scripts"`, and appends `?v=<n>` to the URL when the file changes. Three things were
tried; only the third works:

1. **A service worker serving `/artifacts/html/*` from OPFS** — Chrome doesn't route a sandboxed
   iframe's navigation (no `allow-same-origin`) through a service worker, so the iframe got the SPA's
   `index.html`. Verified, and why `public/sw.js` is a pass-through now.
2. **A `data:` or `blob:` URL** — the View's `?v=` breaks both.
3. **A static shell, `public/html-frame.html?path=…`** — it asks the app for its page by postMessage
   (`src/host/htmlFrames.ts` answers only this app's own iframes, only for html artifacts, read fresh
   from OPFS, so edits show), then `document.write`s it. The shell's `<meta>` CSP survives the write:
   verified that `fetch` is blocked and `localStorage` throws inside the page.

Keep it that way: the page is model-written, and the API keys are in this origin's `localStorage`.

## Where the boundaries are

No server means every boundary is in the browser, and the thing to protect is the keys in
`localStorage`: any script running in the app's origin can read them.

| What | Enforced by |
|---|---|
| Model-written HTML can't reach the keys or the network | the View's `sandbox="allow-scripts"` (opaque origin) plus the shell's CSP (`connect-src 'none'`, CDN allowlist) |
| Who gets a page's HTML | `htmlFrames.ts`: the message source must be one of our iframes, the path an html artifact |
| Plugin files stay inside their root | `opfsFileOps.ts` refuses absolute paths, `.`, `..` and empty segments (OPFS has no symlinks) |
| A View's dispatch gets plain data | `pluginRuntime.ts` round-trips results through JSON, as over HTTP |
| `openUrl` | http(s) only |

Anything that runs code from a model or a web page in the app's origin (an unsandboxed iframe, `v-html`
of model output, `eval`) breaks the first row. Don't.

## One value, one definition

Define a shared value once. The copies that exist are debt, not precedent:

- the CDN allowlist: `public/html-frame.html` (a static file, so it can't import) and
  `PRESENT_HTML_PROMPT` in `src/tools/index.ts`
- the voice and image model lists (`src/config/models.ts`), copied from MulmoChat

## The three transports differ; the interface hides it

`VoiceSession` (`src/voice/types.ts`) is one interface over three APIs that answer it differently:

| | OpenAI Realtime | Gemini Live | Grok Voice |
|---|---|---|---|
| Connection | WebRTC, ephemeral key minted in the browser | WebSocket, the raw Gemini key in the URL | WebSocket, client secret as the `xai-client-secret.<secret>` subprotocol |
| Follow-up instructions | `response.create` with `instructions` appended to the session's (alone, they would replace the system prompt and the user's language for that reply) | a user turn | a user message + `response.create` (its `instructions` would replace the system prompt) |
| Overlapping replies | held until `response.done`, once (else `conversation_already_has_active_response`, seen in testing); each request is settled only by its own `event_id` / `metadata.request_id`, since the server starts responses of its own | n/a | held until `response.done`, once |
| Captions | `response.output_audio_transcript.*` | `outputAudioTranscription` | `response.output_audio_transcript.*` |
| Speech started/stopped | yes | no events of its own: started when the first `inputTranscription` of a turn arrives (after the user began), stopped when the model's turn starts | yes |
| Stop during connect / stale socket close | guarded | **not guarded** (known gap, as in MulmoChat) | guarded |

`sendUserText` exists only for Views (a quiz answer, a game move). The user never types.

Per-provider tables are `Record<VoiceProvider, …>` (`useVoiceSession.ts`), so a fourth provider is a
type error in the places that must handle it. The places that aren't: `SettingsPanel.vue`,
`App.vue`'s `keyOf`, `useSettings.ts`'s `load()` and `ApiKeys`.

## Deliberate behaviour — don't "fix" it

- **Voice only.** No text input, no chat history pane, no text transport.
- **No roles.** One system prompt (`BASE_PROMPT` in `App.vue`), and every plugin is always on.
- **Results are in memory.** They're lost when the app closes; the files stay in OPFS.
- **The service worker does nothing but exist**, for installability (see the presentHtml section).
- **A plugin's follow-up instructions are always sent.** MulmoChat's "suppress instructions" setting
  doesn't apply to a voice-only app.

## Plugins

Add a gui-chat-protocol package to `package.json` and `registeredPlugins` in `src/tools/index.ts`,
then test it by voice (above). A plugin whose `execute()` needs host backends gets them in
`src/host/pluginHost.ts` (`createAppContext`, `DISPATCH_HANDLERS`). Code copied from MulmoChat or
MulmoTerminal keeps its attribution comment.

**Read a plugin's `systemPrompt` before registering it.** It goes into the voice model's
instructions verbatim, and a prompt written for a text chat can misfire here. generateImage's says
the model MUST draw whenever it talks about places, objects or people; together with a base prompt
that said "present things visually", asking for Tokyo's weather produced an illustration of Tokyo
instead of a forecast. MulmoGlass overrides it (`GENERATE_IMAGE_PROMPT`), and the base prompt now
says to use a tool only when it answers the request and never to make up facts it doesn't have.
When a question needs live data (weather, news, prices), give the model a tool that has it (the
weather plugin, JMA, Japan only) rather than expecting it to decline.

A tool result's `instructions` decide whether the model keeps going, and even good ones are not
always followed. Slideshows are `presentSlide` calls (`src/tools/presentSlide.ts`, one generated
picture per slide, with the slide number and total as arguments), each telling the model to explain
the slide and call the next one in the same reply. The model still ended replies mid-slideshow
(about one run in three with generateImage and "Slide N of M" prompts), so `useSlideshow` asks it
once per slide to go on when a reply ends, nothing plays or runs, and slides are left; the user
speaking stops that. A slide asked for before the user spoke gets instructions to answer them first
instead of its own "go on" (Gemini and Grok otherwise said "I've stopped" and carried on). Gemini
Live sometimes called the next slide twice (once in the reply it starts after a tool output, once in
the one the instructions start); an identical call within a minute is dropped, after waiting for the
first to be made.

Gemini's image model answers some prompts with text and no image (one call in three for a prompt
that reads like a question, such as a slide about ATP's structure) unless the request sets
`responseModalities: ["IMAGE"]` (`src/host/imageGeneration.ts`). Even then, a prompt that opens with a
question ("What is Photosynthesis?. A bright, sunny day…", presentSlide's title then its prompt)
got no image (finish reason `NO_IMAGE`) 4 times in 12; `A presentation slide titled "…". …` got 0.

Every generated image is saved to `artifacts/images/<YYYY>/<MM>/<id>.<ext>` in OPFS, as MulmoClaude
saves its images, and the tool result tells the model the path ("saved to …"), so a later call can
refer to it. The result keeps the data URL as well: without a server, a workspace path is not
something an `<img>` can load, so anything that shows a saved image by path must read it from OPFS.

An image failure's reason goes to the model, which repeats it to the user, so it is one accurate
sentence: the API's own error message with a hint by status, "refused under its content policy" for
Gemini's refusal finish reasons, or the start of a text-only answer. The raw response made the model
invent a reason ("the prompt was too long"). OpenAI's 401 for a wrong key carries no CORS header, so
the browser sees a network error; that reason names both.

## Debugging

Every tool call is logged to the console: `[tool] call <name> <args>`, `[tool] result <name>
<ms, message, instructions, jsonData>`, `[tool] failed …`, and `[view] message …` for what a View
sends the model. On a Quest, read them with remote devtools (`chrome://inspect` over `adb`).
