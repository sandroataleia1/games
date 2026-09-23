# ADR-008 — Salas, partidas e participantes genéricos (PLATFORM-07B)

Status: aceito. **Parcialmente superado pelo [ADR-009](ADR-009-isolamento-do-quiz-e-runtime-por-modalidade.md)**: o "adaptador de servidor" abaixo virou o *runtime* do jogo (`@multygames/game-runtime`), o código do Quiz saiu de `packages/database`, e a configuração/estado do Quiz têm tabelas próprias. Continua o [ADR-006](ADR-006-multygames-fundacao-modular.md) (fundação modular) e o [ADR-007](ADR-007-banner-e-descoberta-de-jogos.md).

## Contexto e inventário do modelo anterior

Antes desta etapa, "sala" e "Quiz" eram misturados:

| Conceito anterior | Responsabilidade real | Destino |
| --- | --- | --- |
| `Room` (24 salas numeradas, criadas por migration) | Ocupação (`OPEN`/`PLAYING`), tema (`quizId`) e ponteiro para a partida atual | **Generalizada**: ganha `gameKey`; `quizId` fica como legado do Quiz |
| `GameSession` | **Partida** (fase, início/fim, snapshot, host legado) e também o estado do Quiz (`quizSnapshot`, `matchPhase`, `currentQuestionIndex`, prazos) | **Mantida como a tabela de partida**; ganha `gameKey`; colunas do Quiz ficam nela, nulas para outros jogos |
| `Participant` | Participação **e** estado do Quiz (score, token de reconexão, respostas) | **Adaptada**: passa a ser o estado do Quiz de um `MatchParticipant` |
| `Answer` | Resposta do Quiz | Inalterada (estado do Quiz) |
| `Organizer` / `OrganizerSession` | Identidade autenticada (nome legado) | Inalterada; participação aponta para ela |
| Presença/locks/rate limits (Redis) | Coordenação efêmera | Inalterados; ver [RECUPERACAO-E-REDIS.md](RECUPERACAO-E-REDIS.md) |
| `sessions.create/registerParticipant/enterAsAccount/resumeHost` | Fluxo antigo com host e código de sala | Mantido (compatibilidade e testes); passa a gravar `gameKey` e `MatchParticipant` |

Ambiguidades encontradas: (1) "sessão" no código é a partida; (2) o pool de salas é persistente e **sem dono**, então host não pode ser obrigatório; (3) não existe uma rota "solo" — solo é uma partida numa sala do pool com um único participante; (4) `Participant.disconnectedAt` era usado para "desconectou" **e** "saiu"; (5) `GameSession.quizId/quizSnapshot` eram `NOT NULL`, o que impedia qualquer outro jogo de gravar uma partida.

## Decisões

### Sala ≠ partida

```text
GameDefinition (código)  →  Room  →  Match (GameSession)  →  MatchParticipant  →  estado do jogo
```

- **GameDefinition** continua só no registro em código (`@multygames/game-registry`). Não há tabela `Game` nem enum de banco: um jogo novo não exige migration.
- **Room** é o ponto de encontro: número, `gameKey`, ocupação (`OPEN`/`PLAYING`) e `currentSessionId`. Uma sala recebe várias partidas ao longo do tempo (é o comportamento real do pool); uma por vez.
- **Match** é uma execução. Ciclo próprio (`GameSessionStatus`: `WAITING/ACTIVE/FINISHED/CANCELLED`), distinto do ciclo de ocupação da sala. `GameSession` **é** a tabela de partida — não foi renomeada para evitar migração destrutiva e renomeação em massa; o nome é legado.
- **MatchParticipant** (nova) registra quem participou: `id`, `gameSessionId`, `userId`, `joinedAt`, `leftAt`. Nada de score, resposta, ranking ou payload.
- **Estado do jogo** fica no módulo: para o Quiz, `Participant` (score, token de reconexão, respostas) compartilha o **mesmo id** do `MatchParticipant` (FK composta `(matchParticipantId, gameSessionId)`).

`RoomMember` **não** foi criado: o lobby é presença efêmera no Redis, não há associação durável antes da partida.

### `gameKey`

