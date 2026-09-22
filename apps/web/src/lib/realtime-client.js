import { createLobbyClient } from "./lobby-client";

export function connectRealtime({ onStatusChange }) {
  const client = createLobbyClient({ onStatusChange });
  return client.disconnect;
}
