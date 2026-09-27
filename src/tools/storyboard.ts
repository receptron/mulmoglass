// defineStoryboard and presentPanel: a story told in pictures, with
// characters who look the same in every panel.
//
// defineStoryboard draws a reference sheet for each character, in parallel,
// and shows the cast. presentPanel then draws one panel at a time, sending the
// sheets of the characters in it as reference images
// (context.app.generateImageWithReferences, src/host/pluginHost.ts), which
// kept a character's face, hair and clothes on Gemini, OpenAI and xAI alike;
// a description repeated in every prompt did not. Panels go on like slides
// (./sequence.ts, src/composables/useSequence.ts).
//
// A storyboard is saved as artifacts/storyboards/<id>.json, with its
// pictures' paths in artifacts/images/, so it outlives the session that made
// it. The file is MulmoGlass's own, not a MulmoScript, but it maps onto one
// field for field: each character (name and sheet) would be an entry in
// imageParams.images, each panel a beat, and a panel's characters that beat's
// imageNames. Nothing converts it yet.
import { defineComponent, h, markRaw, type PropType } from "vue";
import type { ToolResult } from "gui-chat-protocol/vue";
import type { ToolPlugin } from "./types";
import { artifactsFileOps } from "../host/workspace";
import {
  createRepeatGuard,
  fittedImageView,
  imageOf,
  imagePreview,
  generateStepImage,
  imageResult,
  userSpokeSince,
  type SequenceStep,
} from "./sequence";

export const DEFINE_STORYBOARD = "defineStoryboard";
export const PRESENT_PANEL = "presentPanel";

const MAX_CHARACTERS = 4;
const MAX_PANELS = 12;
const STORYBOARDS_DIR = "storyboards";

interface Character {
  name: string;
  description: string;
  /** Its reference sheet, when one was made and saved. */
  imagePath?: string;
}

interface Panel {
  caption: string;
  characters: string[];
  imagePrompt: string;
  imagePath?: string;
  /** In an interactive story, what the user chose between after it. */
  choices?: string[];
}

interface Storyboard {
  id: string;
  title: string;
  style: string;
  totalPanels: number;
  characters: Character[];
  /** The user chooses what happens at some panels; the panels saved are the
   *  path the story took. */
  interactive: boolean;
  panels: Record<string, Panel>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// --- Storage ---------------------------------------------------------------

const storyboards = new Map<string, Storyboard>();
// Character sheets as data URLs, by storyboard and name: the images the
// panels send, without reading them back from OPFS each time.
const sheets = new Map<string, string>();
const sheetKey = (id: string, name: string) => `${id}/${name.toLowerCase()}`;

const storyboardFile = (id: string) => `${STORYBOARDS_DIR}/${id}.json`;

async function saveStoryboard(storyboard: Storyboard): Promise<void> {
  storyboards.set(storyboard.id, storyboard);
  try {
    await artifactsFileOps.write(
      storyboardFile(storyboard.id),
      JSON.stringify(storyboard, null, 2),
    );
  } catch (error) {
    // It still works for this session.
    console.warn("[storyboard] could not save", error);
  }
}

async function loadStoryboard(id: string): Promise<Storyboard | null> {
  if (!/^[0-9a-f]+$/.test(id)) return null;
  const cached = storyboards.get(id);
  if (cached) return cached;
  try {
    const saved = JSON.parse(
      await artifactsFileOps.read(storyboardFile(id)),
    ) as Storyboard;
    storyboards.set(id, saved);
    return saved;
  } catch {
    return null;
  }
}

const MIME_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};

/** A character's sheet as a data URL, from memory or from its saved file. */
async function sheetOf(
  storyboard: Storyboard,
  character: Character,
): Promise<string | null> {
  const key = sheetKey(storyboard.id, character.name);
  const cached = sheets.get(key);
  if (cached) return cached;
  const path = character.imagePath;
  if (!path?.startsWith("artifacts/")) return null;
  try {
    const bytes = await artifactsFileOps.readBytes(
      path.slice("artifacts/".length),
    );
    const type = MIME_TYPES[path.split(".").pop() ?? ""] ?? "image/png";
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const dataUrl = `data:${type};base64,${btoa(binary)}`;
    sheets.set(key, dataUrl);
    return dataUrl;
  } catch {
    return null;
  }
}

