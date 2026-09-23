# Recuperação e uso do Redis

Regra: **PostgreSQL é a fonte de verdade** de sala, partida, participação, resultado e histórico. Redis guarda só coordenação, presença, locks e limites — nada que não possa ser perdido ou refeito. Os prefixos `quizarena:*` foram preservados (renomear invalidaria chaves em uso).

## Inventário de chaves

| Chave | Finalidade | TTL | Durável? | Reconstruível? |
| --- | --- | --- | --- | --- |
| `quizarena:room:presence:<sala>:<contaId>` | quem está na sala agora (nome de exibição) | `LOBBY_TTL_SECONDS` (padrão 6 h; rede de segurança) | Não | Sim: os clientes reentram; ao iniciar, só contas existentes viram participantes |
| `quizarena:lobby:game:lock:<partidaId>:<rodada>` | exclusão mútua ao fechar/avançar uma rodada | 120 s, liberado em `finally` (Lua com dono) | Não | Sim: o lock é só coordenação; a fase é relida do PostgreSQL dentro da seção crítica |
| `quizarena:lobby:rate:<kind>:<identidade>` | limite de comandos do lobby | janela de 60 s | Não | Sim (zerar só relaxa o limite) |
| `quizarena:http:rate-limit:*` | limite de autenticação HTTP | janela configurável | Não | Sim |
| canais `socket.io#…` (adapter) | propagar eventos entre instâncias | pub/sub, sem armazenamento | Não | Sim |

Não há resultado, ranking, participante, partida ou snapshot no Redis. Leitura de presença usa `SCAN` com `COUNT` (nunca `KEYS`); a única ocorrência de `KEYS` no repositório é a limpeza de testes. Não existe limpeza global destrutiva.

## Recuperação após reinício

1. `lobby.connect()` chama `database.platform.matches.recoverable()`.
2. O serviço lê **apenas do PostgreSQL** as partidas `ACTIVE` com sala (`LIMIT 200`; há no máximo uma viva por sala — índice único parcial — e o pool é fixo).
3. Para cada uma, resolve o adaptador do jogo pelo `gameKey` e chama `recoverMatch`. O Quiz responde `question-deadline` (rearmar o temporizador com `questionEndsAt`) ou `result-advance`. Partida de jogo sem adaptador é ignorada, nunca adivinhada.
4. Presença não é recuperada: quem estava conectado reentra e a partida é retomada por `resumePresenceForAccount`.

Redis indisponível: os comandos do lobby falham fechados com `DEPENDENCY_UNAVAILABLE` (`/health` responde 503) e o estado do PostgreSQL não é tocado. Dois processos iniciando a mesma sala: um vence, o outro recebe `ROOM_NOT_WAITING`; o banco impede duas partidas vivas na mesma sala mesmo sem passar pelo serviço.