- Fica em `Room` e em `GameSession`. A duplicação é protegida pelo banco: FK composta `GameSession(roomId, gameKey) → Room(id, gameKey)` com `ON UPDATE RESTRICT`. Consequências: uma partida nunca diverge da modalidade da sala; a modalidade da sala **não muda** depois que existe partida; não existe partida de Quiz em sala de outra modalidade. A coluna existe na partida porque partidas legadas (fluxo antigo com host) não têm sala.
- É validada em código por `createGamePolicy(registry)` (`packages/database/src/platform/game-policy.js`), sem lista duplicada:
  - **registrada**: o registro conhece a chave → histórico legível;
  - **disponível**: registrada **e** `AVAILABLE` → só essas recebem sala ou partida nova (`GAME_UNAVAILABLE` caso contrário);
  - chave gravada porém não registrada → `GAME_UNKNOWN` nas operações; leituras seguem devolvendo a chave.
- O registro é composto **uma vez** em `@multygames/game-catalog` e usado pelo portal (web) e pela plataforma (database/realtime).

### Adaptador de servidor

`defineGameServerAdapter` / `createServerAdapterRegistry` (`game-registry`) definem o contrato mínimo, todos executáveis pelo Quiz:

| Método | Função |
| --- | --- |
| `prepareMatch({ tx, room })` | valida o setup específico da sala e devolve as colunas do jogo para a linha da partida (Quiz: tema publicado + snapshot congelado) |
| `createParticipantState({ tx, match, matchParticipant, displayName })` | cria o estado do jogo para o participante (Quiz: `Participant`) |
| `recoverMatch({ match })` | após reinício, diz que trabalho pendente a partida tem (Quiz: prazo da pergunta ou avanço do resultado) ou `null` |

O núcleo (`packages/database/src/platform/*`) resolve o adaptador pelo registro; **nunca** faz `if (gameKey === "quiz")`. Um jogo `AVAILABLE` com implementação realtime declarada e sem adaptador impede a inicialização. Não há `handleCommand` genérico nem evento `game:command`: comandos continuam do jogo. O adaptador do Quiz está **temporariamente** em `packages/database/src/games/quiz-adapter.js` porque reaproveita o serviço de snapshot/participantes que ainda mora no pacote; é registrado explicitamente em `createDatabase`, e o núcleo não o importa. Extrair para `packages/games/quiz` depende de mover o serviço da partida do Quiz.

### Participante, host e identidade

- `MatchParticipant.userId` referencia `Organizer` (identidade autenticada atual; nome legado mantido). Nenhuma relação pressupõe senha, e-mail como chave ou provedor único, então login social poderá usar a mesma identidade. `userId` é nulo somente em participantes anônimos **legados**; toda participação nova tem conta.
- `UNIQUE (gameSessionId, userId)`: uma conta não participa duas vezes da mesma partida.
- **Host não é papel do participante.** É uma referência nullable na partida (`GameSession.hostUserId`), ortogonal à participação: a mesma conta pode organizar e jogar. As salas do pool não têm host (não é obrigatório). Não há espectador nesta etapa.
- `leftAt` marca **saída explícita**. Desconexão (`Participant.disconnectedAt`) não é abandono; reconectar limpa `leftAt`.

### Modo solo

Solo é uma partida numa sala do pool com um participante: mesma infraestrutura durável (partida, `MatchParticipant`, pontuação, histórico, recuperação). Fica isolado de salas públicas porque a sala é ocupada e nenhum outro participante entra com a partida em andamento; não existe exceção que ignore o modelo genérico.

### Salas persistentes e capacidade

O pool continua fixo (criado por migration). `platform.rooms.create` existe para ferramentas de pool e testes e valida a modalidade. `capacity` **não** virou coluna: vem das capacidades do módulo no registro (`maxPlayers`), evitando um segundo valor divergente. `visibility`: o Quiz declara `supportsPrivateRooms: false`; nenhuma opção privada foi exposta. `GameSession.visibility` é legado do fluxo antigo.

### PostgreSQL versus Redis

PostgreSQL é a fonte de sala, partida, participação, resultado e histórico. Redis guarda apenas presença (TTL), locks, rate limits e a distribuição Socket.IO. Reiniciar uma instância não destrói partida: `platform.matches.recoverable()` lê só do PostgreSQL (no máximo uma partida viva por sala → limitado pelo pool) e cada jogo diz o que falta fazer. Detalhes e classificação das chaves em [RECUPERACAO-E-REDIS.md](RECUPERACAO-E-REDIS.md).

### Concorrência

