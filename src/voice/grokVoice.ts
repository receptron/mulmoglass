/* global WebSocket, CloseEvent */

// Grok voice (xAI's Voice Agent API). Adapted from MulmoChat's
// src/composables/useGrokVoiceSession.ts. The events are OpenAI Realtime's
// (session.update, conversation.item.create, response.create,
// response.function_call_arguments.done, …); the transport is a WebSocket with
// PCM16 audio as base64 JSON. The short-lived client secret is minted here
// with the user's own key (POST /v1/realtime/client_secrets allows browser
// calls) instead of by a server.

import { ref } from "vue";
import type {
  VoiceSession,
  VoiceSessionEventHandlers,
  VoiceSessionOptions,
} from "./types";
import { AudioStreamManager } from "../audio/audioStreamManager";

const GROK_REALTIME_URL = "wss://api.x.ai/v1/realtime";
const GROK_CLIENT_SECRETS_URL = "https://api.x.ai/v1/realtime/client_secrets";
// It only has to last until the WebSocket opens.
const CLIENT_SECRET_TTL_SECONDS = 300;
const GROK_VOICE = "eve";
// Microphone audio sent to Grok; its replies come back at the rate
// AudioStreamManager plays by default.
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;

interface GrokState {
  ws: WebSocket | null;
  localStream: MediaStream | null;
  audioManager: AudioStreamManager | null;
}

interface GrokServerEvent {
  type: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  delta?: string;
  error?: unknown;
}

async function mintClientSecret(apiKey: string): Promise<string> {
  const response = await fetch(GROK_CLIENT_SECRETS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      expires_after: { seconds: CLIENT_SECRET_TTL_SECONDS },
    }),
  });
  if (!response.ok) {
    throw new Error(`xAI: ${response.status} ${await response.text()}`);
  }
  const data = (await response.json()) as { value?: unknown };
  if (typeof data.value !== "string") {
    throw new Error("xAI returned no client secret");
  }
  return data.value;
}

