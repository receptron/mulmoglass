// OpenAI Realtime over WebRTC. Adapted from MulmoChat's
// src/composables/useRealtimeSession.ts. The ephemeral key is minted here with
// the user's own key (POST /v1/realtime/client_secrets, which allows browser
// calls) instead of by a server.
import { ref } from "vue";
import type {
  VoiceSession,
  VoiceSessionEventHandlers,
  VoiceSessionOptions,
} from "./types";

const VOICE = "shimmer";

interface RealtimeEvent {
  type: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  delta?: string;
  error?: unknown;
}

async function mintEphemeralKey(apiKey: string, model: string) {
  const response = await fetch(
    "https://api.openai.com/v1/realtime/client_secrets",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model,
          audio: { output: { voice: VOICE } },
        },
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`OpenAI: ${response.status} ${await response.text()}`);
  }
  const data = (await response.json()) as { value?: unknown };
  if (typeof data.value !== "string") {
    throw new Error("OpenAI returned no ephemeral key");
  }
  return data.value;
}

export function useOpenAIRealtime(options: VoiceSessionOptions): VoiceSession {
  let handlers: VoiceSessionEventHandlers = { ...(options.handlers ?? {}) };
  const registerEventHandlers = (
    newHandlers: Partial<VoiceSessionEventHandlers>,
  ) => {
    handlers = { ...handlers, ...newHandlers };
  };

  const chatActive = ref(false);
  const conversationActive = ref(false);
  const connecting = ref(false);
  const isMuted = ref(false);
  const processedToolCalls = new Map<string, string>();
  let remoteAudio: HTMLAudioElement | null = null;
  let isAudioPlaying = false;

  let pc: RTCPeerConnection | null = null;
  let dc: RTCDataChannel | null = null;
  let localStream: MediaStream | null = null;
  let remoteStream: MediaStream | null = null;
  // Bumped by stopChat, so a start still awaiting gives up.
  let startGeneration = 0;

  const send = (message: unknown): boolean => {
    if (!dc || dc.readyState !== "open") {
      console.warn("Cannot send: the data channel is not open.");
      return false;
    }
    dc.send(JSON.stringify(message));
    return true;
  };

  // OpenAI refuses a response.create while a response is running
  // (conversation_already_has_active_response), and a tool's follow-up often
  // arrives while the model is still talking. So a request in that window is
  // held and sent after response.done, once, with the held instructions
  // joined (the same approach as grokVoice.ts).
  let responseActive = false;
  let responseRequested = false;
  let heldResponse: { instructions: string[] } | null = null;
  // The instructions of the response.create awaiting response.created.
  let requestedInstructions: string | undefined;
  // A response.create's `instructions` replace the session's for that
  // response, which would drop the base prompt, the plugins' prompts and the
  // user's language (a slideshow's next slide came back in English, without
  // its rules). So a follow-up is sent as the session's plus its own.
  let sessionInstructions = "";

  const requestResponse = (instructions?: string): boolean => {
    if (responseActive) {
      heldResponse ??= { instructions: [] };
      if (instructions) heldResponse.instructions.push(instructions);
      return true;
    }
    responseActive = true;
    responseRequested = true;
    requestedInstructions = instructions;
    return send({
      type: "response.create",
      response: instructions
        ? { instructions: `${sessionInstructions}\n\n${instructions}` }
        : {},
    });
  };

  const releaseHeldResponse = () => {
    const held = heldResponse;
    heldResponse = null;
    if (held) requestResponse(held.instructions.join("\n\n") || undefined);
  };

  const handleMessage = async (message: MessageEvent) => {
    let event: RealtimeEvent;
    try {
      event = JSON.parse(message.data as string) as RealtimeEvent;
    } catch (error) {
      handlers.onError?.(error);
      return;
    }
    switch (event.type) {
      case "error":
        console.error("OpenAI Realtime error", event.error);
        // A response.create that raced the server's own turn: hold it again.
        if (
          (event.error as { code?: unknown } | undefined)?.code ===
          "conversation_already_has_active_response"
        ) {
          responseActive = true;
          responseRequested = false;
          heldResponse ??= { instructions: [] };
          if (requestedInstructions) {
            heldResponse.instructions.unshift(requestedInstructions);
          }
          requestedInstructions = undefined;
          break;
        }
        // Refused outright: no response.done will follow.
        if (responseRequested) {
          responseRequested = false;
          responseActive = false;
        }
        handlers.onError?.(event.error);
        break;
      case "response.function_call_arguments.done": {
        const id = event.call_id;
        if (!id || !event.name) break;
        const argStr = event.arguments ?? "";
        // The same call can be reported twice.
        if (processedToolCalls.get(id) === argStr) break;
        processedToolCalls.set(id, argStr);
        await handlers.onToolCall?.(
          { type: event.type, name: event.name, call_id: id },
          id,
          argStr,
        );
        break;
      }
      case "response.output_audio_transcript.delta":
        handlers.onTranscriptDelta?.(event.delta ?? "");
        break;
      case "response.output_audio_transcript.done":
        handlers.onTranscriptDone?.();
        break;
      case "response.created":
        responseActive = true;
        responseRequested = false;
        requestedInstructions = undefined;
        conversationActive.value = true;
        handlers.onConversationStarted?.();
        break;
      case "response.done":
        responseActive = false;
        conversationActive.value = false;
        handlers.onConversationFinished?.();
        releaseHeldResponse();
        break;
      case "input_audio_buffer.speech_started":
        handlers.onSpeechStarted?.();
        break;
      case "input_audio_buffer.speech_stopped":
        handlers.onSpeechStopped?.();
        break;
      case "output_audio_buffer.started":
        if (!isAudioPlaying) {
          isAudioPlaying = true;
          handlers.onAudioPlaybackStarted?.();
        }
        break;
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
        if (isAudioPlaying) {
          isAudioPlaying = false;
          handlers.onAudioPlaybackStopped?.();
        }
        break;
    }
  };

  const attachRemoteAudioElement = (audio: HTMLAudioElement | null) => {
    remoteAudio = audio;
    if (audio && remoteStream) audio.srcObject = remoteStream;
  };

  const setTracksEnabled = (enabled: boolean) => {
    localStream?.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
  };

  const setMute = (muted: boolean) => {
    isMuted.value = muted;
    setTracksEnabled(!muted);
  };

  const stopChat = () => {
    startGeneration++;
    pc?.close();
    pc = null;
    dc?.close();
    dc = null;
    localStream?.getTracks().forEach((track) => track.stop());
    localStream = null;
    remoteStream?.getTracks().forEach((track) => track.stop());
    remoteStream = null;
    if (remoteAudio) remoteAudio.srcObject = null;
    processedToolCalls.clear();
    isAudioPlaying = false;
    responseActive = false;
    responseRequested = false;
    heldResponse = null;
    chatActive.value = false;
    conversationActive.value = false;
    connecting.value = false;
    setMute(false);
  };

  const startChat = async () => {
    if (chatActive.value || connecting.value) return;
    const apiKey = options.getApiKey();
    if (!apiKey) {
      handlers.onError?.(new Error("Enter your OpenAI API key in Settings."));
      return;
    }
    connecting.value = true;
    const generation = ++startGeneration;
    const stopped = () => generation !== startGeneration;
    const model = options.getModelId();

    try {
      const ephemeralKey = await mintEphemeralKey(apiKey, model);
      if (stopped()) return;

      const peer = new RTCPeerConnection();
      pc = peer;
      const channel = peer.createDataChannel("oai-events");
      dc = channel;
      channel.addEventListener("open", () => {
        sessionInstructions = options.buildInstructions();
        send({
          type: "session.update",
          session: {
            type: "realtime",
            model,
            instructions: sessionInstructions,
            audio: { output: { voice: VOICE } },
            tools: options.buildTools(),
          },
        });
        chatActive.value = true;
        connecting.value = false;
      });
      channel.addEventListener("message", handleMessage);
      channel.addEventListener("close", () => {
        if (dc === channel) stopChat();
      });

      remoteStream = new MediaStream();
      peer.ontrack = (event) => {
        remoteStream?.addTrack(event.track);
        if (remoteAudio) remoteAudio.srcObject = remoteStream;
      };

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      if (stopped()) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      localStream = stream;
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const response = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
      });
      if (!response.ok) {
        throw new Error(`OpenAI: ${response.status} ${await response.text()}`);
      }
      const answer = await response.text();
      if (stopped()) return;
      await peer.setRemoteDescription({ type: "answer", sdp: answer });
    } catch (error) {
      if (stopped()) return;
      console.error("Failed to start OpenAI Realtime", error);
      stopChat();
      handlers.onError?.(error);
    }
  };

  const sendFunctionCallOutput = (callId: string, output: string) =>
    send({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: callId, output },
    });

  const sendUserText = (text: string) =>
    send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    }) && requestResponse();

  const sendInstructions = (instructions: string) =>
    requestResponse(instructions);

  return {
    chatActive,
    conversationActive,
    connecting,
    isMuted,
    isConnected: () => dc?.readyState === "open",
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
