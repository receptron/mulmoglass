// The tools that show a sequence the host keeps going
// (src/composables/useSequence.ts), and where each result leaves it.
import type { ToolResult } from "gui-chat-protocol/vue";
import type { SequenceStep } from "./sequence";
import { PRESENT_SLIDE, slideSequenceStep } from "./presentSlide";
import {
  DEFINE_STORYBOARD,
  PRESENT_PANEL,
  storyboardSequenceStep,
} from "./storyboard";

const SEQUENCES: Readonly<
  Record<
    string,
    (args: Record<string, unknown>, result: ToolResult) => SequenceStep | null
  >
> = {
  [PRESENT_SLIDE]: slideSequenceStep,
  [DEFINE_STORYBOARD]: (_, result) =>
    storyboardSequenceStep(DEFINE_STORYBOARD, result),
  [PRESENT_PANEL]: (_, result) => storyboardSequenceStep(PRESENT_PANEL, result),
};

export const isSequenceTool = (name: string): boolean => name in SEQUENCES;

/** Where the sequence is after this result: null when the tool's arguments
 *  were wrong or its picture wasn't made. */
export const sequenceStepOf = (
  name: string,
  args: Record<string, unknown>,
  result: ToolResult,
): SequenceStep | null => SEQUENCES[name]?.(args, result) ?? null;
