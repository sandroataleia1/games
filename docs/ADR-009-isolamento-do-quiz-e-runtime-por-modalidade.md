# ADR-009 — Isolamento do Quiz e runtime por modalidade (PLATFORM-07C)

Status: aceito. Continua o [ADR-008](ADR-008-salas-partidas-e-participantes-genericos.md), cuja dívida principal (Quiz dentro do núcleo genérico) esta etapa remove. Onde os dois divergem, vale este.

## Inventário antes da alteração

| Onde | Ocorrência | Classe | Destino |
| --- | --- | --- | --- |
| `Room.quizId` | tema do Quiz numa tabela genérica | compatibilidade temporária | fonte passa a ser `QuizRoomConfiguration`; coluna vira espelho |
| `GameSession.{quizId, quizSnapshot, matchPhase, currentQuestionIndex, questionStartedAt, questionEndsAt}` | estado do Quiz na tabela de partida | compatibilidade temporária | fonte passa a ser `QuizMatchState`; colunas viram espelho |
| `Participant` (score, respostas, token) | estado do Quiz | domínio do Quiz | modelo Prisma `QuizParticipantState` (`@@map("Participant")`, tabela intocada) |
| `packages/database/src/services/{quizzes,sessions,scoring,organizers(autoria)}`, `mappers/snapshot`, `repositories/{quizzes,sessions}`, `games/*`, `prisma/seed.js` | regras, snapshot e persistência do Quiz | domínio do Quiz | movidos para `packages/games/quiz/src/server` |
| `apps/realtime/src/lobby.js` | host **e** protocolo do Quiz (`answer`, `next`, tema, timers) | misto | host genérico em `lobby.js`; Quiz em `packages/games/quiz/src/server/realtime.js` |
| `@quizarena/game-*` | pacotes criados depois da marca MultyGames | namespace | `@multygames/game-*` |
| `scripts/browser-game05/06.js` | UI pré-portal | teste obsoleto | substituídos por `browser-authoring.js` |
| `docs/ADR-005-*.md` | cita os nomes antigos de pacote | documentação histórica | não reescrito |
| Migrations 000100–000300 (07B) e anteriores | `quizId`, snapshot, `Participant` | histórico | imutáveis |

Ocorrências de `gameKey === "quiz"` / `switch (gameKey)` no núcleo: **nenhuma** (a verificação passou a ser automática; ver abaixo).

## Limites de dependência

```text
game-catalog (definições públicas)
      ↓
platform-core (@quizarena/database: cliente, transação, serviços genéricos de sala/partida/participante)
      ↓
composition root (@multygames/server-bootstrap)
      ↓
runtime do Quiz (@multygames/game-quiz/server)
      ↓
primitivas de banco (@quizarena/database)
```

Na prática: o núcleo **não importa nenhum** `@multygames/*`; o Quiz importa as primitivas do núcleo e `game-registry`/`game-runtime`; só o composition root conhece o Quiz e o registra. O portal (web) importa apenas `@multygames/game-catalog` (definições) — nunca `/server`, `game-runtime`, banco, Redis ou Socket.IO servidor.

Aplicação **sem ferramenta nova**: regras `no-restricted-imports` no ESLint (raiz e web), mais `packages/server-bootstrap/test/boundaries.test.js` (varre fontes: nenhum `gameKey === "…"`/`switch (gameKey)`, nenhum vocabulário do Quiz no núcleo, manifests do portal, namespaces, e prova que as regras do ESLint realmente barram os imports proibidos) e `scripts/check-web-bundle.js` (após o build, procura Prisma, Redis, runtime/servidor do Quiz e hashes em `.next/static` e `.next/server`). Tudo roda em `pnpm check`.

## Namespace de pacotes

| Pacote | Nome | Motivo |
| --- | --- | --- |
| game-registry, game-catalog, games/quiz, game-runtime (novo), server-bootstrap (novo) | `@multygames/*` | criados depois da mudança de marca e nunca publicados |
| contracts, database, web, realtime, raiz `quizarena` | `@quizarena/*` (mantidos) | anteriores à marca; renomear tocaria imports, lockfile e deploy sem ganho; o nome interno é invisível ao usuário. Também permanecem `quizarena_session`, prefixos Redis `quizarena:*`, tabelas e migrations |

