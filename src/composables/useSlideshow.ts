// Keeps a spoken slideshow going. The model shows slides one at a time with
// presentSlide (src/tools/presentSlide.ts) and is told, with each slide, to
// explain it and call the next one in the same reply. It sometimes ends the
// reply without doing that, so when a reply is over, nothing is playing or
// running and slides are left, the host asks it once to go on.
//
// Asked once per slide: a model that still doesn't go on has a reason (it is
// answering something else), and asking again would loop. The user speaking
// ends the tracking: they may have said "stop", and if they said "go on", the
// next slide starts it again.
import type { ToolResult } from "gui-chat-protocol/vue";
import { PRESENT_SLIDE, parseSlideArgs } from "../tools/presentSlide";

interface UseSlideshowOptions {
  /** No reply running, no audio playing, no tool running, user silent. */
  isIdle: () => boolean;
  sendInstructions: (instructions: string) => boolean;
}

// After a reply ends, how long to wait for the model to go on by itself.
const GRACE_MS = 2000;

export function useSlideshow(options: UseSlideshowOptions) {
  let progress: { shown: number; total: number; asked: boolean } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancelCheck = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const stop = () => {
    progress = null;
    cancelCheck();
  };

  /** Every tool result; only presentSlide's matter. */
  const observeToolResult = (
    name: string,
    args: Record<string, unknown>,
    result: ToolResult,
  ) => {
    // A duplicate slide (see presentSlide.ts) changes nothing.
    if (name !== PRESENT_SLIDE || result.cancelled) return;
    const slide = parseSlideArgs(args);
    const shown =
      typeof (result.data as { imageData?: unknown } | undefined)?.imageData ===
      "string";
    // A slide that failed (no key, a refused prompt) would fail again.
    if (!slide || !shown || slide.slide >= slide.totalSlides) {
      stop();
      return;
    }
    progress = { shown: slide.slide, total: slide.totalSlides, asked: false };
  };

  /** The model's reply or its audio ended: check whether it went on. */
  const replyEnded = () => {
    if (!progress || progress.asked) return;
    cancelCheck();
    timer = setTimeout(() => {
      timer = null;
      if (!progress || progress.asked || !options.isIdle()) return;
      progress.asked = true;
      const next = progress.shown + 1;
      console.info(`[slideshow] asking for slide ${next} of ${progress.total}`);
      options.sendInstructions(
        `Continue the slideshow: call presentSlide for slide ${next} of ${progress.total} now, and explain it when it appears.`,
      );
    }, GRACE_MS);
  };

  return { observeToolResult, replyEnded, stop };
}
