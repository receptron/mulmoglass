// The plugins MulmoGlass offers the voice model, and how they run.
//
// Every plugin is a gui-chat-protocol package. Their views get the browser
// plugin runtime (useRuntime()); their execute() runs in the page with the
// host context from src/host/pluginHost.ts (OPFS files, direct image APIs).
// Left out, compared with MulmoChat: tools that need a server or a headless
// browser (browse, PDF, renderShapeScript, presentMulmoScript, search), and
// text-chat-only tools.
import type { ToolDefinition, ToolResult } from "gui-chat-protocol/vue";
import { v4 as uuidv4 } from "uuid";

import GenerateImagePlugin from "@mulmochat-plugin/generate-image/vue";
import QuizPlugin from "@mulmochat-plugin/quiz/vue";
import ChartPlugin from "@mulmoclaude/chart-plugin/vue";
import MarkdownPlugin from "@mulmoclaude/markdown-plugin/vue";
import HtmlPlugin from "@mulmoclaude/html-plugin/vue";
import ShapeScriptPlugin from "@mulmoclaude/shapescript-plugin/vue";
import FormPlugin from "@mulmoclaude/form-plugin/vue";
import SpreadsheetPlugin from "@gui-chat-plugin/spreadsheet/vue";
import MindMapPlugin from "@gui-chat-plugin/mindmap/vue";
import { PresentSlidePlugin } from "./presentSlide";
import WeatherPlugin from "@gui-chat-plugin/weather/vue";

import type { ToolPlugin } from "./types";
import {
  setPluginDispatchHandler,
  wrapWithPluginRuntime,
} from "./pluginRuntime";
import { htmlPreviewUrl } from "../host/htmlFrames";
import {
  createHostContext,
  dispatchToPlugin,
  type PluginExecute,
} from "../host/pluginHost";

// The package has no system prompt; this is MulmoChat's (src/tools/index.ts).
const PRESENT_DOCUMENT_PROMPT = `Use the presentDocument tool to create structured documents with text and embedded images. This tool is ideal for:
- Guides, tutorials, and how-to content ("create a guide about...", "explain how to...")
- Educational content (lessons, explanations, timelines, concept visualizations)
- Reports and presentations (business reports, data analysis, infographics)
- Articles and blog posts with illustrations
- Recipes with step-by-step photos
- Travel guides with location images
- Any content that combines written information with supporting visuals

IMPORTANT: Use this tool instead of just generating standalone images when the user wants informational or educational content with visuals. This creates a cohesive document with formatted text (markdown) AND images embedded at appropriate locations.

Format embedded images as: ![Detailed image prompt](__too_be_replaced_image_path__)`;

// The package's prompt also describes paths outside artifacts/html/, which
// MulmoGlass doesn't open. The CDNs match the service worker's CSP
// (public/sw.js).
const PRESENT_HTML_PROMPT = `Use presentHtml when the user asks for HTML output, dashboards, custom layouts, or interactive content. Provide EITHER \`html\` OR \`path\`, not both. \`html\` is a full self-contained document (\`<!DOCTYPE html>\`, \`<html>\`, \`<body>\`) with all CSS and JavaScript inlined or loaded from a CDN (cdn.jsdelivr.net, unpkg.com, cdnjs.cloudflare.com, cdn.plot.ly, Google Fonts); the page cannot make network requests (fetch/XHR). Images and media may come from those same CDNs, \`data:\` URLs or \`blob:\` URLs (inline SVG and canvas work too); any other host is blocked. It is saved to \`artifacts/html/<YYYY>/<MM>/...\`. \`path\` presents a page you saved earlier (\`artifacts/html/...\`) without re-saving it.`;

// generateImage's own prompt says the model MUST draw whenever it talks about
// places, objects or people. On a voice-only device that turns every mention
// of a city into a picture, including answers it has no data for (a "weather
// in Tokyo" illustration), so MulmoGlass replaces it.
const GENERATE_IMAGE_PROMPT =
  "Use generateImage when the user asks for a picture, or when an illustration clearly helps explain what you are talking about. Never use an image in place of information you don't have: an image can't show today's weather, the news or a price.";

