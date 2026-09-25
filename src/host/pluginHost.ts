// Runs plugin calls in the page. MulmoChat sends the plugins that save files
// to its server (POST /api/plugin/:toolName); MulmoGlass has no server, so the
// same package code runs here, with OPFS as its files and the provider APIs
// called directly for images.
//
// Mirrors MulmoChat's server/routes/plugins.ts and server/plugins/dispatch.ts:
//   - a View's dispatch({ kind, … }) goes to the host's dispatch handler for
//     that tool when there is one, and otherwise to the package's execute();
//   - a tool call from the model goes to the package's execute().
import type {
  FileOps,
  ToolContext,
  ToolContextApp,
  ToolResult,
} from "gui-chat-protocol";
import {
  executeShapeScriptDispatch,
  isShapeScriptDispatchArgs,
} from "@mulmoclaude/shapescript-plugin";
import { artifactsFileOps } from "./workspace";
import { dispatchHtml } from "./htmlHost";
import { createMarkdownHostApp } from "./markdownHost";
import { generateImage, type ImageSettings } from "./imageGeneration";

type Handler = (args: Record<string, unknown>) => Promise<unknown>;

// presentShapeScript's View loads and saves its `.shape` source (loadShape /
// saveShape), kept inside artifacts/shapes/.
async function dispatchShapeScript(
  args: Record<string, unknown>,
): Promise<unknown> {
  if (!isShapeScriptDispatchArgs(args)) {
    throw new Error("unsupported presentShapeScript action");
  }
  return executeShapeScriptDispatch(
    { files: { artifacts: artifactsFileOps } },
    args,
  );
}

const DISPATCH_HANDLERS: Readonly<Record<string, Handler>> = {
  presentHtml: dispatchHtml,
  presentShapeScript: dispatchShapeScript,
};

/** A plugin's execute(), as the host calls it. */
export type PluginExecute = (
  context: ToolContext,
  args: Record<string, unknown>,
) => Promise<ToolResult>;

/** ToolContext plus the files MulmoClaude's packages read (context.files). */
export type HostToolContext = ToolContext & {
  files: { artifacts: FileOps };
};

let imageSettings: () => ImageSettings = () => ({
  backend: "gemini",
  geminiKey: "",
  openaiKey: "",
  xaiKey: "",
});

/** Where the host reads the user's image backend and keys. */
export function setImageSettingsSource(source: () => ImageSettings): void {
  imageSettings = source;
}

function createAppContext(): ToolContextApp {
  const generate = (prompt: string) => generateImage(prompt, imageSettings());
  return {
    getConfig: () => undefined,
    setConfig: () => {},
    generateImage: generate,
    // presentDocument: load/save/create documents and fill images
    ...createMarkdownHostApp(generate),
  };
}

/** The context a plugin's execute() gets, tool call or View dispatch. */
export function createHostContext(
  currentResult?: ToolResult | null,
): HostToolContext {
  return {
    currentResult: currentResult ?? null,
    app: createAppContext(),
    files: { artifacts: artifactsFileOps },
  };
}

/** A View's useRuntime().dispatch(args) for `toolName`. */
export async function dispatchToPlugin(
  toolName: string,
  args: Record<string, unknown>,
  execute: PluginExecute | undefined,
): Promise<unknown> {
  const handler = DISPATCH_HANDLERS[toolName];
  if (handler && typeof args.kind === "string") return handler(args);
  if (!execute) throw new Error(`unknown plugin: ${toolName}`);
  return execute(createHostContext(), args);
}
