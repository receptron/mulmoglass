# MulmoGlass

A voice assistant for VR glasses (Meta's Horizon OS: the Quest browser now, Meta VR Glasses when they ship) that shows its answers: images, documents, charts, HTML pages, 3D models, quizzes, forms, spreadsheets, mind maps and board games.

It is a voice-only offshoot of [MulmoChat](https://github.com/receptron/MulmoChat), built on the same [gui-chat-protocol](https://github.com/receptron/gui-chat-protocol) plugins.

## No server

MulmoGlass is a set of static files (a PWA). Nothing of ours runs anywhere:

- **Your own keys.** You enter an OpenAI, Gemini and/or xAI key in Settings. They are stored on the device only (localStorage) and sent only to their provider.
- **Voice straight to the provider.** OpenAI Realtime (WebRTC), Gemini Live (WebSocket) and Grok Voice (WebSocket). The app mints the OpenAI and xAI voice tokens itself; both token endpoints allow browser calls.
- **Plugins run in the page.** The plugins that MulmoChat runs on its server (presentDocument, presentChart, presentHtml, presentShapeScript, generateImage) run here, with the same package code. Their files live in the browser's Origin Private File System, and images come straight from Gemini's, OpenAI's or xAI's (Grok Imagine) API. With Grok for both voice and images, one xAI key runs the whole app.

Not included, because they need a server or a headless browser: web browsing, search, PDF export, renderShapeScript and MulmoScript movies.

## Development

```sh
yarn install
yarn dev        # http://localhost:5173
yarn typecheck
yarn lint
```

The microphone needs a secure context: `localhost` works, and so does HTTPS. To try it in a headset, serve it over HTTPS (or open it on `localhost` on the device).

## Deploy

MulmoGlass is served as static files from Firebase Hosting (project `mulmoglass`):
**https://mulmoglass.web.app**. Hosting serves the built files and nothing else: keys, conversations
and plugin files stay on the device, and every API call goes straight from the device to its
provider.

```sh
yarn deploy     # vite build && firebase deploy --only hosting
```

`firebase.json` sets the headers: `frame-ancestors 'self'` (presentHtml's page shell is framed by the
app itself, so the usual `deny` would break it), `no-cache` for `index.html`, the manifest and
`sw.js`, and long caching for Vite's hashed `assets/`. Its `ignore` deliberately omits Firebase's
default `**/.*`, which would silently drop `.well-known/assetlinks.json` (see below).

The site's origin is also where each user's keys (`localStorage`) and files (OPFS) live, so moving
MulmoGlass to another domain starts every user over.

## Packaging for the Horizon Store

Meta packages web apps as a Trusted Web Activity with its fork of Bubblewrap
([guide](https://developers.meta.com/horizon/documentation/web/pwa-packaging/)): the APK opens the
hosted site, and `/.well-known/assetlinks.json` proves the site and the APK belong together.

```sh
npm install --global @meta-quest/bubblewrap-cli
bubblewrap init --manifest=https://mulmoglass.web.app/manifest.webmanifest --metaquest
#   app mode: 2D; display: standalone; no Horizon Billing; keep the signing key safe
bubblewrap fingerprint add <sha256 from `keytool -list -v -keystore …`>
# put the generated assetlinks.json in public/.well-known/, then `yarn deploy`
bubblewrap build          # → app-release-signed.apk
adb install app-release-signed.apk   # Quest in developer mode; launch from Unknown Sources
```

## License

AGPL-3.0-only, like MulmoChat. Parts are adapted from MulmoTerminal (MIT License, Copyright (c) 2026 Receptron); those files say so.
