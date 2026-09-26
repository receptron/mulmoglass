// presentSlide: one slide of a spoken slideshow, a generated picture per
// slide. The model calls it once per slide, in order, and explains each slide
// when it appears.
//
// Slideshows used to be generateImage calls with "Slide N of M" in the prompt,
// and the model sometimes ended a reply without calling the next one (about
// one run in three, on OpenAI Realtime and Grok). With the slide number and
// the total as arguments, the host knows where a slideshow is and can ask the
// model to go on (src/composables/useSlideshow.ts). The picture comes from the
// same context.app.generateImage as generateImage. Its View fits the whole
// picture on the screen, as a slide should be seen (ui-image's ImageView,
// which generateImage's View uses, fits a wide picture to the width and
// scrolls; generateImage's own View renders only results named
// "generateImage").
import { defineComponent, h, markRaw, type PropType } from "vue";
import type { ToolResult } from "gui-chat-protocol/vue";
import {
  ImagePreview,
  type ImageToolData,
  type ToolResult as ImageResult,
} from "@mulmochat-plugin/ui-image";
import type { ToolPlugin } from "./types";

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
  return slide < totalSlides
    ? `${label} is now on the screen. Explain it in two or three sentences, then, in this same reply and without waiting for the user, call presentSlide for slide ${slide + 1}.`
    : `${label}, the last one, is now on the screen. Explain it in two or three sentences, then wrap up the slideshow briefly.`;
};

// Gemini Live sometimes calls the next slide twice: once in the reply it
// starts by itself after the tool output, once in the reply the instructions
// start. A slide shown (or being made) in the last minute with the same
// number, total and title is not made again; a later "show slide 2 again"
// still works.
const DUPLICATE_WINDOW_MS = 60_000;
const recentSlides = new Map<string, number>();

const slideKey = ({ slide, totalSlides, title }: SlideArgs) =>
  `${slide}/${totalSlides}/${title}`;

function isDuplicate(key: string): boolean {
  const now = Date.now();
  for (const [k, at] of recentSlides) {
    if (now - at > DUPLICATE_WINDOW_MS) recentSlides.delete(k);
  }
  return recentSlides.has(key);
}

const View = markRaw(
  defineComponent({
    name: "PresentSlideView",
    props: {
      selectedResult: {
        type: Object as PropType<ImageResult<ImageToolData>>,
        required: true,
      },
    },
    setup(props) {
      return () =>
        h(
          "div",
          {
            class:
              "h-full w-full flex items-center justify-center bg-white p-2",
          },
          props.selectedResult.data?.imageData
            ? [
                h("img", {
                  src: props.selectedResult.data.imageData,
                  alt: props.selectedResult.data.prompt ?? "",
                  class: "max-w-full max-h-full object-contain",
                }),
              ]
            : [],
        );
    },
  }),
);

const Preview = markRaw(
  defineComponent({
    name: "PresentSlidePreview",
    props: {
      result: {
        type: Object as PropType<ImageResult<ImageToolData>>,
        required: true,
      },
    },
    setup(props) {
      return () => h(ImagePreview, { result: props.result });
    },
  }),
);

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
  viewComponent: View,
  previewComponent: Preview,
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
    if (isDuplicate(key)) {
      // Not shown again, and no instructions: the model goes on by itself.
      return {
        message: `slide ${slide.slide} of ${slide.totalSlides} is already on the screen`,
        cancelled: true,
      };
    }
    recentSlides.set(key, Date.now());
    const prompt = slide.title
      ? `${slide.title}. ${slide.imagePrompt}`
      : slide.imagePrompt;
    const image: ToolResult = await context.app.generateImage(prompt);
    const data = image.data as { imageData?: unknown } | undefined;
    // A failure keeps the image host's message and instructions, and may be
    // tried again.
    if (typeof data?.imageData !== "string") {
      recentSlides.delete(key);
      return image;
    }
    return {
      ...image,
      message: `slide ${slide.slide} of ${slide.totalSlides} is on the screen`,
      instructions: slideShownInstructions(slide),
    };
  },
};

export const PresentSlidePlugin = { plugin };