const registeredPlugins: { plugin: ToolPlugin }[] = [
  {
    plugin: {
      ...GenerateImagePlugin.plugin,
      systemPrompt: GENERATE_IMAGE_PROMPT,
    },
  },
  // Slideshows: one generated picture per slide (./presentSlide.ts).
  PresentSlidePlugin,
  {
    plugin: { ...MarkdownPlugin.plugin, systemPrompt: PRESENT_DOCUMENT_PROMPT },
  },
  ChartPlugin,
  { plugin: { ...HtmlPlugin.plugin, systemPrompt: PRESENT_HTML_PROMPT } },
  ShapeScriptPlugin,
  QuizPlugin,
  FormPlugin,
  SpreadsheetPlugin,
  MindMapPlugin,
  // Forecasts from the Japan Meteorological Agency (Japan only), fetched from
  // the browser (its API allows any origin).
  WeatherPlugin,
] as { plugin: ToolPlugin }[];

// presentHtml's View loads `data.previewUrl` when there is one; point it at
// the page shell (src/host/htmlFrames.ts) instead of a server URL.
const withHtmlPreviewUrl =
  (execute: PluginExecute): PluginExecute =>
  async (context, args) => {
    const result = await execute(context, args);
    const data = result.data as { filePath?: unknown } | undefined;
    if (typeof data?.filePath !== "string") return result;
    return {
      ...result,
      data: { ...data, previewUrl: htmlPreviewUrl(data.filePath) },
    };
  };

const executes: Record<string, PluginExecute> = {};

const plugins: Record<string, ToolPlugin> = {};
for (const { plugin } of registeredPlugins) {
  const toolName = plugin.toolDefinition.name;
  const execute = plugin.execute as PluginExecute;
  executes[toolName] =
    toolName === "presentHtml" ? withHtmlPreviewUrl(execute) : execute;
  plugins[toolName] = {
    ...plugin,
    viewComponent:
      plugin.viewComponent &&
      wrapWithPluginRuntime(toolName, plugin.viewComponent),
    previewComponent:
      plugin.previewComponent &&
      wrapWithPluginRuntime(toolName, plugin.previewComponent),
  };
}

setPluginDispatchHandler((toolName, args) =>
  dispatchToPlugin(toolName, args, executes[toolName]),
);

export const getToolPlugin = (name: string): ToolPlugin | null =>
  plugins[name] ?? null;

// gui-chat-protocol's ToolDefinition.prompt is for the host's system prompt,
// not a field the model APIs accept.
const toolDefinitionForModel = (tool: ToolDefinition): ToolDefinition => {
  const definition = { ...tool };
  delete definition.prompt;
  return definition;
};

/** The tools sent to the voice model. */
export const pluginTools = (): ToolDefinition[] =>
  Object.values(plugins).map((plugin) =>
    toolDefinitionForModel(plugin.toolDefinition),
  );

/** The plugins' prompts, for the session instructions. */
export const pluginSystemPrompts = (): string =>
  Object.values(plugins)
    .map((plugin) => plugin.systemPrompt ?? plugin.toolDefinition.prompt)
    .filter((prompt): prompt is string => !!prompt)
    .join("\n");

/** Run a tool call from the model. */
export async function toolExecute(
  name: string,
  args: Record<string, unknown>,
  currentResult: ToolResult | null,
): Promise<ToolResult & { toolName: string; uuid: string }> {
  const execute = executes[name];
  if (!execute) throw new Error(`Plugin ${name} not found`);
  const context = createHostContext(currentResult);
  const result = await execute(context, args);
  // An update keeps the result it replaces (same UUID).
  const uuid =
    result.updating && currentResult?.uuid
      ? currentResult.uuid
      : result.uuid || uuidv4();
  return { ...result, toolName: result.toolName ?? name, uuid };
}

export { setPluginLocale } from "./pluginRuntime";