// --- defineStoryboard ------------------------------------------------------

interface StoryboardArgs {
  title: string;
  style: string;
  totalPanels: number;
  characters: Character[];
  interactive: boolean;
}

/** The arguments, or what is wrong with them (said to the model). */
function parseStoryboardArgs(
  args: Record<string, unknown>,
): StoryboardArgs | string {
  const { totalPanels } = args;
  if (
    typeof totalPanels !== "number" ||
    !Number.isInteger(totalPanels) ||
    totalPanels < 1 ||
    totalPanels > MAX_PANELS
  ) {
    return `totalPanels must be a whole number from 1 to ${MAX_PANELS}`;
  }
  const characters: Character[] = [];
  for (const item of Array.isArray(args.characters) ? args.characters : []) {
    const name = isRecord(item) ? text(item.name) : "";
    const description = isRecord(item) ? text(item.description) : "";
    if (!name || !description) {
      return "every character needs a name and a description";
    }
    if (characters.some((c) => sameName(c.name, name))) {
      return `two characters are named ${name}`;
    }
    characters.push({ name, description });
  }
  if (characters.length < 1 || characters.length > MAX_CHARACTERS) {
    return `a storyboard has 1 to ${MAX_CHARACTERS} characters`;
  }
  return {
    title: text(args.title),
    style: text(args.style),
    totalPanels,
    characters,
    interactive: args.interactive === true,
  };
}

// A prompt that starts with the storyboard's style, when it has one.
const styled = (style: string, prompt: string) =>
  style ? `${style}. ${prompt}` : prompt;

const sheetPrompt = (style: string, { name, description }: Character) =>
  styled(
    style,
    `Character reference sheet of ${name}: ${description}. Full body, front, side and back views, on a plain white background. No text or labels.`,
  );

const castShownInstructions = (storyboard: Storyboard): string =>
  `The cast of "${storyboard.title}" is now on the screen. Introduce the characters briefly, then, in this same reply and without waiting for the user, call presentPanel for panel 1 with storyboardId "${storyboard.id}". If the user has asked you to stop, or asked something else, answer them instead of going on.`;

interface CastData {
  storyboardId: string;
  title: string;
  totalPanels: number;
  /** The first sheet, for the preview. */
  imageData?: string;
  characters: { name: string; imageData?: string }[];
}

async function defineStoryboard(
  context: Parameters<ToolPlugin["execute"]>[0],
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = parseStoryboardArgs(args);
  if (typeof parsed === "string") return { message: parsed };
  const generate = context.app?.generateImage;
  if (!generate) return { message: "image generation isn't available" };

  const id = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  const results = await Promise.all(
    parsed.characters.map((character) =>
      imageResult(() => generate(sheetPrompt(parsed.style, character))),
    ),
  );
  const drawn = results.map(imageOf);
  const firstFailure = results.find((_, i) => !drawn[i].imageData);
  if (drawn.every(({ imageData }) => !imageData) && firstFailure) {
    // Nothing to show: the image host's reason, and its instructions.
    return {
      ...firstFailure,
      message: `the character sheets couldn't be made: ${firstFailure.message}`,
    };
  }

  const storyboard: Storyboard = {
    id,
    ...parsed,
    characters: parsed.characters.map((character, i) => ({
      ...character,
      ...(drawn[i].imagePath && { imagePath: drawn[i].imagePath }),
    })),
    panels: {},
  };
  parsed.characters.forEach(({ name }, i) => {
    const { imageData } = drawn[i];
    if (imageData) sheets.set(sheetKey(id, name), imageData);
  });
  await saveStoryboard(storyboard);

  const saved = storyboard.characters
    .filter((c) => c.imagePath)
    .map((c) => `${c.name}: ${c.imagePath}`);
  const missing = parsed.characters
    .map(({ name }, i) =>
      drawn[i].imageData ? null : `${name} (${results[i].message})`,
    )
    .filter((line): line is string => !!line);
  const data: CastData = {
    storyboardId: id,
    title: storyboard.title,
    totalPanels: storyboard.totalPanels,
    imageData: drawn.find((d) => d.imageData)?.imageData,
    characters: parsed.characters.map(({ name }, i) => ({
      name,
      imageData: drawn[i].imageData,
    })),
  };
  return {
    data,
    title: storyboard.title,
    message: [
      `storyboard "${id}" is ready with ${storyboard.totalPanels} panels; the cast is on the screen`,
      saved.length ? `character sheets saved to ${saved.join(", ")}` : "",
      missing.length
        ? `no sheet for ${missing.join("; ")}: they will be drawn from their description`
        : "",
    ]
      .filter(Boolean)
      .join("; "),
    instructions: castShownInstructions(storyboard),
  };
}

