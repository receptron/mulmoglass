// What slideshows (presentSlide) and storyboards (defineStoryboard,
// presentPanel) share: numbered steps the model shows one at a time, each a
// generated picture, which the host keeps going (src/composables/useSequence.ts). The tools that are
// sequences are listed in ./sequences.ts.
import { defineComponent, h, markRaw, type PropType } from "vue";
import type { ToolResult } from "gui-chat-protocol/vue";
import {
  ImagePreview,
  type ImageToolData,
  type ToolResult as ImageResult,
} from "@mulmochat-plugin/ui-image";

/** Where a sequence is after a step was shown. */
export interface SequenceStep {
  /** 0 for a storyboard's cast, which comes before its first panel. */
  step: number;
  total: number;
  /** "slideshow" or "story", for what the host says to the model. */
  kind: string;
  /** What is on the screen: "Slide 2 of 5". */
  label: string;
  /** What the model does with it: "explain it". */
  onShown: string;
  /** The call for the next step: `call presentSlide for slide 3 of 5`. */
  nextCall: string;
}

/** For a step that arrived after the user spoke (asked while they did). */
export const stepAfterUserSpokeInstructions = ({
  label,
  kind,
}: SequenceStep): string =>
  `${label} is now on the screen, but the user spoke while it was being made. Respond to what they said; go on with the ${kind} only if they want you to.`;

/** The host's request to go on, when the model ended a reply mid-sequence. */
export const continueInstructions = ({
  kind,
  nextCall,
  onShown,
}: SequenceStep) =>
  `Continue the ${kind}: ${nextCall} now, and ${onShown} when it appears. If the user has just asked you to stop or asked something else, answer them instead.`;

// context.app.generateImage is typed as returning unknown.
export const isToolResult = (value: unknown): value is ToolResult =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { message?: unknown }).message === "string";

/** A generated image's result, whatever the image host returned. */
export async function imageResult(
  generate: () => unknown,
): Promise<ToolResult> {
  try {
    const generated = await generate();
    return isToolResult(generated)
      ? generated
      : { message: "image generation returned an unrecognized result" };
  } catch (error) {
    return { message: `image generation failed: ${String(error)}` };
  }
}

/** The picture a result carries, and where it was saved. */
export function imageOf(result: ToolResult): {
  imageData?: string;
  imagePath?: string;
} {
  const data = result.data as
    { imageData?: unknown; imagePath?: unknown } | undefined;
  return {
    imageData: typeof data?.imageData === "string" ? data.imageData : undefined,
    imagePath: typeof data?.imagePath === "string" ? data.imagePath : undefined,
  };
}

// Gemini Live sometimes calls the next step twice: once in the reply it
// starts by itself after the tool output, once in the reply the instructions
// start. The two calls are identical, so a step asked for in the last minute
// with the same arguments is not made again; a later "show slide 2 again" is
// outside the minute. A repeat that arrives while the first is still being
// made waits for it: it may yet fail.
const DUPLICATE_WINDOW_MS = 60_000;

/** Drops a repeat of a request made in the last minute. */
export function createRepeatGuard() {
  const recent = new Map<string, { at: number; shown: Promise<boolean> }>();

  /** Whether an identical recent request showed its picture. */
  const alreadyShown = async (key: string): Promise<boolean> => {
    const now = Date.now();
    for (const [k, entry] of recent) {
      if (now - entry.at > DUPLICATE_WINDOW_MS) recent.delete(k);
    }
    const earlier = recent.get(key);
    return !!earlier && (await earlier.shown);
  };

  /** Start a request; call the result with whether it was shown. A failed
   *  one may be tried again. */
  const begin = (key: string): ((shown: boolean) => void) => {
    let settle: (shown: boolean) => void = () => {};
    const shown = new Promise<boolean>((resolve) => (settle = resolve));
    recent.set(key, { at: Date.now(), shown });
    return (wasShown) => {
      if (!wasShown && recent.get(key)?.shown === shown) recent.delete(key);
      settle(wasShown);
    };
  };

  return { alreadyShown, begin };
}

/**
 * A View that fits the whole picture on the screen, as a slide or a panel
 * should be seen (ui-image's ImageView, which generateImage's View uses, fits
 * a wide picture to the width and scrolls), with an optional caption under it.
 */
export function fittedImageView(
  name: string,
  captionOf: (data: Record<string, unknown>) => string = () => "",
) {
  return markRaw(
    defineComponent({
      name,
      props: {
        selectedResult: {
          type: Object as PropType<ImageResult<ImageToolData>>,
          required: true,
        },
      },
      setup(props) {
        return () => {
          const data = props.selectedResult.data;
          if (!data?.imageData) return h("div", { class: "h-full bg-white" });
          const caption = captionOf(data as unknown as Record<string, unknown>);
          return h(
            "div",
            { class: "h-full w-full flex flex-col bg-white p-2 gap-2" },
            [
              h(
                "div",
                {
                  class: "flex-1 min-h-0 flex items-center justify-center",
                },
                [
                  h("img", {
                    src: data.imageData,
                    alt: data.prompt ?? "",
                    class: "max-w-full max-h-full object-contain",
                  }),
                ],
              ),
              caption
                ? h(
                    "p",
                    { class: "text-center text-lg text-gray-800 px-4 pb-2" },
                    caption,
                  )
                : null,
            ],
          );
        };
      },
    }),
  );
}

/** ui-image's thumbnail of the result's picture. */
export function imagePreview(name: string) {
  return markRaw(
    defineComponent({
      name,
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
}
