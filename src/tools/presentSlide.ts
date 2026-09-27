// presentSlide: one slide of a spoken slideshow, a generated picture per
// slide. The model calls it once per slide, in order, and explains each slide
// when it appears.
//
// Slideshows used to be generateImage calls with "Slide N of M" in the prompt,
// and the model sometimes ended a reply without calling the next one (about
// one run in three, on OpenAI Realtime and Grok). With the slide number and
// the total as arguments, the host knows where a slideshow is and can ask the
// model to go on (src/composables/useSequence.ts). The picture comes from the
// same context.app.generateImage as generateImage, and its View fits it on the
// screen (./sequence.ts; generateImage's own View renders only results named
// "generateImage").
//
// A slideshow is a presentation (the default: it goes on by itself) or a
// step-by-step guide (mode "steps": a how-to the user follows along with).
// A step waits for the user to say they're ready, is drawn with the previous
// step's picture as a reference so the object stays the same, and a step
// shown earlier ("go back to step 2") is shown again as it was, not redrawn.
import type { ToolResult } from "gui-chat-protocol/vue";
import type { ToolPlugin } from "./types";
import {
  createRepeatGuard,
  fittedImageView,
  imageOf,
  imagePreview,
  generateStepImage,
  userSpokeSince,
  type SequenceStep,
} from "./sequence";

export const PRESENT_SLIDE = "presentSlide";

type SlideMode = "presentation" | "steps";

export interface SlideArgs {
  slide: number;
  totalSlides: number;
  title: string;
  imagePrompt: string;
  mode: SlideMode;
}

/** The slide arguments, or null when the model sent something else. */
export function parseSlideArgs(
  args: Record<string, unknown>,
): SlideArgs | null {
  const { slide, totalSlides, title, imagePrompt } = args;
  if (
    typeof slide !== "number" ||
    typeof totalSlides !== "number" ||
    !Number.isInteger(slide) ||
    !Number.isInteger(totalSlides) ||
    slide < 1 ||
    totalSlides < slide ||
    typeof imagePrompt !== "string" ||
    !imagePrompt.trim()
  ) {
    return null;
  }
  return {
    slide,
    totalSlides,
    title: typeof title === "string" ? title : "",
    imagePrompt,
    mode: args.mode === "steps" ? "steps" : "presentation",
  };
}

const PRESENT_SLIDE_PROMPT =
  'When the user asks for a slideshow (or to explain something with slides), plan four to six slides, then show them one at a time with presentSlide: slide 1 first, and each next slide only after you have explained the one on the screen. Go on to the last slide without asking whether to continue. When the user wants to be shown how to do something they will do along with you (cooking, folding, fixing, an exercise), make it a step-by-step guide instead: mode "steps", one slide per step, and after each step wait for the user to say they are ready. Use generateImage for a single picture, not for slides.';

/** What the model does once a slide is on the screen. */
export const slideShownInstructions = ({
  slide,
  totalSlides,
  title,
  mode,
}: SlideArgs): string => {
  const titled = title ? ` ("${title}")` : "";
  if (mode === "steps") {
    const label = `Step ${slide} of ${totalSlides}${titled}`;
    return slide < totalSlides
      ? `${label} is now on the screen. Explain what to do in this step, then stop and wait while the user does it. When they say they're ready (next, done, go on), call presentSlide for step ${slide + 1} with mode "steps". If they ask to go back or to see a step again, call presentSlide for that step.`
      : `${label}, the last one, is now on the screen. Explain what to do, then wrap up the guide once the user is done.`;
  }
  const label = `Slide ${slide} of ${totalSlides}${titled}`;
  // The length of each explanation is the model's call: some slides need a
  // sentence, some a paragraph. The "stop" clause is for when the host missed
  // the user's speech (Gemini can report it too late): the model heard it.
  return slide < totalSlides
    ? `${label} is now on the screen. Explain it, then, in this same reply and without waiting for the user, call presentSlide for slide ${slide + 1}. If the user has asked you to stop, or asked something else, since the slideshow began, answer them instead of going on.`
    : `${label}, the last one, is now on the screen. Explain it, then wrap up the slideshow.`;
};

