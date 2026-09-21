import { z } from "zod";

export const EVENTS = Object.freeze({
  SYSTEM_PING: "system:ping",
  SYSTEM_PONG: "system:pong",
});
const timestamp = z.string().datetime({ offset: true });
export const systemPingSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    sentAt: timestamp,
  })
  .strict();
export const systemPongSchema = systemPingSchema.extend({
  serverAt: timestamp,
});
export const systemErrorSchema = z
  .object({ error: z.literal("invalid_payload") })
  .strict();
