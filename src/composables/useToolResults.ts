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
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
    try {
      const args = argStr ? JSON.parse(argStr) : {};
      if (plugin?.waitingMessage && options.isConnected()) {
        options.sendInstructions(plugin.waitingMessage);
      }
      const previous = selectedResult.value;
      const result = await toolExecute(msg.name, args, previous);
      if (!result.cancelled) addOrUpdate(result, previous);
      sendOutput(msg.call_id, {
        status: result.message,
        data: result.jsonData,
      });
      if (result.instructions) {
        if (plugin?.delayAfterExecution) {
          await sleep(plugin.delayAfterExecution);
        }
        options.sendInstructions(result.instructions);
      }
    } catch (error) {
      const message = `Tool execution failed: ${error}`;
      console.error(message);
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
