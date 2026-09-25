// The gui-chat-protocol BrowserPluginRuntime that MulmoGlass provides to plugin
// views under PLUGIN_RUNTIME_KEY, so components can call useRuntime().
// Adapted from MulmoChat's src/tools/pluginRuntime.ts, which is adapted from
// MulmoTerminal's src/composables/pluginRuntime.ts
// (https://github.com/receptron/mulmoterminal, MIT License, Copyright (c) 2026
// Receptron).
//
// MulmoGlass has no server, so:
//   - dispatch → the in-page plugin host (src/host/pluginHost.ts) instead of
//                POST /api/plugin/<toolName>
//   - pubsub   → an in-page bus. `file:<path>` events are for files a plugin
//                wrote (publishFileChange), shared by all plugins; other
//                events are per tool.
//   - locale   → the user's language setting (setPluginLocale)
//   - openUrl  → http(s) only, in a new tab
//   - log      → console, tagged with the tool name
import {
  defineComponent,
  h,
  markRaw,
  provide,
  ref,
  type Component,
  type Ref,
} from "vue";
import {
  PLUGIN_RUNTIME_KEY,
  type BrowserPluginRuntime,
  type SubscribeOptions,
} from "gui-chat-protocol/vue";

// Plugins key their message tables by locale tag (en, ja, pt-BR, …).
const LOCALE_TAGS: Readonly<Record<string, string>> = { pt: "pt-BR" };

const pluginLocale: Ref<string> = ref("en");

/** Set the locale every plugin view reads (a language code). */
export function setPluginLocale(languageCode: string): void {
  pluginLocale.value = LOCALE_TAGS[languageCode] ?? languageCode;
}

type DispatchHandler = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

let dispatchHandler: DispatchHandler = async (toolName, __args) => {
  throw new Error(`no plugin host for ${toolName}`);
};

/** Route every View's dispatch to the plugin host. */
export function setPluginDispatchHandler(handler: DispatchHandler): void {
  dispatchHandler = handler;
}

const isOpenableUrl = (url: string): boolean => {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

function makeDispatch(toolName: string): BrowserPluginRuntime["dispatch"] {
  async function dispatch(args: object): Promise<unknown>;
  async function dispatch<T>(
    args: object,
    parse: (raw: unknown) => T,
  ): Promise<T>;
  async function dispatch<T>(args: object, parse?: (raw: unknown) => T) {
    // A round trip through JSON, as over HTTP: Views get plain data, and a
    // handler can't hand them live objects.
    const raw: unknown = JSON.parse(
      JSON.stringify(
        (await dispatchHandler(
          toolName,
          (args ?? {}) as Record<string, unknown>,
        )) ?? null,
      ),
    );
    return parse ? parse(raw) : raw;
  }
  return dispatch;
}

type PluginSubscribe = BrowserPluginRuntime["pubsub"]["subscribe"];

const channels = new Map<string, Set<(payload: unknown) => void>>();

// One failing subscriber (e.g. a `parse` that throws) must not stop the rest.
function publish(channel: string, payload: unknown): void {
  for (const handler of channels.get(channel) ?? []) {
    try {
      handler(payload);
    } catch (error) {
      console.warn(`[plugin] subscriber to ${channel} failed`, error);
    }
  }
}

// A file-change event is about the file, not about the plugin that wrote it
// (a document can be open in two Views), so every plugin shares it.
const isFileEvent = (eventName: string): boolean =>
  eventName.startsWith("file:");

const pluginChannel = (toolName: string, eventName: string): string =>
  `plugin:${toolName}:${eventName}`;

/** Tell open Views that this file (e.g. `artifacts/charts/…`) changed. */
export function publishFileChange(filePath: string): void {
  publish(`file:${filePath}`, { mtimeMs: Date.now() });
}

function makeSubscribe(toolName: string): PluginSubscribe {
  function subscribe(
    eventName: string,
    handler: (payload: unknown) => void,
  ): () => void;
  function subscribe<T>(
    eventName: string,
    opts: SubscribeOptions<T>,
    handler: (payload: T) => void,
  ): () => void;
  function subscribe<T>(
    eventName: string,
    ...rest:
      | [handler: (payload: unknown) => void]
      | [opts: SubscribeOptions<T>, handler: (payload: T) => void]
  ): () => void {
    let listener: (payload: unknown) => void;
    if (rest.length === 1) {
      listener = rest[0];
    } else {
      const [opts, handler] = rest;
      listener = (raw) => {
        const payload = opts.parse(raw);
        if (payload !== null) handler(payload);
      };
    }
    const channel = isFileEvent(eventName)
      ? eventName
      : pluginChannel(toolName, eventName);
    const handlers = channels.get(channel) ?? new Set();
    handlers.add(listener);
    channels.set(channel, handlers);
    return () => handlers.delete(listener);
  }
  return subscribe;
}

function makeBrowserPluginRuntime(toolName: string): BrowserPluginRuntime {
  const tag = `[plugin/${toolName}]`;
  return {
    pubsub: { subscribe: makeSubscribe(toolName) },
    locale: pluginLocale,
    log: {
      debug: (msg, data) => console.debug(tag, msg, data),
      info: (msg, data) => console.info(tag, msg, data),
      warn: (msg, data) => console.warn(tag, msg, data),
      error: (msg, data) => console.error(tag, msg, data),
    },
    openUrl: (url) => {
      if (!isOpenableUrl(url)) {
        console.warn(tag, "openUrl rejected a non-http(s) URL", { url });
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    },
    dispatch: makeDispatch(toolName),
  };
}

/** Wrap a plugin component so it (and its children) can call useRuntime(). */
export function wrapWithPluginRuntime(
  toolName: string,
  inner: Component,
): Component {
  return markRaw(
    defineComponent({
      name: `PluginRuntimeScope:${toolName}`,
      inheritAttrs: false,
      setup(_props, { attrs, slots }) {
        provide(PLUGIN_RUNTIME_KEY, makeBrowserPluginRuntime(toolName));
        return () => h(inner, attrs, slots);
      },
    }),
  );
}
