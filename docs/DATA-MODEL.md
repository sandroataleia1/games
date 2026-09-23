# Modelo persistente da MultyGames

`Organizer` possui muitos `Quiz` e muitas sessões autenticadas. `OrganizerSession` guarda somente SHA-256 do token e expiração explícita. `Quiz.ownerId` é obrigatório e `Quiz.version` sustenta controle otimista. A migration cria um proprietário isolado para quizzes preexistentes antes de tornar a coluna obrigatória; o seed reassocia seu quiz ao organizador de desenvolvimento.

Quizzes usados por `GameSession` não podem ser removidos. Despublicar altera somente o conteúdo editável; sessões existentes continuam referenciando o snapshot imutável.

## Persistência do Quiz isolada (PLATFORM-07C)

Decisões e rollout no [ADR-009](ADR-009-isolamento-do-quiz-e-runtime-por-modalidade.md). Resumo do modelo atual:

| Tabela (Prisma) | Dono | Fonte de verdade de |
| --- | --- | --- |
| `Room`, `GameSession`, `MatchParticipant` | plataforma | sala, partida (fatos genéricos), participação |
| `QuizRoomConfiguration` (`roomId` PK) | módulo Quiz | tema (quiz) da sala |
| `QuizMatchState` (`matchId` PK) | módulo Quiz | snapshot e progresso da partida |
| `QuizParticipantState` (tabela `Participant`) | módulo Quiz | score, token e respostas do participante |
| `Answer` | módulo Quiz | respostas |

`QuizRoomConfiguration` e `QuizMatchState` têm `gameKey` constante (`CHECK = 'quiz'`) e FK composta para `Room`/`GameSession(id, gameKey)`: outra modalidade não pode ter estado do Quiz. **Colunas legadas** (espelho de rollout, sem ser fonte): `Room.quizId`; `GameSession.quizId`, `quizSnapshot`, `matchPhase`, `currentQuestionIndex`, `questionStartedAt`, `questionEndsAt`. A migration de contração que as remove está descrita no ADR-009 e **não** foi executada.

```mermaid
erDiagram
  Room ||--o| QuizRoomConfiguration : "tema (Quiz)"
  GameSession ||--o| QuizMatchState : "snapshot e progresso (Quiz)"
  Quiz ||--o{ QuizRoomConfiguration : "selecionado por"
  Quiz ||--o{ QuizMatchState : "origina"
  MatchParticipant ||--o| QuizParticipantState : "estado do Quiz"
```

Objetos que só existem em SQL (índice parcial, CHECKs, triggers) e a verificação por `pg_catalog` (`pnpm db:verify`): ADR-009. Auditoria legado × módulo: `pnpm db:audit-quiz`. `pnpm db:seed` pertence ao módulo Quiz (`@multygames/server-bootstrap`).

## Plataforma: salas, partidas e participantes (PLATFORM-07B)

Complementa as tabelas acima; decisões completas no [ADR-008](ADR-008-salas-partidas-e-participantes-genericos.md).

| Entidade | Camada | Papel |
| --- | --- | --- |
| `Room` | plataforma | ponto de encontro numerado do pool: `gameKey`, ocupação `OPEN`/`PLAYING`, `currentSessionId`. `Room.quizId` é o tema do Quiz (legado) |
| `GameSession` | plataforma (= partida) | uma execução: `gameKey` (igual ao da sala, garantido por FK composta), `status`, datas, `hostUserId` nullable. Colunas do Quiz (`quizId`, `quizSnapshot`, `matchPhase`, `currentQuestionIndex`, `questionStartedAt/EndsAt`) são nulas para outros jogos |
| `MatchParticipant` | plataforma | quem participou: `userId` (identidade autenticada), `joinedAt`, `leftAt` (saída explícita). Único por `(partida, usuário)` |
| `Participant` | módulo Quiz | estado do Quiz do participante (score, token, respostas); mesmo `id` do `MatchParticipant` |
| `Answer` | módulo Quiz | resposta e pontos |

```mermaid
erDiagram
  Room ||--o{ GameSession : "recebe partidas (1 viva por vez)"
  GameSession ||--o{ MatchParticipant : registra
  Organizer ||--o{ MatchParticipant : "identidade"
  MatchParticipant ||--o| Participant : "estado do Quiz"
  GameSession ||--o{ Answer : preserva
```

Invariantes no banco: `Room(id, gameKey)` único + FK `GameSession(roomId, gameKey)` com `RESTRICT` (partida não diverge da sala; a modalidade da sala não muda depois de ter partida); índice único parcial `GameSession(roomId)` para `WAITING`/`ACTIVE` (uma partida viva por sala); `MatchParticipant` único por `(partida, usuário)`; `Participant` ligado ao `MatchParticipant` da mesma partida por FK composta. `gameKey` é texto validado pelo registro em código, não enum.

Não há tabela `Game`: o catálogo vive em `@multygames/game-registry`.

## Projeções do lobby