// --- presentPanel ----------------------------------------------------------

interface PanelArgs {
  storyboardId: string;
  panel: number;
  characters: string[];
  imagePrompt: string;
  caption: string;
  choices: string[];
}

const MAX_CHOICES = 3;

function parsePanelArgs(args: Record<string, unknown>): PanelArgs | null {
  const { panel } = args;
  const storyboardId = text(args.storyboardId);
  const imagePrompt = text(args.imagePrompt);
  if (
    !storyboardId ||
    !imagePrompt ||
    typeof panel !== "number" ||
    !Number.isInteger(panel) ||
    panel < 1
  ) {
    return null;
  }
  const characters = (Array.isArray(args.characters) ? args.characters : [])
    .map(text)
    .filter(Boolean);
  return {
    storyboardId,
    panel,
    characters,
    imagePrompt,
    caption: text(args.caption),
    choices: (Array.isArray(args.choices) ? args.choices : [])
      .map(text)
      .filter(Boolean)
      .slice(0, MAX_CHOICES),
  };
}

function panelShownInstructions(
  storyboard: Storyboard,
  panel: number,
  choices: string[],
): string {
  if (choices.length) {
    const listed = choices.map((choice, i) => `${i + 1}. ${choice}`).join(" ");
    return `Panel ${panel} of ${storyboard.totalPanels} is now on the screen, with the user's choices: ${listed} Tell this part of the story, then read the choices out and ask the user which one they pick, and wait for their answer. Then call presentPanel for panel ${panel + 1} with storyboardId "${storyboard.id}", going on the way they chose.`;
  }
  return panel < storyboard.totalPanels
    ? `Panel ${panel} of ${storyboard.totalPanels} is now on the screen. Tell this part of the story, then, in this same reply and without waiting for the user, call presentPanel for panel ${panel + 1} with storyboardId "${storyboard.id}". If the user has asked you to stop, or asked something else, since the story began, answer them instead of going on.`
    : `Panel ${panel} of ${storyboard.totalPanels}, the last one, is now on the screen. Tell this part of the story, then bring it to an end.`;
}

/** The prompt for a panel: the style, the scene, and who is who. */
function panelPrompt(
  storyboard: Storyboard,
  args: PanelArgs,
  cast: { character: Character; hasSheet: boolean }[],
): string {
  const lines = [
    styled(
      storyboard.style,
      `Panel ${args.panel} of ${storyboard.totalPanels} of the illustrated story "${storyboard.title}". ${args.imagePrompt}`,
    ),
  ];
  let reference = 0;
  const who = cast.map(({ character, hasSheet }) =>
    hasSheet
      ? `${character.name} is the character in reference image ${++reference}`
      : `${character.name}: ${character.description}`,
  );
  if (who.length) lines.push(`${who.join(". ")}.`);
  if (reference) {
    lines.push(
      "Draw each character exactly as in their reference image: the same face, hair, clothes and colors. Use the reference images only for how the characters look, not for their pose or the background.",
    );
  }
  lines.push("No captions, speech bubbles or other text in the picture.");
  return lines.join(" ");
}

