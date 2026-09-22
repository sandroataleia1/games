import { z } from "zod";

const roomCode = z.string().trim().toUpperCase().regex(/^[A-HJ-NP-Z2-9]{6}$/);
const token = z.string().min(32).max(512);
const playerName = z.string().min(2).max(24);
const empty = z.object({}).strict();

export const lobbySchemas = Object.freeze({
  quizList: empty,
  roomCreate: z.object({ quizId: z.uuid() }).strict(),
  roomJoin: z.object({ roomCode, displayName: playerName }).strict(),
  roomResume: z.object({ roomCode, participantId: z.uuid(), reconnectToken: token }).strict(),
  hostResume: z.object({ roomCode, hostToken: token }).strict(),
  roomLeave: z.object({ roomCode }).strict(),
});

export const publicPlayerSchema = z.object({
  id: z.uuid(),
  displayName: playerName,
  connectionStatus: z.enum(["CONNECTED", "DISCONNECTED"]),
  joinedAt: z.string().datetime({ offset: true }),
}).strict();

export const publicLobbyStateSchema = z.object({
  schemaVersion: z.literal(1),
  roomCode,
  status: z.literal("WAITING"),
  quiz: z.object({ id: z.uuid(), title: z.string(), questionCount: z.number().int().nonnegative() }).strict(),
  players: z.array(publicPlayerSchema),
  playerCount: z.number().int().nonnegative(),
  maxPlayers: z.number().int().positive(),
  serverTime: z.string().datetime({ offset: true }),
}).strict();

export const EVENTS = Object.freeze({
  SYSTEM_PING: "system:ping",
  SYSTEM_PONG: "system:pong",
  QUIZ_LIST: "v1:quiz:list",
  ROOM_CREATE: "v1:room:create",
  ROOM_JOIN: "v1:room:join",
  ROOM_RESUME: "v1:room:resume",
  ROOM_LEAVE: "v1:room:leave",
  HOST_RESUME: "v1:host:resume",
  ROOM_STATE: "v1:room:state",
  PARTICIPANT_JOINED: "v1:room:participant-joined",
  PARTICIPANT_UPDATED: "v1:room:participant-updated",
  PARTICIPANT_LEFT: "v1:room:participant-left",
});

export const errorCodes = Object.freeze([
  "INVALID_PAYLOAD", "QUIZ_NOT_FOUND", "QUIZ_NOT_PUBLISHED", "ROOM_NOT_FOUND", "ROOM_NOT_WAITING",
  "ROOM_FULL", "ROOM_CODE_CONFLICT", "NAME_CONFLICT", "INVALID_HOST_TOKEN", "INVALID_RECONNECT_TOKEN",
  "RATE_LIMITED", "DEPENDENCY_UNAVAILABLE", "INTERNAL_ERROR",
]);