PostgreSQL guarda a confirmação de `GameSession`, o snapshot histórico e `Participant`, incluindo somente hashes de tokens. Redis usa o prefixo `quizarena:lobby:` para `room:<ROOM_CODE>` (DTO público), `presence:<ROOM_CODE>:<PARTICIPANT_ID>` (presença efêmera) e `rate:<KIND>:<IDENTITY>` (janelas atômicas). A projeção e a presença usam `LOBBY_TTL_SECONDS`; rate limits usam TTL próprio. Redis não é fonte permanente e a projeção é reconstruída do PostgreSQL.

## Tabelas e relacionamentos

| Entidade       | Responsabilidade                                           | Integridade e índices                                                                                                         |
| -------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Quiz           | Catálogo editável, título, descrição e ciclo de publicação | UUID; título não vazio/normalizado; índice por status                                                                         |
| Question       | Enunciado, ordem, duração, pontos e explicação             | FK para Quiz; posição única por quiz e positiva; 5–120 segundos; 100–10.000 pontos                                            |
| QuestionOption | Texto e indicação de alternativa correta                   | FK para Question; posição única por pergunta e positiva; texto não vazio                                                      |
| GameSession    | Ocorrência de jogo e cópia histórica do quiz               | Código público único; FK restritiva para Quiz; JSONB; hash scrypt; índice por status/data e por quiz                          |
| Participant    | Identidade local da sessão e total persistido              | Nome normalizado único por sessão; FK restritiva; score inteiro não negativo; hash scrypt                                     |
| Answer         | Decisão de resposta calculada no servidor                  | Resposta única por sessão/participante/pergunta; FK composta garante participante da mesma sessão; tempo/pontos não negativos |

```mermaid
erDiagram
  Quiz ||--o{ Question : possui
  Question ||--o{ QuestionOption : possui
  Quiz ||--o{ GameSession : origina
  GameSession ||--o{ Participant : registra
  GameSession ||--o{ Answer : preserva
  Participant ||--o{ Answer : responde
```

UUIDs são atribuídos pelo Prisma. Datas usam `TIMESTAMPTZ(3)`, defaults do PostgreSQL e instantes UTC. A aplicação retorna `Date` nos registros e somente valores JSON no snapshot.

## Exclusão e histórico

Questões e alternativas usam cascata somente dentro do catálogo editável. Sessões, participantes e respostas usam `ON DELETE RESTRICT`; excluir um quiz com sessão é bloqueado. Não há operações públicas de exclusão neste incremento.

`Answer.questionRef` e `selectedOptionRef` são UUIDs do snapshot, sem FK para as tabelas editáveis. Mesmo após editar ou excluir uma pergunta original, a resposta permanece interpretável pelo JSON histórico. A FK composta `(participantId, gameSessionId)` impede associar respostas a participantes de outra sessão.

Os índices compostos iniciados por `gameSessionId` atendem buscas de participantes e respostas por sessão, sem índices redundantes.

## Regras de domínio versus banco

Os serviços usam transações `Serializable` em operações compostas e repetem até três tentativas em conflitos de serialização. Violações de unicidade são traduzidas para códigos de domínio.

- Serviço: título trim, validação Zod, ao menos uma pergunta na publicação, 2–6 alternativas, exatamente uma correta, normalização NFKC/trim/espaços/case do participante, referências ao snapshot e transições permitidas.
- Banco: PKs, FKs, unicidades, valores numéricos, textos essenciais não vazios, formato do código de sala, formato de hashes, raiz/versionamento/vínculo básico do snapshot e trigger de imutabilidade.
- A quantidade de alternativas e exatamente uma correta **não** são garantidas por índice simples; são verificadas dentro da transação do serviço, inclusive ao publicar.
- A normalização completa de nomes é responsabilidade do serviço. O banco torna única a chave normalizada recebida.
- A validade interna completa do JSON e a existência das referências de Answer no snapshot são verificadas pelo serviço. SQL direto não substitui essa validação.

## Ciclos de vida

Quiz nasce `DRAFT`. Somente rascunhos aceitam perguntas. Publicação exige validação completa e registra `publishedAt`. Arquivamento registra `archivedAt`. Republicar `ARCHIVED` é proibido; não há desarquivamento neste incremento.

Sessão nasce `WAITING` e aceita participantes nesse estado. Respostas exigem `ACTIVE`; finalização exige `ACTIVE` e é idempotente para `FINISHED`. `CANCELLED` está reservado no modelo. **Ainda não há comando público para iniciar ou cancelar sessão**; os testes preparam ACTIVE diretamente como fixture. Essas transições serão integradas ao próximo domínio realtime, sem alteração da interface agora.

O score do participante começa em zero. Registrar resposta persiste `isCorrect`, `responseTimeMs`, `pointsAwarded` e horário do servidor; não executa algoritmo de pontuação nem incrementa o score. A coerência de `isCorrect` com a alternativa histórica é validada. Os demais valores da decisão devem vir de código confiável do servidor, nunca diretamente do navegador.

## Snapshot v1

`buildQuizSnapshot(quizId)` lê o quiz completo em uma transação, exige publicação, ordena perguntas e alternativas, valida com Zod e devolve uma cópia profundamente congelada.