export function useGrokVoice(options: VoiceSessionOptions): VoiceSession {
  let handlers: VoiceSessionEventHandlers = {
    ...(options.handlers ?? {}),
  };

  const registerEventHandlers = (
    newHandlers: Partial<VoiceSessionEventHandlers>,
  ) => {
    handlers = {
      ...handlers,
      ...newHandlers,
    };
  };

  const chatActive = ref(false);
  const conversationActive = ref(false);
  const connecting = ref(false);
  const isMuted = ref(false);
  const processedToolCalls = new Set<string>();

  const grok: GrokState = {
    ws: null,
    localStream: null,
    audioManager: null,
  };

  // A response is running from response.create (or the server's own VAD turn)
  // until response.done. Another response.create in that window is held and
  // sent after it, once: several tool outputs get one follow-up response.
  let responseActive = false;
  let responseHeld = false;
  // response.create sent, response.created not seen yet. If Grok answers it
  // with an error instead, no response.done follows.
  let responseRequested = false;

  const sendWebSocketMessage = (message: unknown): boolean => {
    if (!grok.ws || grok.ws.readyState !== WebSocket.OPEN) {
      console.warn("Cannot send message because WebSocket is not open.");
      return false;
    }
    grok.ws.send(JSON.stringify(message));
    return true;
  };

  const requestResponse = (): boolean => {
    if (responseActive) {
      responseHeld = true;
      return true;
    }
    responseActive = true;
    responseRequested = true;
    return sendWebSocketMessage({ type: "response.create" });
  };

  const addUserText = (text: string) =>
    sendWebSocketMessage({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    });

  const handleToolCall = async (event: GrokServerEvent) => {
    const callId = event.call_id;
    if (!callId || !event.name || processedToolCalls.has(callId)) return;
    processedToolCalls.add(callId);
    await handlers.onToolCall?.(
      {
        type: "response.function_call_arguments.done",
        call_id: callId,
        name: event.name,
      },
      callId,
      event.arguments ?? "{}",
    );
  };

  const handleWebSocketMessage = async (message: MessageEvent) => {
    let event: GrokServerEvent;
    try {
      event = JSON.parse(message.data as string) as GrokServerEvent;
    } catch (error) {
      console.error("Failed to parse Grok message:", error);
      handlers.onError?.(error);
      return;
    }

    switch (event.type) {
      case "error":
        console.error("Grok voice error:", event.error);
        if (responseRequested) {
          responseRequested = false;
          responseActive = false;
          responseHeld = false;
        }
        handlers.onError?.(event.error);
        break;
      case "response.output_audio.delta":
        if (event.delta) grok.audioManager?.queueAudio(event.delta);
        break;
      case "response.created":
        responseActive = true;
        responseRequested = false;
        conversationActive.value = true;
        handlers.onConversationStarted?.();
        break;
      case "response.done":
        responseActive = false;
        conversationActive.value = false;
        handlers.onConversationFinished?.();
        if (responseHeld) {
          responseHeld = false;
          requestResponse();
        }
        break;
      case "response.output_audio_transcript.delta":
        handlers.onTranscriptDelta?.(event.delta ?? "");
        break;
      case "response.output_audio_transcript.done":
        handlers.onTranscriptDone?.();
        break;
      case "response.function_call_arguments.done":
        await handleToolCall(event);
        break;
      case "input_audio_buffer.speech_started":
        // The user talks over the reply: stop playing what is queued.
        grok.audioManager?.stopPlayback();
        handlers.onSpeechStarted?.();
        break;
      case "input_audio_buffer.speech_stopped":
        handlers.onSpeechStopped?.();
        break;
    }
  };

  const handleWebSocketOpen = (
    instructions: string,
    tools: unknown[],
  ): void => {
    // Connected only now: text sent before the socket opens would be lost.
    chatActive.value = true;
    connecting.value = false;
    sendWebSocketMessage({
      type: "session.update",
      session: {
        voice: GROK_VOICE,
        instructions,
        turn_detection: { type: "server_vad" },
        audio: {
          input: {
            format: { type: "audio/pcm", rate: INPUT_SAMPLE_RATE },
          },
          output: {
            format: { type: "audio/pcm", rate: OUTPUT_SAMPLE_RATE },
          },
        },
        tools,
      },
    });

    if (grok.localStream && grok.audioManager) {
      grok.audioManager.startCapture(
        grok.localStream,
        (pcmChunk) => {
          if (grok.ws?.readyState === WebSocket.OPEN) {
            sendWebSocketMessage({
              type: "input_audio_buffer.append",
              audio: pcmChunk,
            });
          }
        },
        INPUT_SAMPLE_RATE,
      );
    }
  };

  const handleWebSocketError = (error: Event) => {
    console.error("Grok WebSocket error:", error);
    handlers.onError?.(error);
  };

  // Bound to its socket: a close from a socket stopChat already replaced
  // (startChat awaits before opening the next one) must not end the new chat.
  const handleWebSocketClose = (ws: WebSocket) => (event: CloseEvent) => {
    console.log(
      `Grok WebSocket closed - Code: ${event.code}, Reason: ${event.reason}`,
    );
    if (grok.ws !== ws) return;
    // An unexpected close: release the microphone and audio as a stop would.
    stopChat();
  };

  const attachRemoteAudioElement = (__audio: HTMLAudioElement | null) => {
    /* Grok audio plays through AudioStreamManager, not an audio element */
  };

  const setTracksEnabled = (enabled: boolean) => {
    grok.localStream?.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
  };

  const setMute = (muted: boolean) => {
    isMuted.value = muted;
    setTracksEnabled(!muted);
  };

  // Bumped by stopChat, so a startChat still awaiting the server or the
  // microphone gives up instead of connecting after it was stopped.
  let startGeneration = 0;

  const stopChat = () => {
    startGeneration++;
    const ws = grok.ws;
    if (ws) {
      grok.ws = null;
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      ws.close();
    }
    if (grok.audioManager) {
      grok.audioManager.destroy();
      grok.audioManager = null;
    }
    if (grok.localStream) {
      grok.localStream.getTracks().forEach((track) => track.stop());
      grok.localStream = null;
    }
    processedToolCalls.clear();
    responseActive = false;
    responseHeld = false;
    responseRequested = false;
    chatActive.value = false;
    conversationActive.value = false;
    connecting.value = false;
    setMute(false);
  };

  const startChat = async () => {
    if (chatActive.value || connecting.value) return;
    const apiKey = options.getApiKey();
    if (!apiKey) {
      handlers.onError?.(new Error("Enter your xAI API key in Settings."));
      return;
    }

    connecting.value = true;
    const generation = ++startGeneration;
    const stopped = () => generation !== startGeneration;

    try {
      const clientSecret = await mintClientSecret(apiKey);
      if (stopped()) return;

      const instructions = options.buildInstructions();
      const tools = options.buildTools();
      const modelId = options.getModelId();

      // Microphone first, so the WebSocket opens with audio ready to send.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: INPUT_SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      if (stopped()) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      grok.localStream = stream;

      grok.audioManager = new AudioStreamManager();
      grok.audioManager.setPlaybackEventHandlers({
        onPlaybackStarted: () => handlers.onAudioPlaybackStarted?.(),
        onPlaybackStopped: () => handlers.onAudioPlaybackStopped?.(),
      });

      // Browsers can't set an Authorization header on a WebSocket; xAI takes
      // the client secret as a subprotocol instead.
      const ws = new WebSocket(
        `${GROK_REALTIME_URL}?model=${encodeURIComponent(modelId)}`,
        [`xai-client-secret.${clientSecret}`],
      );
      grok.ws = ws;
      ws.onopen = () => handleWebSocketOpen(instructions, tools);
      ws.onmessage = handleWebSocketMessage;
      ws.onerror = handleWebSocketError;
      ws.onclose = handleWebSocketClose(ws);
      // chatActive and connecting change in handleWebSocketOpen.
    } catch (err) {
      console.error("Failed to start Grok voice session:", err);
      if (stopped()) return;
      stopChat();
      handlers.onError?.(err);
    }
  };

  const sendFunctionCallOutput = (callId: string, output: string) => {
    return sendWebSocketMessage({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output,
      },
    });
  };

  const sendUserText = (text: string) => addUserText(text) && requestResponse();

  // response.create's `instructions` replace the session's system prompt for
  // that response, so a plugin's follow-up goes in as a user message instead.
  const sendInstructions = (instructions: string) => {
    if (!addUserText(`[System instruction] ${instructions}`)) return false;
    return requestResponse();
  };

  return {
    chatActive,
    conversationActive,
    connecting,
    isMuted,
    isConnected: () => grok.ws?.readyState === WebSocket.OPEN,
    startChat,
    stopChat,
    sendFunctionCallOutput,
    sendUserText,
    sendInstructions,
    setMute,
    attachRemoteAudioElement,
    registerEventHandlers,
  };
}
