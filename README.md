# MulmoGlass

A voice assistant for VR glasses (Meta's Horizon OS: the Quest browser now, Meta VR Glasses when they ship) that shows its answers: images, documents, charts, HTML pages, 3D models, quizzes, forms, spreadsheets, mind maps and board games.

It is a voice-only offshoot of [MulmoChat](https://github.com/receptron/MulmoChat), built on the same [gui-chat-protocol](https://github.com/receptron/gui-chat-protocol) plugins.

## No server

MulmoGlass is a set of static files (a PWA). Nothing of ours runs anywhere:

- **Your own keys.** You enter an OpenAI, Gemini and/or xAI key in Settings. They are stored on the device only (localStorage) and sent only to their provider.
- **Voice straight to the provider.** OpenAI Realtime (WebRTC), Gemini Live (WebSocket) and Grok Voice (WebSocket). The app mints the OpenAI and xAI voice tokens itself; both token endpoints allow browser calls.
- **Plugins run in the page.** The plugins that MulmoChat runs on its server (presentDocument, presentChart, presentHtml, presentShapeScript, generateImage) run here, with the same package code. Their files live in the browser's Origin Private File System, and images come straight from Gemini's or OpenAI's API.

Not included, because they need a server or a headless browser: web browsing, search, PDF export, renderShapeScript and MulmoScript movies.

## Development

```sh
yarn install
yarn dev        # http://localhost:5173
yarn typecheck
yarn lint
```

The microphone needs a secure context: `localhost` works, and so does HTTPS. To try it in a headset, serve it over HTTPS (or open it on `localhost` on the device).

## License

AGPL-3.0-only, like MulmoChat. Parts are adapted from MulmoTerminal (MIT License, Copyright (c) 2026 Receptron); those files say so.
