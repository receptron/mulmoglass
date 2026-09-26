// Keeps a spoken slideshow going. The model shows slides one at a time with
// presentSlide (src/tools/presentSlide.ts) and is told, with each slide, to
// explain it and call the next one in the same reply. It sometimes ends the
// reply without doing that, so when a reply is over, nothing is playing or
// running and slides are left, the host asks it once to go on.
//
// Asked once per slide: a model that still doesn't go on has a reason (it is
// answering something else), and asking again would loop. The user speaking
// ends the tracking: they may have said "stop", and if they said "go on", the
// next slide starts it again. Speech can be noticed late (Gemini's transcript
// of it arrives seconds after), so the request itself also defers to the user.
import type { ToolResult } from "gui-chat-protocol/vue";
import {
  PRESENT_SLIDE,
  parseSlideArgs,
  slideAfterUserSpokeInstructions,
} from "../tools/presentSlide";

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
  // When tracking last stopped. A slide whose call started before that (the
  // user interrupted while its picture was being made) doesn't start it again.
  let stoppedAt = -Infinity;

  const cancelCheck = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const stop = () => {
    progress = null;
    stoppedAt = performance.now();
    cancelCheck();
  };

  /** Every tool result; only presentSlide's matter. Returns instructions
   *  that replace the result's, for a slide asked for before the user spoke:
   *  its own say to go on, which Gemini and Grok did right after saying they
   *  had stopped. */
  const observeToolResult = (
    name: string,
    args: Record<string, unknown>,
    result: ToolResult,
    startedAt: number,
  ): string | undefined => {
    // A duplicate slide (see presentSlide.ts) changes nothing.
    if (name !== PRESENT_SLIDE || result.cancelled) return undefined;
    const slide = parseSlideArgs(args);
    const shown =
      typeof (result.data as { imageData?: unknown } | undefined)?.imageData ===
      "string";
    if (startedAt <= stoppedAt) {
      // A slide that failed keeps its failure's instructions.
      return slide && shown
        ? slideAfterUserSpokeInstructions(slide)
        : undefined;
    }
    // A slide that failed (no key, a refused prompt) would fail again.
    if (!slide || !shown || slide.slide >= slide.totalSlides) {
      stop();
      return undefined;
    }
    // A check set before this slide arrived would ask for the slide its own
    // instructions are about to ask for.
    cancelCheck();
    progress = { shown: slide.slide, total: slide.totalSlides, asked: false };
    return undefined;
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
        `Continue the slideshow: call presentSlide for slide ${next} of ${progress.total} now, and explain it when it appears. If the user has just asked you to stop or asked something else, answer them instead.`,
      );
    }, GRACE_MS);
  };

  return { observeToolResult, replyEnded, stop };
}