/** The slideshow's place after a slide was shown, or null. */
export function slideSequenceStep(
  args: Record<string, unknown>,
  result: ToolResult,
): SequenceStep | null {
  const slide = parseSlideArgs(args);
  if (!slide || !imageOf(result).imageData) return null;
  const { slide: step, totalSlides: total } = slide;
  if (slide.mode === "steps") {
    return {
      step,
      total,
      kind: "guide",
      label: `Step ${step} of ${total}`,
      onShown: "explain it",
      nextCall: `call presentSlide for step ${step + 1} of ${total} with mode "steps"`,
      waitsForUser: true,
    };
  }
  return {
    step,
    total,
    kind: "slideshow",
    label: `Slide ${step} of ${total}`,
    onShown: "explain it",
    nextCall: `call presentSlide for slide ${step + 1} of ${total}`,
  };
}

// An identical slide asked for twice (Gemini Live) is shown once.
const repeats = createRepeatGuard();

const slideKey = ({ slide, totalSlides, title, imagePrompt }: SlideArgs) =>
  JSON.stringify([slide, totalSlides, title, imagePrompt]);

// The step-by-step guide being shown: its steps so far, by number. Slides
// carry no ID, so a guide is known by its length and its first step's title:
// step 1 with another title, or another length, starts a new guide.
let guide: {
  totalSlides: number;
  firstTitle: string;
  steps: Map<number, ToolResult>;
  /** The step on the screen, or being made. */
  current: number;
  /** When the current step appeared. */
  shownAt: number;
} | null = null;

function guideFor(slide: SlideArgs) {
  const sameGuide =
    guide?.totalSlides === slide.totalSlides &&
    (slide.slide !== 1 || guide.firstTitle === slide.title);
  if (!guide || !sameGuide) {
    guide = {
      totalSlides: slide.totalSlides,
      firstTitle: slide.slide === 1 ? slide.title : "",
      steps: new Map(),
      current: 0,
      shownAt: -Infinity,
    };
  }
  return guide;
}

/** The prompt, and the reference pictures, for a slide. */
function slideImageRequest(slide: SlideArgs, previous?: ToolResult) {
  if (slide.mode !== "steps") {
    // The title leads the prompt as a slide's title, not as a bare sentence:
    // a question title first ("What is Photosynthesis?. A bright, sunny
    // day…") made Gemini return no image (finish reason NO_IMAGE) 4 times in
    // 12; framed like this, 0 in 12.
    const prompt = slide.title
      ? `A presentation slide titled "${slide.title}". ${slide.imagePrompt}`
      : slide.imagePrompt;
    return { prompt, references: [] };
  }
  const titled = slide.title ? `, "${slide.title}"` : "";
  const reference = previous && imageOf(previous).imageData;
  const prompt = [
    `An instructional illustration of step ${slide.slide} of ${slide.totalSlides}${titled}. ${slide.imagePrompt}`,
    reference
      ? "The reference image is the previous step: keep the same objects, hands, tools and setting, and show what this step changes."
      : "",
    "Show the action clearly, with little or no text.",
  ]
    .filter(Boolean)
    .join(" ");
  return { prompt, references: reference ? [reference] : [] };
}