Um teste impede `@quizarena/game-*` no código, nos manifests e no lockfile (o ADR-005, histórico, é a única exceção documental).

## Persistência do Quiz

Tabelas do módulo (Prisma: `QuizRoomConfiguration`, `QuizMatchState`, `QuizParticipantState`):

- **`QuizRoomConfiguration`** (`roomId` PK, `gameKey`, `quizId`, timestamps) — 1:1 com `Room`.
- **`QuizMatchState`** (`matchId` PK, `gameKey`, `quizId`, `quizSnapshot`, `matchPhase`, `currentQuestionIndex`, `questionStartedAt/EndsAt`, timestamps) — 1:1 com `GameSession`.
- **`QuizParticipantState`** = `Participant` (mesma tabela e ids; só o nome no código mudou): score, respostas, token. Compartilha o id do `MatchParticipant`.

`gameKey` constante em ambas (`CHECK = 'quiz'`) + **FK composta** `(roomId|matchId, gameKey) → Room|GameSession(id, gameKey)` = o banco impede configuração/estado do Quiz em sala/partida de outra modalidade e congela a modalidade da sala/partida enquanto a linha do Quiz existir. Sem trigger de sincronização; sem coluna JSON genérica. Retenção: `QuizMatchState.quizId` → `RESTRICT` (quiz usado por partida não é removido; a partida não é apagada); `QuizRoomConfiguration` → `CASCADE` (tema é seleção, não histórico — comportamento anterior `SET NULL`).

`GameSession` fica apenas com fatos da plataforma. O DTO genérico de partida e de sala **não** contém estado do Quiz; o tema aparece no estado público da sala apenas pela projeção do Quiz.

## Expand → Migrate → (Contract futuro)

**Expand + Migrate** — migration `20260925000100_quiz_module_persistence`, atômica:

1. remove a FK de coluna única `GameSession_roomId_fkey` (coberta pela composta do 07B, agora modelada no Prisma);
2. cria as tabelas, constraints, índices, FKs e o trigger de imutabilidade do snapshot (reaproveita `protect_session_snapshot`);
3. **pré-checagem** que aborta tudo (`RAISE EXCEPTION`, nada é aplicado): sala com `quizId` que não é do Quiz; partida com estado do Quiz que não é do Quiz; partida do Quiz sem snapshot;
4. backfill determinístico e idempotente (`NOT EXISTS`): ids originais, timestamps originais (`updatedAt` = `finishedAt`/`questionStartedAt`/`startedAt`/`createdAt`, nunca `now()`).

Verificado em banco vazio, em banco populado (encerrada, solo, multiplayer, ativa, host que joga, anônimo, respostas, ranking) e no banco de desenvolvimento real (51 partidas → 51 estados).

**Aplicação nova (rollout).** Lê e grava **primeiro** nas tabelas do módulo. Enquanto uma versão anterior puder estar ativa (`LEGACY_QUIZ_COMPAT` ≠ `off`, padrão ligado):

- **espelho**: cada escrita nas tabelas do módulo é replicada, na mesma transação, nas colunas legadas (o snapshot é escrito na criação da partida, pois o trigger legado proíbe adicioná-lo depois);
- **fallback**: uma sala/partida que só existe na forma legada (criada por instância antiga depois da migration) é *materializada* nas tabelas do módulo na primeira leitura — idempotente (`skipDuplicates`), concorrência-segura, **registrada** (`[quiz-compat] fallback …`) e contada (`compat.counters.fallbacks`);
- **divergência**: se o espelho legado discorda da tabela do módulo, **a tabela do módulo vence**, com aviso e contador (`divergences`); nada é servido em silêncio dos dados legados.

Cenário coberto por teste: migration aplicada → instância antiga cria/avança partida → instância nova a recupera (materializa, reporta divergência). Limite conhecido: uma instância antiga que *avança* uma partida (ou *troca o tema* de uma sala) já materializada não é refletida na tabela do módulo (a divergência é apenas reportada); por isso o rollout deve **drenar as instâncias antigas** logo após a migration.

