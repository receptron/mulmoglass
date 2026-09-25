// The contract the three voice transports share (OpenAI Realtime, Gemini Live,
// Grok Voice). Adapted from MulmoChat's useRealtimeSession.ts. MulmoGlass is
// voice only: there is no text message path and no text transport.
import type { Ref } from "vue";

/** A tool call as the transports report it (OpenAI Realtime's event shape). */
export interface ToolCallMessage {
  type: string;
  name: string;
  call_id?: string;
}

export interface VoiceSessionEventHandlers {
  onToolCall?: (
    msg: ToolCallMessage,
    id: string,
    argStr: string,
  ) => void | Promise<void>;
  onConversationStarted?: () => void;
  onConversationFinished?: () => void;
  // The user's speech (microphone voice activity)
  onSpeechStarted?: () => void;
  onSpeechStopped?: () => void;
  // The model's audio playback
  onAudioPlaybackStarted?: () => void;
  onAudioPlaybackStopped?: () => void;
  // Captions: a transcript of what the model says (delta, then done)
  onTranscriptDelta?: (delta: string) => void;
  onTranscriptDone?: () => void;
  onError?: (error: unknown) => void;
}

export interface VoiceSessionOptions {
  buildInstructions: () => string;
  buildTools: () => unknown[];
  getModelId: () => string;
  /** The user's key for this provider (Settings). */
  getApiKey: () => string;
  handlers?: VoiceSessionEventHandlers;
}

export interface VoiceSession {
  chatActive: Ref<boolean>;
  conversationActive: Ref<boolean>;
  connecting: Ref<boolean>;
  isMuted: Ref<boolean>;
  isConnected: () => boolean;
  startChat: () => Promise<void>;
  stopChat: () => void;
  sendFunctionCallOutput: (callId: string, output: string) => boolean;
  /** A message from a plugin View (a quiz answer, a game move), sent as the
   *  user; starts the model's reply. Not typed by the user: MulmoGlass has no
   *  text input. */
  sendUserText: (text: string) => boolean;
  /** A follow-up for the model after a tool output; starts its reply. */
  sendInstructions: (instructions: string) => boolean;
  setMute: (muted: boolean) => void;
  attachRemoteAudioElement: (audio: HTMLAudioElement | null) => void;
  registerEventHandlers: (handlers: Partial<VoiceSessionEventHandlers>) => void;
}
