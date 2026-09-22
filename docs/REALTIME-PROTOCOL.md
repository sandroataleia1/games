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

O lock usa `SET key ownerToken NX PX 30000`, com ownerToken criptograficamente aleatório. A liberação usa Lua atômico `GET`/`DEL` condicionado ao ownerToken e ocorre em `finally`; o TTL protege contra processo morto. O mesmo lock de sala/rodada coordena tanto o fechamento `QUESTION -> QUESTION_RESULT` quanto o avanço `QUESTION_RESULT -> QUESTION|FINISHED`, e cada operação relê a fase persistida dentro da seção crítica. O TTL de 30 segundos excede com folga a seção crítica, limitada a uma transação local no PostgreSQL; broadcasts e projeção Redis do avanço ocorrem depois da liberação. Estados de resume são entregues diretamente no ACK e não contam como broadcast espontâneo. Mudanças de presença durante uma pergunta emitem somente `v1:game:state`; `v1:game:question` é reservado ao início efetivo de uma rodada.