interface PanelData {
  imageData: string;
  imagePath?: string;
  prompt: string;
  storyboardId: string;
  panel: number;
  totalPanels: number;
  caption: string;
  choices?: string[];
}

// An identical panel asked for twice (Gemini Live) is shown once.
const repeats = createRepeatGuard();

// The panel waiting for the user's choice, by storyboard, and when it
// appeared. Grok sometimes went on to the next panel in the reply that read
// the choices out; the host holds such a panel back until the user speaks.
// A panel being drawn is here too, with shownAt Infinity: its choices aren't
// known yet, so a later panel waits for it.
const awaitingChoice = new Map<string, { panel: number; shownAt: number }>();

async function presentPanel(
  context: Parameters<ToolPlugin["execute"]>[0],
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = parsePanelArgs(args);
  if (!parsed) {
    return {
      message:
        "presentPanel needs a storyboardId, a panel number (from 1) and an imagePrompt",
    };
  }
  const storyboard = await loadStoryboard(parsed.storyboardId);
  if (!storyboard) {
    return {
      message: `there is no storyboard "${parsed.storyboardId}"; call defineStoryboard first`,
    };
  }
  if (parsed.panel > storyboard.totalPanels) {
    return {
      message: `storyboard "${storyboard.id}" has ${storyboard.totalPanels} panels`,
    };
  }
  const app = context.app;
  if (!app?.generateImage) {
    return { message: "image generation isn't available" };
  }

  const waiting = awaitingChoice.get(storyboard.id);
  if (
    waiting &&
    parsed.panel > waiting.panel &&
    !userSpokeSince(waiting.shownAt)
  ) {
    console.info(`[sequence] holding panel ${parsed.panel} for the user`);
    // No instructions: they would start another reply.
    return {
      message:
        waiting.shownAt === Infinity
          ? `panel ${parsed.panel} was not shown: panel ${waiting.panel} is still being drawn. Wait for it before going on.`
          : `panel ${parsed.panel} was not shown: the user hasn't picked a choice yet, and panel ${waiting.panel} is still on the screen. Wait for their answer.`,
      cancelled: true,
    };
  }

  const key = JSON.stringify(parsed);
  if (await repeats.alreadyShown(key)) {
    // Not shown again, and no instructions: the model goes on by itself.
    return {
      message: `panel ${parsed.panel} of ${storyboard.totalPanels} is already on the screen`,
      cancelled: true,
    };
  }
  const settle = repeats.begin(key);
  const pending = { panel: parsed.panel, shownAt: Infinity };
  const before = awaitingChoice.get(storyboard.id);
  awaitingChoice.set(storyboard.id, pending);
  // Whether this panel is still the latest one asked for.
  const latest = () => awaitingChoice.get(storyboard.id) === pending;

  const unknown: string[] = [];
  const cast: { character: Character; sheet: string | null }[] = [];
  for (const name of parsed.characters) {
    const character = storyboard.characters.find((c) => sameName(c.name, name));
    if (!character) unknown.push(name);
    else if (!cast.some((c) => c.character === character)) {
      cast.push({ character, sheet: await sheetOf(storyboard, character) });
    }
  }
  const references = cast
    .map(({ sheet }) => sheet)
    .filter((sheet): sheet is string => !!sheet);
  const prompt = panelPrompt(
    storyboard,
    parsed,
    cast.map(({ character, sheet }) => ({ character, hasSheet: !!sheet })),
  );
  const image = await generateStepImage(app, prompt, references);
  const { imageData, imagePath } = imageOf(image);
  settle(!!imageData);
  if (!imageData) {
    // The panel before it is still the one waiting, if one was.
    if (latest()) {
      if (before) awaitingChoice.set(storyboard.id, before);
      else awaitingChoice.delete(storyboard.id);
    }
    // A failure keeps the image host's message and instructions.
    return image;
  }

  // Choices make the story interactive, whether or not defineStoryboard
  // said so (Gemini Live gave choices without it); none on the last panel.
  const choices =
    parsed.panel < storyboard.totalPanels && parsed.choices.length >= 2
      ? parsed.choices
      : [];
  if (choices.length) storyboard.interactive = true;

  storyboard.panels[String(parsed.panel)] = {
    caption: parsed.caption,
    characters: cast.map(({ character }) => character.name),
    imagePrompt: parsed.imagePrompt,
    ...(imagePath && { imagePath }),
    ...(choices.length && { choices }),
  };
  await saveStoryboard(storyboard);
  if (latest()) {
    if (choices.length) {
      awaitingChoice.set(storyboard.id, {
        panel: parsed.panel,
        shownAt: performance.now(),
      });
    } else {
      awaitingChoice.delete(storyboard.id);
    }
  }

  const data: PanelData = {
    imageData,
    ...(imagePath && { imagePath }),
    prompt,
    storyboardId: storyboard.id,
    panel: parsed.panel,
    totalPanels: storyboard.totalPanels,
    caption: parsed.caption,
    ...(choices.length && { choices }),
  };
  return {
    ...image,
    data,
    title: parsed.caption || `Panel ${parsed.panel}`,
    message: [
      `panel ${parsed.panel} of ${storyboard.totalPanels} is on the screen`,
      imagePath ? `saved to ${imagePath}` : "",
      unknown.length
        ? `not in the cast, so drawn from the prompt alone: ${unknown.join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join("; "),
    instructions: panelShownInstructions(storyboard, parsed.panel, choices),
  };
}

// --- The host's view of a storyboard ------------------------------------------

/** The story's place after the cast or a panel was shown, or null. */
export function storyboardSequenceStep(
  name: string,
  result: ToolResult,
): SequenceStep | null {
  const data = isRecord(result.data) ? result.data : {};
  const id = data.storyboardId;
  const total = data.totalPanels;
  if (typeof id !== "string" || typeof total !== "number") return null;
  if (name === DEFINE_STORYBOARD && typeof data.imageData === "string") {
    return {
      step: 0,
      total,
      kind: "story",
      label: `The cast of "${String(data.title ?? "")}"`,
      onShown: "introduce the characters",
      nextCall: `call presentPanel for panel 1 of ${total} with storyboardId "${id}"`,
    };
  }
  const panel = data.panel;
  if (
    name === PRESENT_PANEL &&
    typeof panel === "number" &&
    typeof data.imageData === "string"
  ) {
    return {
      step: panel,
      total,
      kind: "story",
      label: `Panel ${panel} of ${total}`,
      onShown: "tell that part of the story",
      nextCall: `call presentPanel for panel ${panel + 1} of ${total} with storyboardId "${id}"`,
      // A panel with choices waits for the user's pick.
      waitsForUser: Array.isArray(data.choices) && data.choices.length > 0,
    };
  }
  return null;
}

// --- Views -------------------------------------------------------------------

const CastView = markRaw(
  defineComponent({
    name: "StoryboardCastView",
    props: {
      selectedResult: {
        type: Object as PropType<ToolResult<CastData>>,
        required: true,
      },
    },
    setup(props) {
      return () => {
        const data = props.selectedResult.data;
        const characters = data?.characters ?? [];
        return h("div", { class: "h-full w-full flex flex-col bg-white p-4" }, [
          h(
            "h2",
            { class: "text-center text-xl font-semibold text-gray-800 mb-3" },
            data?.title ?? "",
          ),
          h(
            "div",
            {
              class: `flex-1 min-h-0 grid gap-3 ${characters.length > 1 ? "grid-cols-2" : "grid-cols-1"} auto-rows-fr`,
            },
            characters.map((character) =>
              h("figure", { class: "min-h-0 flex flex-col items-center" }, [
                character.imageData
                  ? h("img", {
                      src: character.imageData,
                      alt: character.name,
                      class: "flex-1 min-h-0 max-w-full object-contain",
                    })
                  : h("div", { class: "flex-1" }),
                h(
                  "figcaption",
                  { class: "text-lg text-gray-800 mt-1" },
                  character.name,
                ),
              ]),
            ),
          ),
        ]);
      };
    },
  }),
);

const PROMPT =
  "When the user asks for a story, a picture book, a comic or a storyboard, tell it in pictures: first call defineStoryboard with the art style and the characters who appear more than once (it draws a reference sheet for each, so they look the same in every panel), then show the panels one at a time with presentPanel, naming the characters in each, and tell each part of the story when its panel appears. Go on to the last panel without asking whether to continue, unless the story is interactive. When the user wants to decide what happens (an adventure, a story for a child who wants to choose), set interactive, and give two or three choices on two or three of the panels: the story waits there for the user's pick and goes on their way; it still ends at the last panel whichever way it goes. Use presentSlide to explain a topic, not to tell a story.";

const defineStoryboardPlugin: ToolPlugin = {
  toolDefinition: {
    type: "function",
    name: DEFINE_STORYBOARD,
    description:
      "Start a story told in pictures: set its art style and draw a reference sheet for each recurring character, shown as the cast. Then call presentPanel for each panel, in order.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "The story's title." },
        style: {
          type: "string",
          description:
            "The art style of every picture, in one sentence (for example: soft watercolor, children's picture book).",
        },
        totalPanels: {
          type: "integer",
          description: `How many panels the story has, at most ${MAX_PANELS}; four to eight is usual.`,
        },
        interactive: {
          type: "boolean",
          description:
            "The user chooses what happens: panels can offer choices, and the story waits for the pick.",
        },
        characters: {
          type: "array",
          description: `The characters who appear in more than one panel, 1 to ${MAX_CHARACTERS}.`,
          items: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "A short name, used in presentPanel.",
              },
              description: {
                type: "string",
                description:
                  "How they look: age, build, face, hair, clothes and colors. Be concrete: it is drawn once and reused in every panel.",
              },
            },
            required: ["name", "description"],
          },
        },
      },
      required: ["title", "style", "totalPanels", "characters"],
    },
  },
  systemPrompt: PROMPT,
  generatingMessage: "Drawing the characters...",
  isEnabled: () => true,
  viewComponent: CastView,
  previewComponent: imagePreview("StoryboardCastPreview"),
  execute: (context, args) =>
    defineStoryboard(context, args as Record<string, unknown>),
};

const presentPanelPlugin: ToolPlugin = {
  toolDefinition: {
    type: "function",
    name: PRESENT_PANEL,
    description:
      "Show one panel of a storyboard made with defineStoryboard: a picture of the scene with its characters drawn as in their reference sheets, and a caption. Call it once per panel, in order, starting with panel 1.",
    parameters: {
      type: "object",
      properties: {
        storyboardId: {
          type: "string",
          description: "The storyboardId defineStoryboard returned.",
        },
        panel: {
          type: "integer",
          description: "This panel's number, starting at 1.",
        },
        characters: {
          type: "array",
          items: { type: "string" },
          description:
            "The names (as in defineStoryboard) of the characters in this panel.",
        },
        imagePrompt: {
          type: "string",
          description:
            "What the panel shows: the setting, what happens, expressions and the camera angle. Refer to characters by name; don't describe their looks again.",
        },
        caption: {
          type: "string",
          description: "One short line shown under the picture.",
        },
        choices: {
          type: "array",
          items: { type: "string" },
          description:
            "Only in an interactive story, and not on the last panel: two or three short options for what happens next. The story waits for the user's pick.",
        },
      },
      required: ["storyboardId", "panel", "characters", "imagePrompt"],
    },
  },
  generatingMessage: "Drawing the panel...",
  isEnabled: () => true,
  viewComponent: fittedImageView("PresentPanelView", (data) => ({
    caption: typeof data.caption === "string" ? data.caption : "",
    choices: Array.isArray(data.choices)
      ? data.choices.filter((c): c is string => typeof c === "string")
      : [],
  })),
  previewComponent: imagePreview("PresentPanelPreview"),
  execute: (context, args) =>
    presentPanel(context, args as Record<string, unknown>),
};

export const DefineStoryboardPlugin = { plugin: defineStoryboardPlugin };
export const PresentPanelPlugin = { plugin: presentPanelPlugin };
