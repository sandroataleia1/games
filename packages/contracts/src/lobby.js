import { z } from "zod";

const roomNumber = z.number().int().min(1).max(999);
const empty = z.object({}).strict();

export const lobbySchemas = Object.freeze({
  quizList: empty,
  roomList: empty,
  roomEnter: z.object({ roomNumber }).strict(),
  roomLeave: z.object({ roomNumber }).strict(),
  themeSelect: z.object({ roomNumber, quizId: z.uuid() }).strict(),
  matchStart: z.object({ roomNumber }).strict(),
  gameAnswer: z.object({ roomNumber, questionId: z.uuid(), optionId: z.uuid() }).strict(),
  gameNext: z.object({ roomNumber }).strict(),
});

export const publicPlayerSchema = z.object({
  accountId: z.uuid(),
  displayName: z.string().min(1).max(60),
}).strict();

export const roomStatusSchema = z.enum(["OPEN", "PLAYING"]);

export const publicRoomSchema = z.object({
  roomNumber,
  gameKey: z.string().min(1),
  status: roomStatusSchema,
  quizId: z.uuid().nullable(),
  quizTitle: z.string().nullable(),
  playerCount: z.number().int().nonnegative(),
  players: z.array(publicPlayerSchema),
  serverTime: z.string().datetime({ offset: true }),
}).strict();

export const EVENTS = Object.freeze({
  SYSTEM_PING: "system:ping",
  SYSTEM_PONG: "system:pong",
  QUIZ_LIST: "v1:quiz:list",
  ROOM_LIST: "v1:room:list",
  ROOM_ENTER: "v1:room:enter",
  ROOM_LEAVE: "v1:room:leave",
  ROOM_STATE: "v1:room:state",
  ROOM_INDEX: "v1:room:index",
  THEME_SELECT: "v1:room:theme-select",
  PARTICIPANT_JOINED: "v1:room:participant-joined",
  PARTICIPANT_LEFT: "v1:room:participant-left",
  MATCH_START: "v1:match:start",
  GAME_ANSWER: "v1:game:answer",
  GAME_NEXT: "v1:game:next",
  GAME_STATE: "v1:game:state",
  GAME_QUESTION: "v1:game:question",
  GAME_QUESTION_RESULT: "v1:game:question-result",
  GAME_RANKING: "v1:game:ranking",
  GAME_FINISHED: "v1:game:finished",
});

export const errorCodes = Object.freeze([
  "INVALID_PAYLOAD", "QUIZ_NOT_FOUND", "QUIZ_NOT_PUBLISHED", "ROOM_NOT_FOUND", "ROOM_NOT_WAITING",
  "RATE_LIMITED", "DEPENDENCY_UNAVAILABLE", "INTERNAL_ERROR", "UNAUTHORIZED", "INVALID_TOKEN",
  "SESSION_NOT_FOUND", "INVALID_STATE", "NO_PARTICIPANTS", "NO_QUESTIONS", "QUESTION_EXPIRED",
  "ANSWER_ALREADY_SUBMITTED", "INVALID_ANSWER", "PARTICIPANT_NOT_ACTIVE", "COORDINATION_UNAVAILABLE",
  "UNAUTHENTICATED", "PARTICIPANT_ALREADY_JOINED", "GAME_UNKNOWN", "GAME_UNAVAILABLE", "GAME_ADAPTER_MISSING",
]);

export const matchPhaseSchema = z.enum(["LOBBY", "QUESTION", "QUESTION_RESULT", "FINISHED"]);
export const publicQuestionSchema = z.object({
  id: z.uuid(),
  prompt: z.string(),
  options: z.array(z.object({ id: z.uuid(), position: z.number().int(), text: z.string() }).strict()),
  round: z.number().int().positive(),
  totalRounds: z.number().int().positive(),
  durationSeconds: z.number().int().positive(),
  startedAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  phase: z.literal("QUESTION"),
}).strict();
export const publicMatchStateSchema = z.object({
  schemaVersion: z.literal(1),
  roomNumber,
  gameKey: z.string().min(1),
  phase: matchPhaseSchema,
  round: z.number().int().nonnegative(),
  totalRounds: z.number().int().nonnegative(),
  question: publicQuestionSchema.nullable(),
  answeredCount: z.number().int().nonnegative(),
  playerCount: z.number().int().nonnegative(),
  serverTime: z.string().datetime({ offset: true }),
}).strict();
