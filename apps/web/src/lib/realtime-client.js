import { io } from "socket.io-client";
import { EVENTS, systemPongSchema } from "@quizarena/contracts";

export function connectRealtime({ onStatusChange }) {
  const url = process.env.NEXT_PUBLIC_REALTIME_URL;
  if (!url) {
    queueMicrotask(() => onStatusChange("unavailable"));
    return () => {};
  }
  const socket = io(url, { autoConnect: false, reconnection: true });
  let alive = true;
  const update = (status) => {
    if (alive) onStatusChange(status);
  };
  socket.on("connect", () => {
    const ping = { id: crypto.randomUUID(), sentAt: new Date().toISOString() };
    socket.timeout(3000).emit(EVENTS.SYSTEM_PING, ping, (error, payload) => {
      const parsed = systemPongSchema.safeParse(payload);
      update(
        !error &&
          parsed.success &&
          parsed.data.id === ping.id &&
          parsed.data.sentAt === ping.sentAt
          ? "connected"
          : "unavailable",
      );
    });
  });
  socket.on("disconnect", () => update("unavailable"));
  socket.on("connect_error", () => update("unavailable"));
  socket.io.on("reconnect_attempt", () => update("connecting"));
  socket.connect();
  return () => {
    alive = false;
    socket.removeAllListeners();
    socket.io.removeAllListeners();
    socket.disconnect();
  };
}