| Operação | Proteção |
| --- | --- |
| Ocupar sala / iniciar partida | transação `Serializable` + `UPDATE … WHERE status='OPEN' AND currentSessionId IS NULL` (compare-and-set) + **índice único parcial** `GameSession(roomId) WHERE roomId IS NOT NULL AND status IN ('WAITING','ACTIVE')` |
| Participar duas vezes | `UNIQUE (gameSessionId, userId)` |
| Código de partida duplicado | `UNIQUE roomCode` |
| Liberar sala | `release(roomId, matchId)` idempotente e só vale para a partida atual (uma finalização tardia não libera a sala já ocupada por outra) |
| Finalizar | `finish` idempotente; avanço final protegido por lock Redis e reavaliação da fase |
| Resposta | `UNIQUE (partida, participante, pergunta)` |

## Migração

Três migrations, todas **aditivas** (nenhum drop de tabela/coluna, nenhum dado reescrito):

1. `20260924000100_platform_rooms_matches_participants` — `gameKey` em `Room`/`GameSession` (adicionado nulo → preenchido com `'quiz'`, a chave real do módulo → `NOT NULL`), `MatchParticipant` preenchida a partir de `Participant` com **o mesmo id** e a data original de entrada (`leftAt` nulo: nunca existiu), `Participant.matchParticipantId = id`, FK composta, índice único parcial. Idempotente no backfill (`NOT EXISTS`); não depende de Redis.
2. `20260924000200_match_game_state_optional` — `quizId`/`quizSnapshot` deixam de ser `NOT NULL` (todas as linhas atuais mantêm os valores).
3. `20260924000300_match_quiz_state_check_optional` — o CHECK do snapshot passa a aceitar "sem estado do Quiz"; para partidas com estado, a regra é a anterior.

Pré-condição documentada no SQL: não pode haver duas partidas vivas na mesma sala. Se houver, o índice parcial falha e a migration inteira é revertida (nada é modificado).

**Constraints que só existem no SQL** (Prisma não as modela): a FK composta `GameSession_roomId_gameKey_fkey`, o índice único parcial e o CHECK do snapshot. Por isso a equipe só usa `migrate deploy`; não rode `migrate dev` sem revisar o diff.

**Campos legados mantidos**: `GameSession.{quizId, quizSnapshot, matchPhase, currentQuestionIndex, questionStartedAt, questionEndsAt, hostTokenHash, hostUserId, visibility}`, `Room.quizId`, `Participant.{userId, joinedAt, disconnectedAt, lastSeenAt}` (cópias/estado do Quiz gravadas num único ponto) e o serviço `sessions.*` do Quiz.

## Protocolo e DTOs

Eventos e payloads de entrada não mudaram. Foi **adicionado** `gameKey` a `v1:room:state`, ao ACK de `v1:room:enter`, ao índice `v1:room:index`/`v1:room:list` e ao estado da partida (`v1:game:state`). Foi **removido** `currentSessionId` do índice público (era um id interno; nenhum cliente o usa). O runtime do Quiz só atende salas cujo `gameKey` é o do Quiz: uma sala de outra modalidade responde `ROOM_NOT_FOUND`, idêntico a uma sala inexistente. Novos códigos: `GAME_UNKNOWN`, `GAME_UNAVAILABLE`, `GAME_ADAPTER_MISSING`.

## Caminho para o Truco (sem implementá-lo)

Ver [ADICIONAR-UMA-MODALIDADE.md](ADICIONAR-UMA-MODALIDADE.md). Em resumo: registrar o módulo, criar salas com o `gameKey`, escrever o adaptador, e guardar estado do jogo em tabelas próprias ligadas ao `MatchParticipant`. Estado privado por participante (cartas) exigirá projeção por jogador, que não existe ainda.

## Dívidas assumidas

- Colunas e serviço de partida do Quiz ainda vivem em `GameSession`/`sessions.*`; extrair para `QuizMatchState` e para `packages/games/quiz` é a próxima etapa natural.
- `Room.quizId` (tema) é estado do Quiz numa tabela genérica.
- `Participant.disconnectedAt` continua durável e usado para decidir "ativo"; o desejável é derivar presença do Redis e usar `leftAt` para abandono.
- O lobby (`apps/realtime/src/lobby.js`) é o runtime do Quiz (`implementation.realtime`); ainda não há host de runtime genérico por `gameKey`.
- Prefixos `quizarena:*`, cookie `quizarena_session` e nomes `Organizer`/`GameSession` foram preservados de propósito.
- Acesso ao `next dev` por IP da rede local continua sem `allowedDevOrigins` (fora do escopo).