**Rollback operacional.** As colunas legadas continuam íntegras (espelhadas), então voltar o binário para a versão anterior funciona sem restaurar dados; partidas iniciadas pela versão nova já têm as colunas legadas preenchidas. Não há migration reversa e nada foi removido. Com o espelho **desligado** o rollback deixa de ser seguro para partidas novas — não desligue antes de descartar o rollback.

**Auditoria (somente leitura).** `pnpm db:audit-quiz` compara colunas legadas e tabelas do módulo (sala sem configuração, tema divergente, partida sem estado, estado divergente, participante sem registro da plataforma). Exit 0 = sem divergências. Só emite `SELECT`.

**Desligar a compatibilidade** (depois do rollout): 1) confirmar que nenhuma instância antiga roda; 2) `pnpm db:audit-quiz` → exit 0; 3) definir `LEGACY_QUIZ_COMPAT=off` e reiniciar (espelho e fallback desligam; um estado ausente vira `QUIZ_STATE_MISSING`, explícito); 4) só então a migration de contração.

**Contract — migration futura (NÃO executada aqui).** Remover, quando a auditoria estiver limpa por um ciclo completo: `Room.quizId` (+ FK), `GameSession.quizId`, `GameSession.quizSnapshot`, `GameSession.matchPhase`, `currentQuestionIndex`, `questionStartedAt`, `questionEndsAt`, o trigger/constraint legados `GameSession_snapshot_immutable` e `GameSession_snapshot_root_valid` (o `protect_session_snapshot` continua, usado por `QuizMatchState`), `MatchPhase` fica (usado pelo módulo), e os campos do fluxo antigo com host (`hostTokenHash`, `visibility`) somente se aquele fluxo for aposentado. `Participant.{userId, joinedAt}` permanecem (cópias gravadas num único ponto).

## DDL fora do Prisma

Com o Prisma 6.19 foi possível **modelar**: FK composta `GameSession(roomId, gameKey)` (relação opcional com campo obrigatório é aceita), as FKs do Quiz, os índices únicos. Ficam **só no SQL** (o Prisma não representa nem enxerga):

| Objeto | Finalidade |
| --- | --- |
| índice único parcial `GameSession_one_live_match_per_room` | uma partida viva por sala, entre instâncias |
| CHECK `GameSession_snapshot_root_valid` | raiz do snapshot legado; aceita partida sem estado do Quiz |
| trigger `GameSession_snapshot_immutable` / função `protect_session_snapshot` | snapshot legado imutável |
| CHECK `QuizRoomConfiguration_gameKey_check`, `QuizMatchState_gameKey_check` | só o jogo `quiz` |
| CHECK `QuizMatchState_snapshot_root_valid` | raiz do snapshot do módulo e vínculo com `quizId` |
| trigger `QuizMatchState_snapshot_immutable` | snapshot da partida nunca muda |

`migrate deploy` é o único comando de aplicação (reproduz o SQL exato). `migrate dev` **não** deve ser usado sem revisar: ele compara só o que o Prisma enxerga e proporia remover/recriar objetos que ele desconhece. Sem drift silencioso: `pnpm db:verify` (parte de `pnpm check`) roda contra o schema isolado de testes — sem tocar em desenvolvimento nem produção — e falha se (1) `prisma validate` falhar, (2) `prisma migrate diff` (migrations → `schema.prisma`) mostrar algo além da diferença cosmética conhecida (`@updatedAt` sem `DEFAULT`), (3) qualquer objeto acima ou guarda modelada (FK composta, unicidade de participação, FK de histórico) faltar em `pg_catalog`. Os mesmos objetos são testados em `migration.test.js`, incluindo um caso em que uma migration os remove.

## Runtime por `gameKey`

`@multygames/game-runtime` define `defineGameRuntime` e `createGameRuntimeRegistry({ catalog, runtimes })` — registro **servidor**, separado do catálogo público:

- persistência (chamada pela plataforma, na própria transação de início de partida): `prepareMatch`, `createMatchState`, `createParticipantState`;
- realtime (delegada pelo host): `roomProjection` (schema + extras públicos da sala), `registerHandlers(host)`, `onRoomEnter`, `onRoomLeave`, `onSocketDisconnect`, `onMatchStarted`, `recoverMatch`, e `close` opcional.

