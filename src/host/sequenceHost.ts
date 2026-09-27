// The drawing half of presentSlide, defineStoryboard and presentPanel
// (../tools/sequenceTools.ts): it draws the pictures and keeps the records.
// The tools (../tools/presentSlide.ts, storyboard.ts) have already decided
// whether a step may be shown (a guide step or a story panel waits for the
// user, a repeated call is dropped) before they call it.
//
// Ported from MulmoChat's server/plugins/sequenceHost.ts, where it runs on the
// server behind POST /api/plugin/<tool>; here it runs in the page, with OPFS
// as its files, and takes the same arguments and config, so the two save the
// same records and return the same results. Differences: the image settings
// are the user's (./pluginHost.ts) rather than sent with the request, and
// results have no `instructionsRequired` (a text-chat hint; MulmoGlass is
// voice only).
//
// Records are saved as artifacts/slideshows/<id>.json and
// artifacts/storyboards/<id>.json, with their pictures' paths in
// artifacts/images/, so a slideshow or a story outlives the session, and
// MulmoChat's makeMovie could make a movie of it. References are sent to the
// image model as saved files: a character's sheet for each character in a
// panel, and the step before it for a guide step.
import type { ToolResult } from "gui-chat-protocol";
import { artifactsFileOps } from "./workspace";
import { generateImage } from "./imageGeneration";
import { loadSourceImages, type SourceImage } from "./imageStore";
import { currentImageSettings } from "./pluginHost";
import {
  DEFINE_STORYBOARD,
  PANEL_ARGS_ERROR,
  PRESENT_PANEL,
  PRESENT_SLIDE,
  SEQUENCE_ID,
  SLIDE_ARGS_ERROR,
  castShownInstructions,
  panelShownInstructions,
  parsePanelArgs,
  parseSlideArgs,
  parseStoryboardArgs,
  sameName,
  slideShownInstructions,
  type CastData,
  type Character,
  type PanelArgs,
  type PanelData,
  type SlideArgs,
  type SlideData,
  type Slideshow,
  type Storyboard,
} from "../tools/sequenceTools";

export const SLIDESHOWS_DIR = "slideshows";
export const STORYBOARDS_DIR = "storyboards";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A new slideshow's or storyboard's ID (SEQUENCE_ID). */
export const newSequenceId = () =>
  crypto.randomUUID().replaceAll("-", "").slice(0, 12);

/** The picture a result carries, and where it was saved. */
function imageOf(result: ToolResult): {
  imageData?: string;
  imagePath?: string;
} {
  const data = isRecord(result.data) ? result.data : {};
  return {
    imageData: typeof data.imageData === "string" ? data.imageData : undefined,
    imagePath: typeof data.imagePath === "string" ? data.imagePath : undefined,
  };
}

// --- Records -------------------------------------------------------------------

// Read once, then kept in memory.
const records = new Map<string, Slideshow | Storyboard>();

const recordFile = (dir: string, id: string) => `${dir}/${id}.json`;

async function readRecord<T extends Slideshow | Storyboard>(
  file: string,
): Promise<T | null> {
  const cached = records.get(file);
  if (cached) return cached as T;
  try {
    const saved = JSON.parse(await artifactsFileOps.read(file)) as T;
    records.set(file, saved);
    return saved;
  } catch {
    return null;
  }
}

export async function loadRecord<T extends Slideshow | Storyboard>(
  dir: string,
  id: string,
): Promise<T | null> {
  return SEQUENCE_ID.test(id) ? readRecord<T>(recordFile(dir, id)) : null;
}

// One change to a record at a time, from loading it to writing it: two steps
// drawn at once would otherwise each write their own copy, and the later
// write could drop the other's entry.
const pending = new Map<string, Promise<unknown>>();

function oneAtATime<T>(file: string, change: () => Promise<T>): Promise<T> {
  const run = (pending.get(file) ?? Promise.resolve()).then(change, change);
  const settled = run.catch(() => undefined);
  pending.set(file, settled);
  void settled.then(() => {
    if (pending.get(file) === settled) pending.delete(file);
  });
  return run;
}

/** Change a record (null when there is none yet) and save it. Resolves to
 *  whether it was saved: one that wasn't still works until the app closes,
 *  and the result says so, as for a picture that wasn't saved. */
function updateRecord<T extends Slideshow | Storyboard>(
  dir: string,
  id: string,
  change: (record: T | null) => T,
): Promise<boolean> {
  const file = recordFile(dir, id);
  return oneAtATime(file, async () => {
    const record = change(await readRecord<T>(file));
    records.set(file, record);
    try {
      await artifactsFileOps.write(file, JSON.stringify(record, null, 2));
      return true;
    } catch (error) {
      console.warn("[sequence] could not save", file, error);
      return false;
    }
  });
}

