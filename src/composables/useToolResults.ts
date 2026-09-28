// Runs the model's tool calls and keeps their results. Adapted from MulmoChat's
// src/composables/useToolResults.ts, without the sidebar, text messages,
// uploads or the "suppress instructions" setting: MulmoGlass is voice only,
// so a tool's follow-up instructions always go back to the model.
import { computed, ref } from "vue";
import type { ToolResult } from "gui-chat-protocol/vue";
import { getToolPlugin, toolExecute } from "../tools";
import type { ToolCallMessage } from "../voice/types";

interface UseToolResultsOptions {
  sendFunctionCallOutput: (callId: string, output: string) => boolean;
  sendInstructions: (instructions: string) => boolean;
  isConnected: () => boolean;
  /** Every result, before its instructions go to the model, with when its
   *  call started (Date.now(), as gui-chat-protocol's sequence keeper
   *  takes it). Returns instructions to send instead of the result's, or
   *  undefined to keep them. */
  onResult?: (result: ToolResult, startedAt: number) => string | undefined;
  /** When the user last spoke (Date.now()), for ToolContext.userSpokeAt. */
  getUserSpokeAt?: () => number | undefined;
  /** Resolves when the model's voice has finished playing (at once when it
   *  isn't playing). */
  waitForSpeechEnd?: () => Promise<void>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Every tool call is logged (console, "[tool]") so a session can be debugged
// from the browser's devtools, remotely on a headset too: what the model
// called, with which arguments, and what went back to it.
// The line carries a JSON summary (readable wherever the console is captured
// as text); the object after it expands in devtools.
const LOG_SUMMARY_MAX = 500;
const logTool = (event: string, name: string, detail: unknown) => {
  let summary: string;
  try {
    summary = JSON.stringify(detail) ?? "";
  } catch {
    summary = String(detail);
  }
  if (summary.length > LOG_SUMMARY_MAX) {
    summary = `${summary.slice(0, LOG_SUMMARY_MAX)}…`;
  }
  console.info(`[tool] ${event} ${name} ${summary}`, detail);
};

export function useToolResults(options: UseToolResultsOptions) {
  const results = ref<ToolResult[]>([]);
  const selectedIndex = ref(-1);
  const runningMessage = ref("");

  const selectedResult = computed<ToolResult | null>(
    () => results.value[selectedIndex.value] ?? null,
  );

  const sendOutput = (callId: string | undefined, payload: unknown) => {
    if (callId) options.sendFunctionCallOutput(callId, JSON.stringify(payload));
  };

  const addOrUpdate = (result: ToolResult, previous: ToolResult | null) => {
    if (previous && result.updating && result.toolName === previous.toolName) {
      const index = results.value.findIndex((r) => r.uuid === previous.uuid);
      if (index !== -1) {
        results.value[index] = result;
        selectedIndex.value = index;
        return;
      }
    }
    results.value.push(result);
    selectedIndex.value = results.value.length - 1;
  };

  const handleToolCall = async (msg: ToolCallMessage, argStr: string) => {
    const plugin = getToolPlugin(msg.name);
    runningMessage.value = plugin?.generatingMessage || "Working...";
    const started = Date.now();
    try {
      const args = argStr ? JSON.parse(argStr) : {};
      logTool("call", msg.name, args);
      if (plugin?.waitingMessage && options.isConnected()) {
        options.sendInstructions(plugin.waitingMessage);
      }
      const previous = selectedResult.value;
      const result = await toolExecute(
        msg.name,
        args,
        previous,
        options.getUserSpokeAt?.(),
      );
      // A step of a sequence (a slide, a story panel) is shown, and goes back
      // to the model, when the model has finished talking about the step
      // before. The model asks for the next step at the end of its reply,
      // long before the reply's audio has played, so a step drawn faster
      // than that audio otherwise appeared while it was still talking about
      // the one before (MulmoChat with Grok: slides 2 to 4 of 4). The same
      // as MulmoChat's useToolResults.
      if (result.sequence && !result.cancelled) {
        await options.waitForSpeechEnd?.();
      }
      logTool("result", msg.name, {
        ms: Date.now() - started,
        message: result.message,
        instructions: result.instructions,
        jsonData: result.jsonData,
        cancelled: result.cancelled,
      });
      if (!result.cancelled) addOrUpdate(result, previous);
      const instructions =
        options.onResult?.(result, started) ?? result.instructions;
      sendOutput(msg.call_id, {
        status: result.message,
        data: result.jsonData,
      });
      if (instructions) {
        if (plugin?.delayAfterExecution) {
          await sleep(plugin.delayAfterExecution);
        }
        options.sendInstructions(instructions);
      }
    } catch (error) {
      const message = `Tool execution failed: ${error}`;
      console.error(`[tool] failed ${msg.name}`, error, { args: argStr });
      sendOutput(msg.call_id, message);
      options.sendInstructions(
        `The previous tool call for "${msg.name}" failed with error: ${error}. Please analyze the error and try an appropriate solution.`,
      );
    } finally {
      runningMessage.value = "";
    }
  };

  // A View edited its own result (e.g. a game move).
  const updateResult = (updated: ToolResult) => {
    const index = results.value.findIndex((r) => r.uuid === updated.uuid);
    if (index !== -1) Object.assign(results.value[index], updated);
  };

  const select = (index: number) => {
    if (index >= 0 && index < results.value.length) selectedIndex.value = index;
  };

  const clear = () => {
    results.value = [];
    selectedIndex.value = -1;
  };

  return {
    results,
    selectedIndex,
    selectedResult,
    runningMessage,
    handleToolCall,
    updateResult,
    select,
    clear,
  };
}