Validações: chaves únicas; runtime sem definição no catálogo é recusado; jogo `AVAILABLE` que declara `implementation.realtime` sem runtime **impede a inicialização**; jogo `DISABLED`/`COMING_SOON` pode não ter (ou manter) runtime, e seu histórico segue legível pela plataforma; registro e runtimes são congelados; nada disso vai ao DTO público nem ao bundle web. Não existe `handleCommand` genérico nem `game:command`.

## Composition root e host realtime

`createServerDatabase` (`@multygames/server-bootstrap`): carrega o catálogo, cria a plataforma, cria o servidor de cada jogo a partir das primitivas, registra e valida os runtimes. É o único ponto que conhece o Quiz. O entrypoint do realtime (`server.js`) chama apenas o bootstrap.

`apps/realtime/src/lobby.js` é o **host genérico**: Redis/adapter, presença, entrada/saída/reconexão, autorização, índice de salas por jogo, `v1:match:start` (transação da plataforma + `onMatchStarted` do jogo), locks e recuperação. Ele resolve a sala → runtime pelo `gameKey`; sala de jogo sem runtime é `ROOM_NOT_FOUND`. Os eventos do Quiz (`v1:quiz:list`, `v1:room:theme-select`, `v1:game:answer`, `v1:game:next`) e seus timers vivem em `game-quiz/src/server/realtime.js` e são registrados por `bindCommand` (mesmo rate limit e mapeamento de erros; registrar o mesmo evento duas vezes é erro). **Nomes de eventos e ACKs não mudaram.** `v1:room:list` aceita `gameKey` opcional; sem ele o host usa o único jogo servido (compatibilidade), e com mais de um jogo exige `gameKey`.

## Recuperação por modalidade

`platform.matches.live()` lista do PostgreSQL as partidas `ACTIVE` (limite; no máximo uma por sala). Para cada uma o host resolve o runtime pelo `gameKey` e delega `recoverMatch`; falha de uma partida é registrada e as outras continuam; jogo sem runtime é registrado. O Quiz relê **suas** tabelas (configuração, snapshot, progresso, respostas, pontuação) e rearma os temporizadores; nada depende das colunas legadas no caminho normal. Sem `KEYS`; seguro em duas instâncias (timers idempotentes por lock + fase relida).

## `disconnectedAt`

Auditoria: `QuizParticipantState.disconnectedAt` é escrito em queda de conexão e em saída; lido para decidir "participantes ativos" (início de partida, resposta, fim antecipado da rodada, abandono). Saída explícita agora também grava `MatchParticipant.leftAt` (07B); reconectar limpa ambos. Mantido por compatibilidade: remover o uso durável exigiria derivar "ativo" da presença no Redis + `leftAt` e redefinir o abandono, o que amplia o escopo. Pendência exata: `matches.js` (`activeCount`, `answer`) e `realtime.js` (fim antecipado) dependem dele.

## Segundo runtime (teste) e segurança

Um jogo sintético (só em teste) com definição, runtime, persistência em memória e evento próprios coexiste com o Quiz no mesmo processo, sem `quizId`/`quizSnapshot`/tabelas do Quiz, sem importar o módulo Quiz e sem receber handlers do Quiz (`runtime-host.test.js`). A extração não amplia payloads: o DTO genérico não tem estado do Quiz; os testes verificam ausência de gabarito, `quizSnapshot`, hashes e ids internos nas respostas e nas páginas; sala de outra modalidade continua indistinguível de sala inexistente.

## Dívidas restantes

- A API HTTP de autoria de quizzes (`apps/realtime/src/api.js`) ainda mora no app realtime e usa as views de compatibilidade (`database.organizers.*`); deve virar hook HTTP do runtime.
- `@quizarena/contracts` mistura contratos genéricos e do Quiz (snapshot, resposta, estado da partida).
- Tabela de mensagens de erro do host contém textos do Quiz.
- Fluxo antigo com host (`sessions.create`, `registerParticipant`, `resumeHost`, `publicRoomsForQuiz`) continua no módulo por compatibilidade e testes; candidato a remoção.
- `disconnectedAt` durável (acima) e a migration de contração (acima).
- Acesso ao `next dev` por IP da rede local continua sem `allowedDevOrigins` (fora do escopo).
