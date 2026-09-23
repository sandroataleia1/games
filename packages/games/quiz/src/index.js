import { defineGameModule } from "@quizarena/game-registry";

// The Quiz module: metadata only. It intentionally does not import the real
// implementation (apps/web's pages, apps/realtime's lobby) - a shared
// package pulling in a Next.js route tree or a Socket.IO server would
// create the exact app-depends-on-package-depends-on-app cycle the platform
// split is meant to avoid. `implementation` below is a documentary pointer
// for humans and future tooling, not a live reference.
export const quizGame = defineGameModule({
  definition: {
    key: "quiz",
    slug: "quiz",
    name: "Quiz",
    shortDescription: "Responda rápido, marque pontos e vença seus amigos.",
    description:
      "As salas já existem, sempre abertas. Entre em uma, escolha o tema entre os quizzes publicados e " +
      "qualquer pessoa na sala pode iniciar a partida. Cada rodada tem uma pergunta, um tempo limite e " +
      "pontuação por velocidade de resposta; a partida pode começar com um único participante.",
    status: "AVAILABLE",
    route: "/jogos/quiz",
    // Data em que o Quiz foi registrado como a primeira modalidade da
    // MultyGames (commit 5cc7cd0, PLATFORM-07A) - não é data de build nem
    // "agora"; é o evento real de entrada no catálogo.
    releasedAt: "2026-09-23T08:22:12-03:00",
    minPlayers: 1,
    maxPlayers: 100,
    supportsSolo: true,
    supportsPublicRooms: true,
    supportsPrivateRooms: false,
    visual: {
      accent: "var(--lime)",
      gradient: "linear-gradient(135deg, var(--lime), var(--cyan))",
      icon: "Q",
    },
  },
  implementation: {
    web: "apps/web/src/app/jogos/quiz",
    realtime: "apps/realtime/src/lobby.js",
  },
});
