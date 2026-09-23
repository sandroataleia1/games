import { z } from "zod";
import { defineGameModule } from "@multygames/game-registry";
import { defineGameRuntime } from "@multygames/game-runtime";

// TEST-ONLY synthetic game. It is never registered by the application: tests add
// it through createServerDatabase({ catalog, extraRuntimes }). It proves a second
// game runs on the platform with its own definition, its own (in-memory)
// persistence and its own protocol, without touching Quiz tables, quizId or
// quizSnapshot, and without importing the Quiz module.
export function syntheticGameModule(key = "fake-game", status = "AVAILABLE") {
  return defineGameModule({
    definition: {
      key, slug: key, name: key, shortDescription: key, description: key, status, route: `/jogos/${key}`,
      releasedAt: "2026-01-01T00:00:00-03:00", categoryKeys: ["TRIVIA"], minPlayers: 1, maxPlayers: 4,
      supportsSolo: true, supportsPublicRooms: true, supportsPrivateRooms: false,
      visual: { accent: "red", gradient: "red", icon: "X" },
    },
    implementation: { web: `apps/web/${key}`, realtime: `test/${key}` },
  });
}

const roomState = z.object({ roomNumber: z.number().int(), gameKey: z.string(), status: z.string(), playerCount: z.number().int(), players: z.array(z.unknown()), serverTime: z.string() }).strict();

export function createSyntheticRuntime(gameKey = "fake-game") {
  const state = { calls: [], matches: new Map(), participants: [], recovered: [], joined: [], events: [] };
  const runtime = defineGameRuntime({
    gameKey,
    persistence: {
      async prepareMatch({ room }) { state.calls.push("prepareMatch"); return { prepared: { seed: `seed-${room.number}` } }; },
      async createMatchState({ match, prepared }) { state.calls.push("createMatchState"); state.matches.set(match.id, { ...prepared, moves: 0 }); },
      async createParticipantState({ matchParticipant, displayName }) { state.calls.push("createParticipantState"); state.participants.push({ id: matchParticipant.id, displayName }); },
    },
    realtime: {
      roomProjection: { schema: { parse: (value) => roomState.parse(value) }, extras: async () => new Map() },
      registerHandlers(host) {
        // The game's own protocol: its own event name, nothing shared with the Quiz.
        host.bindCommand(`test:${gameKey}:ping`, async (socket, payload) => { state.events.push(payload); return { pong: true, game: gameKey }; });
      },
      async onRoomEnter({ room }) { state.joined.push(room.number); return { match: null, playing: false }; },
      async onRoomLeave() {},
      async onSocketDisconnect() {},
      async onMatchStarted({ match }) { return { match: { gameKey, phase: "SYNTHETIC", matchId: match.id } }; },
      async recoverMatch({ match }) { state.recovered.push(match.id); },
    },
  });
  return { runtime, state };
}
