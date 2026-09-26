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
import type { ToolResult } from "gui-chat-protocol/vue";
import type { ToolPlugin } from "./types";
import {
  createRepeatGuard,
  fittedImageView,
  imageOf,
  imagePreview,
  imageResult,
  type SequenceStep,
} from "./sequence";

export const PRESENT_SLIDE = "presentSlide";

export interface SlideArgs {
  slide: number;
  totalSlides: number;
  title: string;
  imagePrompt: string;
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
  };
}

const PRESENT_SLIDE_PROMPT =
  "When the user asks for a slideshow (or to explain something with slides), plan four to six slides, then show them one at a time with presentSlide: slide 1 first, and each next slide only after you have explained the one on the screen. Go on to the last slide without asking whether to continue. Use generateImage for a single picture, not for slides.";

/** What the model does once a slide is on the screen. */
export const slideShownInstructions = ({
  slide,
  totalSlides,
  title,
}: SlideArgs): string => {
  const titled = title ? ` ("${title}")` : "";
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

const plugin: ToolPlugin = {
  toolDefinition: {
    type: "function",
    name: PRESENT_SLIDE,
    description:
      "Show one slide of a slideshow: a picture generated from imagePrompt, full screen. Call it once per slide, in order, starting with slide 1.",
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
            "The picture for this slide: a clear illustration or diagram of its point, with the title as its only large text. Be concrete.",
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
    if (!context.app?.generateImage) {
      return { message: "image generation isn't available" };
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
    // The title leads the prompt as a slide's title, not as a bare sentence:
    // a question title first ("What is Photosynthesis?. A bright, sunny
    // day…") made Gemini return no image (finish reason NO_IMAGE) 4 times in
    // 12; framed like this, 0 in 12.
    const prompt = slide.title
      ? `A presentation slide titled "${slide.title}". ${slide.imagePrompt}`
      : slide.imagePrompt;
    const generateImage = context.app.generateImage;
    const image = await imageResult(() => generateImage(prompt));
    const { imageData, imagePath } = imageOf(image);
    // A failure keeps the image host's message and instructions, and may be
    // tried again.
    settle(!!imageData);
    if (!imageData) return image;
    // The image host saved the picture (artifacts/images/…); say where.
    const savedTo = imagePath ? `; saved to ${imagePath}` : "";
    return {
      ...image,
      message: `slide ${slide.slide} of ${slide.totalSlides} is on the screen${savedTo}`,
      instructions: slideShownInstructions(slide),
    };
  },
};

export const PresentSlidePlugin = { plugin };