const NOT_SAVED = (what: string) =>
  `the ${what} could not be saved, so it lasts only until the app closes`;

/** A saved picture to draw from, or null (logged) when it can't be read. */
async function loadReference(imagePath: string): Promise<SourceImage | null> {
  try {
    const [image] = await loadSourceImages([imagePath]);
    return image;
  } catch (error) {
    console.warn(
      "[sequence] could not load a reference image",
      imagePath,
      error,
    );
    return null;
  }
}

// --- presentSlide ------------------------------------------------------------

function slidePrompt(slide: SlideArgs, hasReference: boolean): string {
  if (slide.mode !== "steps") {
    // The title leads the prompt as a slide's title, not as a bare sentence:
    // a question title first ("What is Photosynthesis?. A bright, sunny
    // day…") made Gemini return no image (finish reason NO_IMAGE) 4 times in
    // 12; framed like this, 0 in 12 (MulmoGlass).
    return slide.title
      ? `A presentation slide titled "${slide.title}". ${slide.imagePrompt}`
      : slide.imagePrompt;
  }
  const titled = slide.title ? `, "${slide.title}"` : "";
  return [
    `An instructional illustration of step ${slide.slide} of ${slide.totalSlides}${titled}. ${slide.imagePrompt}`,
    hasReference
      ? "The reference image is the previous step: keep the same objects, hands, tools and setting, and show what this step changes."
      : "",
    "Show the action clearly, with little or no text.",
  ]
    .filter(Boolean)
    .join(" ");
}

async function presentSlide(
  args: Record<string, unknown>,
  rawConfig: unknown,
): Promise<ToolResult> {
  const slide = parseSlideArgs(args);
  if (!slide) return { message: SLIDE_ARGS_ERROR };
  const settings = currentImageSettings();
  const config = isRecord(rawConfig) ? rawConfig : {};
  const requestedId =
    typeof config.slideshowId === "string" ? config.slideshowId : "";
  const slideshowId = SEQUENCE_ID.test(requestedId)
    ? requestedId
    : newSequenceId();
  const previousPath =
    slide.mode === "steps" && typeof config.previousImagePath === "string"
      ? config.previousImagePath
      : "";
  const reference = previousPath ? await loadReference(previousPath) : null;

  const prompt = slidePrompt(slide, !!reference);
  const image = await generateImage(
    prompt,
    settings,
    reference ? [reference] : [],
  );
  const { imageData, imagePath } = imageOf(image);
  // A failure keeps the image host's message and instructions.
  if (!imageData) return image;

  const recorded = await updateRecord<Slideshow>(
    SLIDESHOWS_DIR,
    slideshowId,
    (saved) => {
      const slideshow = saved ?? {
        id: slideshowId,
        title: "",
        mode: slide.mode,
        totalSlides: slide.totalSlides,
        slides: {},
      };
      if (slide.slide === 1) slideshow.title = slide.title;
      slideshow.slides[String(slide.slide)] = {
        title: slide.title,
        imagePrompt: slide.imagePrompt,
        ...(imagePath && { imagePath }),
      };
      return slideshow;
    },
  );

  const data: SlideData = {
    imageData,
    ...(imagePath && { imagePath }),
    prompt,
    slideshowId,
    slide: slide.slide,
    totalSlides: slide.totalSlides,
    title: slide.title,
    mode: slide.mode,
  };
  const noun = slide.mode === "steps" ? "step" : "slide";
  return {
    data,
    title: slide.title || `Slide ${slide.slide}`,
    message: [
      `${noun} ${slide.slide} of ${slide.totalSlides} of slideshow "${slideshowId}" is on the screen`,
      imagePath ? `saved to ${imagePath}` : "",
      recorded ? "" : NOT_SAVED("slideshow"),
    ]
      .filter(Boolean)
      .join("; "),
    instructions: slideShownInstructions(slide),
  };
}

// --- defineStoryboard ----------------------------------------------------------

// A prompt that starts with the storyboard's style, when it has one.
const styled = (style: string, prompt: string) =>
  style ? `${style}. ${prompt}` : prompt;

const sheetPrompt = (style: string, { name, description }: Character) =>
  styled(
    style,
    `Character reference sheet of ${name}: ${description}. Full body, front, side and back views, on a plain white background. No text or labels.`,
  );

