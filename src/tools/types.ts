import type { ToolPlugin as BaseToolPlugin } from "gui-chat-protocol/vue";

/** gui-chat-protocol's ToolPlugin as MulmoGlass registers it. */
export type ToolPlugin = BaseToolPlugin<unknown, unknown, object>;