Contém `schemaVersion: 1`, `quizId`, `title`, perguntas com UUID/posição/enunciado/tipo/duração/pontos/explicação e alternativas com UUID/posição/texto/correção. É autossuficiente, serializável e não contém objetos Prisma.

O serviço de criação de sessão aceita esse snapshot como entrada interna confiável, revalida o JSON e exige que o quiz referenciado ainda esteja publicado. Não deve receber snapshots arbitrários do navegador. Ele não gera código de sala nem token.

A migration instala `GameSession_snapshot_immutable`, que rejeita mudanças de conteúdo em `quizSnapshot` ou no `quizId` da sessão com SQLSTATE 23514. Updates de status/datas e escrita do mesmo JSON continuam permitidos. A comparação é JSONB, independente da ordem das chaves.

O teste PostgreSQL `trigger bloqueia snapshot e quizId, permite atualizações legítimas` comprova ambas as situações. Outro teste altera o título e exclui perguntas originais, registra resposta e verifica a preservação histórica.

## Tokens

O chamador fornece tokens com 32–512 caracteres. O serviço aplica scrypt (N=16384, r=8, p=1), salt aleatório de 16 bytes e saída de 64 bytes. O formato persistido é `scrypt$v1$saltHex$hashHex`; tokens originais não são persistidos. O banco recusa formato plaintext nos campos de hash. DTOs de sessão/participante omitem hashes.

Geração, validação de posse, autenticação, revogação e transporte dos tokens estão adiados. O chamador futuro deverá fornecer tokens criptograficamente imprevisíveis; comprimento por si só não comprova entropia. O snapshot inclui gabaritos e é dado interno do servidor: endpoints futuros precisarão de DTOs específicos para os jogadores.

## API dos pacotes

`@quizarena/database` expõe só primitivas e serviços genéricos: `createClient`, `transaction`, `DomainError`, `parse`, hashing de tokens (`hashToken`/`verifyToken`), `createIdentityService` (registro, login, sessão), `createPlatform` (`rooms`, `matches`, `participants`, `policy`), `roomDTO`, `matchDTO`, `createDatabaseHealthProbe`. Não importa nenhum jogo.

`@multygames/server-bootstrap` (`createServerDatabase({ databaseUrl, maxPlayers, resultAdvanceMs, logger, legacyCompat })`) compõe tudo e devolve, além de `platform`, `runtimes`, `identity` e `quiz`, as vistas de compatibilidade usadas pelo realtime e pelos testes: `organizers` (identidade + autoria do Quiz), `quizzes`, `sessions` (serviço de partida do Quiz), `rooms` (`list`, `get`, `getById`, `selectTheme`, `startMatch`, `reopen`).

`@multygames/game-quiz/server` (`createQuizServer`) devolve `matches`, `rooms` (configuração), `authoring`, `content`, `states`, `compat` e `runtime`. Exporta também `auditQuizLegacy`, `seedDevelopment`.

`createDatabaseHealthProbe(databaseUrl)` expõe apenas `check()` e `close()`. Importar os pacotes não abre conexão. Prisma não é exportado. Erros: use `error.code` (ex.: `QUIZ_STATE_MISSING`, `GAME_UNKNOWN`, `GAME_UNAVAILABLE`, `ROOM_NOT_WAITING`, além dos listados abaixo).

## Migration, seed e isolamento dos testes

`pnpm db:migrate` aplica migrations versionadas com `prisma migrate deploy`. Não há `db push`, criação de tabelas em runtime nem seed embutido no SQL.

A migration inicial foi gerada com `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`; antes da primeira aplicação, recebeu CHECKs e trigger. A instrução fixa de criação de public foi removida para respeitar o schema da URL. O SQL aplicado não deve ser reescrito; evoluções exigem nova migration.

`pnpm db:seed` cria em uma transação o quiz publicado **Conhecimentos Gerais**, com UUID fixo, seis perguntas e quatro opções cada. Reexecuções preservam o mesmo registro e não alteram conteúdo existente. Se o UUID estiver ocupado por outro título/estado, falha com `SEED_CONFLICT`. Não cria sessões, participantes ou respostas.

Configure `packages/database/.env`:

- `DATABASE_URL`: schema de desenvolvimento (padrão public).
- `TEST_DATABASE_URL`: obrigatoriamente schema `quizarena_test`, diferente do desenvolvimento.

Execute `pnpm db:test:prepare` para aplicar a mesma migration no schema isolado. Não apaga dados. Testes reais não usam mocks de Prisma; criam registros com IDs próprios e removem **somente esses IDs**, em ordem de FK, no schema validado. O seed de teste permanece no schema de teste. A suíte compara as contagens de quizzes/sessões/participantes/respostas do desenvolvimento antes e depois para detectar interferência.

`pnpm test` e `pnpm check` exigem PostgreSQL e ambos os schemas preparados; testes não são silenciosamente ignorados sem banco. `pnpm test:unit` não exige PostgreSQL. Não há reset, truncate ou drop automático.

## Limitações

Sem autenticação, ownership, API administrativa, rotas de domínio, eventos de partida, geração de códigos/tokens, cronômetros, estado de partida em Redis ou cálculo realtime. PostgreSQL é permanente; Redis continua destinado a dados efêmeros.