async function defineStoryboard(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = parseStoryboardArgs(args);
  if (typeof parsed === "string") return { message: parsed };
  const settings = currentImageSettings();

  const results = await Promise.all(
    parsed.characters.map((character) =>
      generateImage(sheetPrompt(parsed.style, character), settings),
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
    id: newSequenceId(),
    ...parsed,
    characters: parsed.characters.map((character, i) => ({
      ...character,
      ...(drawn[i].imagePath && { imagePath: drawn[i].imagePath }),
    })),
    panels: {},
  };
  const recorded = await updateRecord<Storyboard>(
    STORYBOARDS_DIR,
    storyboard.id,
    () => storyboard,
  );

  const saved = storyboard.characters
    .filter((c) => c.imagePath)
    .map((c) => `${c.name}: ${c.imagePath}`);
  const missing = parsed.characters
    .map(({ name }, i) =>
      drawn[i].imageData ? null : `${name} (${results[i].message})`,
    )
    .filter((line): line is string => !!line);
  const data: CastData = {
    storyboardId: storyboard.id,
    title: storyboard.title,
    totalPanels: storyboard.totalPanels,
    imageData: drawn.find((d) => d.imageData)?.imageData,
    characters: storyboard.characters.map(({ name, imagePath }, i) => ({
      name,
      ...(drawn[i].imageData && { imageData: drawn[i].imageData }),
      ...(imagePath && { imagePath }),
    })),
  };
  return {
    data,
    title: storyboard.title,
    message: [
      `storyboard "${storyboard.id}" is ready with ${storyboard.totalPanels} panels; the cast is on the screen`,
      saved.length ? `character sheets saved to ${saved.join(", ")}` : "",
      missing.length
        ? `no sheet for ${missing.join("; ")}: they will be drawn from their description`
        : "",
      recorded ? "" : NOT_SAVED("storyboard"),
    ]
      .filter(Boolean)
      .join("; "),
    instructions: castShownInstructions(storyboard),
  };
}

// --- presentPanel --------------------------------------------------------------

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

async function presentPanel(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = parsePanelArgs(args);
  if (!parsed) return { message: PANEL_ARGS_ERROR };
  const storyboard = await loadRecord<Storyboard>(
    STORYBOARDS_DIR,
    parsed.storyboardId,
  );
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
  const settings = currentImageSettings();

  const unknown: string[] = [];
  const cast: { character: Character; sheet: SourceImage | null }[] = [];
  for (const name of parsed.characters) {
    const character = storyboard.characters.find((c) => sameName(c.name, name));
    if (!character) unknown.push(name);
    else if (!cast.some((c) => c.character === character)) {
      const sheet = character.imagePath
        ? await loadReference(character.imagePath)
        : null;
      cast.push({ character, sheet });
    }
  }
  const references = cast
    .map(({ sheet }) => sheet)
    .filter((sheet): sheet is SourceImage => !!sheet);
  const prompt = panelPrompt(
    storyboard,
    parsed,
    cast.map(({ character, sheet }) => ({ character, hasSheet: !!sheet })),
  );
  const image = await generateImage(prompt, settings, references);
  const { imageData, imagePath } = imageOf(image);
  // A failure keeps the image host's message and instructions.
  if (!imageData) return image;

  // Choices make the story interactive, whether or not defineStoryboard
  // said so (Gemini Live gave choices without it); none on the last panel.
  const choices =
    parsed.panel < storyboard.totalPanels && parsed.choices.length >= 2
      ? parsed.choices
      : [];
  const recorded = await updateRecord<Storyboard>(
    STORYBOARDS_DIR,
    storyboard.id,
    (saved) => {
      const latest = saved ?? storyboard;
      if (choices.length) latest.interactive = true;
      latest.panels[String(parsed.panel)] = {
        caption: parsed.caption,
        characters: cast.map(({ character }) => character.name),
        imagePrompt: parsed.imagePrompt,
        ...(imagePath && { imagePath }),
        ...(choices.length && { choices }),
      };
      return latest;
    },
  );

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
    data,
    title: parsed.caption || `Panel ${parsed.panel}`,
    message: [
      `panel ${parsed.panel} of ${storyboard.totalPanels} is on the screen`,
      imagePath ? `saved to ${imagePath}` : "",
      unknown.length
        ? `not in the cast, so drawn from the prompt alone: ${unknown.join(", ")}`
        : "",
      recorded ? "" : NOT_SAVED("storyboard"),
    ]
      .filter(Boolean)
      .join("; "),
    instructions: panelShownInstructions(storyboard, parsed.panel, choices),
  };
}

type SequenceHandler = (
  args: Record<string, unknown>,
  config?: unknown,
) => Promise<ToolResult>;

const HANDLERS: Readonly<Record<string, SequenceHandler>> = {
  [PRESENT_SLIDE]: presentSlide,
  [DEFINE_STORYBOARD]: defineStoryboard,
  [PRESENT_PANEL]: presentPanel,
};

/** Draw a step, where MulmoChat posts it to its server (postToServer). */
export function runSequenceTool(
  toolName: string,
  args: Record<string, unknown>,
  config?: unknown,
): Promise<ToolResult> {
  return HANDLERS[toolName](args, config);
}