const plugin: ToolPlugin = {
  toolDefinition: {
    type: "function",
    name: PRESENT_SLIDE,
    description:
      'Show one slide of a slideshow: a picture generated from imagePrompt, full screen. Call it once per slide, in order, starting with slide 1. With mode "steps" it is a step-by-step guide: one slide per step, and the next step waits for the user.',
    parameters: {
      type: "object",
      properties: {
        slide: {
          type: "integer",
          description: "This slide's number, starting at 1.",
        },
        totalSlides: {
          type: "integer",
          description:
            "How many slides the slideshow has. Keep it the same for every slide.",
        },
        title: { type: "string", description: "The slide's title." },
        imagePrompt: {
          type: "string",
          description:
            "The picture for this slide: a clear illustration or diagram of its point, with the title as its only large text. Be concrete. For a step, show the action: hands, tools and the object.",
        },
        mode: {
          type: "string",
          enum: ["presentation", "steps"],
          description:
            '"presentation" (the default) goes on by itself; "steps" is a how-to the user does along with you, and waits for them after each step. Keep it the same for every slide.',
        },
      },
      required: ["slide", "totalSlides", "title", "imagePrompt"],
    },
  },
  systemPrompt: PRESENT_SLIDE_PROMPT,
  generatingMessage: "Making the slide...",
  isEnabled: () => true,
  viewComponent: fittedImageView("PresentSlideView"),
  previewComponent: imagePreview("PresentSlidePreview"),
  async execute(context, args) {
    const slide = parseSlideArgs(args as Record<string, unknown>);
    if (!slide) {
      return {
        message:
          "presentSlide needs slide and totalSlides (whole numbers, slide from 1 to totalSlides) and an imagePrompt",
      };
    }
    const app = context.app;
    if (!app?.generateImage) {
      return { message: "image generation isn't available" };
    }
    const steps = slide.mode === "steps" ? guideFor(slide) : null;
    // A guide waits for the user. Gemini Live sometimes went on to the next
    // step in the reply that explained the current one, whatever the
    // instructions said; the host holds such a step back.
    if (
      steps &&
      slide.slide > steps.current &&
      steps.current > 0 &&
      !userSpokeSince(steps.shownAt)
    ) {
      console.info(`[sequence] holding step ${slide.slide} for the user`);
      return {
        // No instructions: they would start another reply, and the status
        // says what to do.
        message: `step ${slide.slide} was not shown: the user hasn't said they're ready yet, and step ${steps.current} is still on the screen. Wait for them before calling presentSlide for step ${slide.slide}.`,
        cancelled: true,
      };
    }
    const earlier = steps?.steps.get(slide.slide);
    if (steps && earlier) {
      if (steps.current === slide.slide) {
        // It is on the screen; the model explains it again by itself.
        return {
          message: `step ${slide.slide} of ${slide.totalSlides} is already on the screen`,
          cancelled: true,
        };
      }
      // Going back (or forward again): the step as it was, at once.
      steps.current = slide.slide;
      steps.shownAt = performance.now();
      return {
        ...earlier,
        uuid: undefined,
        message: `step ${slide.slide} of ${slide.totalSlides} is on the screen again, as it was`,
        instructions: slideShownInstructions(slide),
      };
    }
    const key = slideKey(slide);
    if (await repeats.alreadyShown(key)) {
      // Not shown again, and no instructions: the model goes on by itself.
      return {
        message: `slide ${slide.slide} of ${slide.totalSlides} is already on the screen`,
        cancelled: true,
      };
    }
    const settle = repeats.begin(key);
    if (steps) steps.current = slide.slide;
    const { prompt, references } = slideImageRequest(
      slide,
      steps?.steps.get(slide.slide - 1),
    );
    const image = await generateStepImage(app, prompt, references);
    const { imageData, imagePath } = imageOf(image);
    // A failure keeps the image host's message and instructions, and may be
    // tried again.
    settle(!!imageData);
    if (!imageData) return image;
    if (steps) {
      steps.steps.set(slide.slide, image);
      steps.shownAt = performance.now();
    }
    // The image host saved the picture (artifacts/images/…); say where.
    const savedTo = imagePath ? `; saved to ${imagePath}` : "";
    const noun = steps ? "step" : "slide";
    return {
      ...image,
      message: `${noun} ${slide.slide} of ${slide.totalSlides} is on the screen${savedTo}`,
      instructions: slideShownInstructions(slide),
    };
  },
};

export const PresentSlidePlugin = { plugin };
