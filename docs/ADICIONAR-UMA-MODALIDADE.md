# Como um novo módulo obtém uma sala e cria uma partida

Roteiro para uma nova modalidade (por exemplo, um jogo de cartas). Nada disso registra ou implementa um jogo real.

1. **Módulo e registro.** Crie `packages/games/<jogo>` com `defineGameModule({ definition, implementation })` (`key` estável em kebab-case, categorias, capacidades, `status`). Inclua o módulo em `packages/game-catalog/src/index.js` — é a única lista de jogos; portal e plataforma a leem de lá. `COMING_SOON` aparece no portal mas **não** recebe sala nem partida; só `AVAILABLE` recebe.
2. **Salas.** Crie salas com `database.platform.rooms.create({ number, gameKey })`. A chave precisa estar registrada e disponível. A modalidade de uma sala nunca muda depois que ela tiver partida (o banco impede). Liste por jogo com `database.platform.rooms.list({ gameKey })`.
3. **Adaptador de servidor.** Implemente e registre um `defineGameServerAdapter({ gameKey, prepareMatch, createParticipantState, recoverMatch })` e passe-o a `createDatabase({ adapters })`. Sem adaptador, um jogo `AVAILABLE` que declara `implementation.realtime` **impede a inicialização**.
   - `prepareMatch({ tx, room })`: valida o setup da sala e devolve `{ columns }` para a linha da partida (pode ser `{}`; as colunas `quizId`/`quizSnapshot` são exclusivas do Quiz e ficam nulas).
   - `createParticipantState(...)`: crie o estado do jogo ligado ao `matchParticipant.id` (tabela própria; score, mão, respostas **não** vão para tabelas genéricas).
   - `recoverMatch({ match })`: o que ainda precisa acontecer após um reinício, ou `null`.
4. **Criar a partida.** `database.rooms.startMatch(número, participantes)` (ou `database.platform.matches.start`) faz, numa transação `Serializable`: valida modalidade disponível e adaptador; exige sala `OPEN`; chama `prepareMatch`; cria a partida herdando o `gameKey` da sala; cria um `MatchParticipant` por conta existente e chama `createParticipantState`; ocupa a sala por compare-and-set. Uma segunda tentativa simultânea (duplo clique, outra instância) recebe `ROOM_NOT_WAITING`.
5. **Ciclo da partida.** Fases e comandos são do jogo. Ao terminar, marque a partida `FINISHED` e libere a sala com `platform.rooms.release(roomId, matchId)` (idempotente; só a partida atual libera).
6. **Saída e reconexão.** Saída explícita: `platform.participants.markLeft`. Desconexão não é saída. Reentrada: `markPresent`.
7. **Protocolo.** Reaproveite os DTOs com `gameKey`. Não existe evento genérico de comando: eventos do jogo são versionados e ficam no runtime do jogo (`implementation.realtime`), que só atende salas do seu `gameKey`.
8. **Testes.** Use módulos sintéticos apenas em testes (veja `packages/database/test/platform.test.js`); não registre um jogo real na aplicação para testar.
