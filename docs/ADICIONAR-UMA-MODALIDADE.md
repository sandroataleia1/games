# Como adicionar uma nova modalidade

Roteiro para um novo jogo (por exemplo, cartas). Nada aqui registra ou implementa um jogo real; o teste de referência é `apps/realtime/test/runtime-host.test.js` (jogo sintético coexistindo com o Quiz). Decisões: [ADR-008](ADR-008-salas-partidas-e-participantes-genericos.md) e [ADR-009](ADR-009-isolamento-do-quiz-e-runtime-por-modalidade.md).

Regra de dependência: o jogo importa as **primitivas** do núcleo (`@quizarena/database`), `@multygames/game-registry` e `@multygames/game-runtime`. Ele **não** importa o bootstrap, o catálogo nem outro jogo; e o núcleo/host nunca importam o jogo (o ESLint e `boundaries.test.js` barram).

## 1. Definição (web-safe)

`packages/games/<jogo>/src/definition.js`: `defineGameModule({ definition, implementation })` com `key` estável em kebab-case (é o `gameKey` gravado no banco — nunca mude), nome, descrição, status, capacidades (`minPlayers`, `maxPlayers`, `supportsSolo`, salas públicas/privadas) e `implementation.realtime` apontando para o runtime. `src/index.js` exporta **somente** a definição — é a única parte que o portal pode importar. `COMING_SOON` aparece no portal mas não recebe sala nem partida; só `AVAILABLE` recebe.

## 2. Categoria

Use `categoryKeys` com chaves de `GAME_CATEGORIES` (`packages/game-registry/src/categories.js`); crie a categoria lá se ela não existir. Categoria agrupa gêneros; nunca capacidades nem status. O filtro `/jogos?categoria=` aparece sozinho quando houver duas categorias públicas.

## 3. Runtime (servidor)

`packages/games/<jogo>/src/server/`: `defineGameRuntime({ gameKey, persistence, realtime })`:

- `persistence` — chamado pela plataforma **dentro da transação** de início de partida:
  - `prepareMatch({ tx, room })`: valida o setup da sala (o jogo pode ter sua própria configuração de sala) e devolve `{ prepared }`;
  - `createMatchState({ tx, match, prepared })`: cria o estado da partida **nas tabelas do jogo**;
  - `createParticipantState({ tx, match, matchParticipant, displayName })`: cria o estado do participante ligado ao `matchParticipant.id`.
- `realtime` — o que o host delega: `roomProjection` (`schema` + `extras(rooms)` com os campos públicos extras da sala), `registerHandlers(host)`, `onRoomEnter`, `onRoomLeave`, `onSocketDisconnect`, `onMatchStarted`, `recoverMatch` e, opcionalmente, `close`.

Não existe método de comando genérico: os comandos do jogo são **eventos próprios**.

## 4. Persistência própria

Tabelas do jogo (`<Jogo>RoomConfiguration`, `<Jogo>MatchState`, estado do participante) numa migration nova, seguindo o padrão do Quiz: `gameKey` constante com `CHECK` + FK composta `(id, gameKey) → Room|GameSession(id, gameKey)` (o banco impede estado do jogo em partida de outra modalidade), snapshot imutável se houver, retenção explícita. **Nada** do jogo em `GameSession`/`Room`/`MatchParticipant` (nada de pontuação, cartas ou JSON genérico). Adicione os objetos que só existem em SQL a `packages/database/tooling/sql-objects.js` para que `pnpm db:verify` os vigie. Um jogo novo não exige colunas em tabelas genéricas nem enum de banco.

## 5. Registro no composition root

`packages/game-catalog/src/index.js` (a única lista de jogos, usada pelo portal e pela plataforma) recebe o módulo; `packages/server-bootstrap/src/index.js` cria o servidor do jogo a partir das primitivas e inclui seu runtime em `createGameRuntimeRegistry`. Um jogo `AVAILABLE` com `implementation.realtime` e **sem** runtime impede a inicialização; um runtime sem definição também. Depois de criado, o registro é imutável.

## 6. Handlers específicos

Em `registerHandlers(host)`, use `host.bindCommand(evento, async (socket, payload) => dados)`: o host aplica rate limit e converte erros (`DomainError`) em ACKs `{ ok: false, error }`. Use nomes versionados e **próprios do jogo** (por exemplo `v1:<jogo>:...`); registrar um nome já usado é erro. Valide o payload com um schema estrito (nunca `any`). Antes de agir, confira que a sala do socket é do seu `gameKey` (`host.platform.rooms.get`) — sala de outra modalidade deve parecer inexistente (`ROOM_NOT_FOUND`). O `host` oferece só: `platform`, `ensureReady`, `emit`, `socketsIn`, `withLock`, `releaseRoom`, `broadcastRoom`, `broadcastIndex`, `logger`.

## 7. Projeção pública e privada

Emita apenas DTOs **públicos** com schema estrito. Estado privado do participante (cartas, gabarito) só vai no ACK/evento para aquele participante (`socket.emit`), nunca em `host.emit` para a sala. Nunca envie estado interno, tokens, hashes ou ids internos (`Room.id`, `currentSessionId`). `roomProjection.extras` só devolve campos públicos.

## 8. Recuperação

`recoverMatch({ match, room })` deve reconstruir **a partir das tabelas do jogo** o que uma partida viva precisa (temporizadores, projeções), de forma idempotente e segura com duas instâncias (use `host.withLock` para transições). O host chama isso para cada partida `ACTIVE` lida do PostgreSQL; uma exceção sua é registrada e não impede as outras partidas.

## 9. Testes

- Runtime: `defineGameRuntime` valida os hooks; registro (duplicado, sem definição, ausente para jogo `AVAILABLE`) — veja `packages/game-runtime/test.js`.
- Persistência: banco isolado de testes (`pnpm db:test:prepare`); constraints e FKs do jogo; migration em banco vazio e populado (`migration.test.js` é o modelo), e o `db:verify`.
- Protocolo: o jogo coexistindo com o Quiz no host (`runtime-host.test.js`); dados privados não vazam.
- Módulos **sintéticos** (`@multygames/server-bootstrap/testing`) só em testes — nunca registre um jogo de mentira na aplicação.

## Como um novo módulo obtém uma sala e cria uma partida

1. Crie salas com `platform.rooms.create({ number, gameKey })` (a chave precisa estar registrada e `AVAILABLE`); liste com `platform.rooms.list({ gameKey })`. A modalidade de uma sala não muda depois que ela tiver partida (o banco impede).
2. Quem estiver presente inicia com `v1:match:start` → `platform.matches.start(número, participantes)`: numa transação `Serializable`, valida modalidade disponível e runtime, exige sala `OPEN`, chama `prepareMatch`, cria a partida herdando o `gameKey` da sala, chama `createMatchState`, cria um `MatchParticipant` por conta existente + `createParticipantState`, e ocupa a sala por compare-and-set. Duplo clique ou outra instância recebem `ROOM_NOT_WAITING`.
3. O host então chama `onMatchStarted`; o ciclo da partida é do jogo. Ao terminar: `platform.matches.finish(db, id)` (idempotente) e `host.releaseRoom(roomId, matchId)` (só a partida atual libera).
4. Saída explícita: `platform.participants.markLeft`; desconexão não é saída; reentrada: `markPresent`.
