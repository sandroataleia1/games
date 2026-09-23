# Protocolo realtime v1

Todos os comandos usam ACK `{ ok: true, data }` ou `{ ok: false, error: { code, message } }`. Os payloads são schemas Zod estritos em `packages/contracts`.

| Evento | Origem | Finalidade | Proteção |
| --- | --- | --- | --- |
| `v1:quiz:list` | cliente | listar quizzes publicados | somente resumo |
| `v1:room:create` | organizador | criar sala | quiz publicado, rate limit |
| `v1:room:join` | jogador | entrar com nome | transação, unicidade, limite |
| `v1:room:resume` | jogador | reassumir identidade | hash do token |
| `v1:host:resume` | organizador | reassumir sala | hash do token |
| `v1:room:leave` | jogador | sair voluntariamente | identidade do socket |
| `v1:room:state` | servidor | estado público | DTO sem dados privados |
| `v1:room:participant-joined` | servidor | anunciar entrada | DTO público |
| `v1:room:participant-updated` | servidor | anunciar reconexão | DTO público |
| `v1:room:participant-left` | servidor | anunciar saída | apenas id |

Erros estáveis: `INVALID_PAYLOAD`, `QUIZ_NOT_FOUND`, `QUIZ_NOT_PUBLISHED`, `ROOM_NOT_FOUND`, `ROOM_NOT_WAITING`, `ROOM_FULL`, `ROOM_CODE_CONFLICT`, `NAME_CONFLICT`, `INVALID_HOST_TOKEN`, `INVALID_RECONNECT_TOKEN`, `RATE_LIMITED`, `DEPENDENCY_UNAVAILABLE` e `INTERNAL_ERROR`.

O Redis Adapter usa publisher e subscriber separados, permitindo que host e jogador estejam em instâncias diferentes. PostgreSQL permanece a fonte permanente e a queda do Redis bloqueia comandos do lobby.

## Partida e pontuação

`v1:game:start` inicia a primeira pergunta apenas para o host autenticado. `v1:game:answer` aceita somente o identificador estável da alternativa; o servidor registra `answeredAt`, calcula `responseTimeMs` e rejeita prazo expirado ou duplicidade. A pontuação é `0` para erro/ausência e, para acerto, `basePoints + floor(basePoints * (1 - responseTimeMs / durationMs) * 0.5)`, limitada naturalmente a no máximo `1.5 * basePoints`. O desempate público usa score, depois ordem de entrada/ID.

As transições persistidas são `LOBBY -> QUESTION -> QUESTION_RESULT -> QUESTION` ou `FINISHED`. O timer usa `questionEndsAt` persistido e um lock Redis por sala/rodada; ao reiniciar, instâncias rearmam perguntas `QUESTION` existentes no PostgreSQL.

O lock usa `SET key ownerToken NX PX 120000`, com ownerToken criptograficamente aleatório. A liberação usa Lua atômico `GET`/`DEL` condicionado ao ownerToken e ocorre em `finally`; o TTL protege contra processo morto. O mesmo lock de sala/rodada coordena tanto o fechamento `QUESTION -> QUESTION_RESULT` quanto o avanço `QUESTION_RESULT -> QUESTION|FINISHED`, e cada operação relê a fase persistida dentro da seção crítica. O TTL de 120 segundos deixa margem sobre o limite transacional de três tentativas de até 15 segundos cada; ambas as seções críticas contêm somente leitura e transição no PostgreSQL, e broadcasts e projeções Redis ocorrem depois da liberação. Estados de resume são entregues diretamente no ACK e não contam como broadcast espontâneo. Mudanças de presença durante uma pergunta emitem somente `v1:game:state`; `v1:game:question` é reservado ao início efetivo de uma rodada.

## `gameKey` e compatibilidade (PLATFORM-07B)

Nenhum evento foi renomeado ou removido. Foi adicionado, de forma retrocompatível, o campo `gameKey` (chave estável do registro, hoje `"quiz"`) a `v1:room:state`, ao ACK de `v1:room:enter`, às entradas de `v1:room:index`/`v1:room:list` e a `v1:game:state`. Clientes antigos ignoram o campo. `currentSessionId` deixou de aparecer nas entradas públicas do índice de salas.

O runtime do Quiz só atende salas cujo `gameKey` é o do Quiz: uma sala de outra modalidade responde `ROOM_NOT_FOUND`, igual a uma sala inexistente, sem revelar dados. Novos códigos de erro: `GAME_UNKNOWN`, `GAME_UNAVAILABLE` (modalidade `COMING_SOON`/`DISABLED` não inicia partida) e `GAME_ADAPTER_MISSING`. Não existe evento universal de comando (`game:command`).

## Host genérico e runtimes (PLATFORM-07C)

O servidor realtime é um **host genérico** que resolve a modalidade de uma sala pelo `gameKey` (ADR-009). Eventos da plataforma (`v1:room:list`, `v1:room:enter`, `v1:room:leave`, `v1:match:start`, `v1:room:state`, `v1:room:index`, `v1:room:participant-*`) ficam no host; os eventos do Quiz (`v1:quiz:list`, `v1:room:theme-select`, `v1:game:answer`, `v1:game:next`, `v1:game:state`, `v1:game:question`, `v1:game:question-result`, `v1:game:ranking`, `v1:game:finished`) são registrados pelo runtime do Quiz. **Nenhum nome de evento nem ACK mudou.** Não existe evento universal (`game:command`): uma nova modalidade define os próprios eventos ao registrar seus handlers, e o host recusa registrar o mesmo nome duas vezes.

`v1:room:list` aceita `{ gameKey? }`: sem `gameKey`, o host responde com o único jogo servido (compatibilidade com clientes anteriores); com mais de um jogo, exige `gameKey` (`INVALID_PAYLOAD`). O índice é por jogo (canal `rooms:index:<gameKey>`). O estado público da sala é `{ roomNumber, gameKey, status, ...projeção do jogo, playerCount, players, serverTime }`; para o Quiz a projeção acrescenta `quizId` e `quizTitle`. Uma sala de jogo sem runtime responde `ROOM_NOT_FOUND`, igual a uma sala inexistente. `v1:game:answer`/`next`/`theme-select` numa sala de outra modalidade são recusados (`UNAUTHORIZED`/`ROOM_NOT_FOUND`).
