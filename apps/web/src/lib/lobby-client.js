import { io } from "socket.io-client";
import { EVENTS, systemPongSchema } from "@quizarena/contracts";

export function createLobbyClient({ onStatusChange, onStateChange, onQuestionResult, onFinished, onRoomIndex, onParticipantJoined, onParticipantLeft } = {}) {
  const socket = io(process.env.NEXT_PUBLIC_REALTIME_URL, { autoConnect: false, reconnection: true, withCredentials: true });
  const update = (status) => onStatusChange?.(status);
  socket.on("connect", () => {
    update("connecting");
    const ping = { id: crypto.randomUUID(), sentAt: new Date().toISOString() };
    socket.timeout(3000).emit(EVENTS.SYSTEM_PING, ping, (error, payload) => {
      const valid = systemPongSchema.safeParse(payload);
      update(!error && valid.success && valid.data.id === ping.id ? "connected" : "unavailable");
    });
  });
  socket.on("disconnect", () => update("unavailable"));
  socket.on("connect_error", () => update("unavailable"));
  socket.io.on("reconnect_attempt", () => update("reconnecting"));
  if (onStateChange) socket.on(EVENTS.ROOM_STATE, onStateChange);
  if (onStateChange) socket.on(EVENTS.GAME_STATE, onStateChange);
  if (onQuestionResult) socket.on(EVENTS.GAME_QUESTION_RESULT, onQuestionResult);
  if (onFinished) socket.on(EVENTS.GAME_FINISHED, onFinished);
  if (onRoomIndex) socket.on(EVENTS.ROOM_INDEX, onRoomIndex);
  if (onParticipantJoined) socket.on(EVENTS.PARTICIPANT_JOINED, onParticipantJoined);
  if (onParticipantLeft) socket.on(EVENTS.PARTICIPANT_LEFT, onParticipantLeft);
  socket.connect();
  return {
    command(event, payload = {}) {
      return new Promise((resolve) => socket.timeout(5000).emit(event, payload, (_error, response) => resolve(response ?? { ok: false, error: { code: "INTERNAL_ERROR", message: "Servidor indisponível." } })));
    },
    onState: (handler) => socket.on(EVENTS.ROOM_STATE, handler),
    disconnect: () => socket.disconnect(),
  };
}
