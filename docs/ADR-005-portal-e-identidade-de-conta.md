# ADR-005 — Portal de jogos e identidade de conta

## Plataforma, jogos e conteúdo

A plataforma expõe um catálogo de modalidades (`Game`) em `packages/contracts/src/games.js`:
um registro tipado e validado por schema Zod (`gameSchema`), com `id`, `slug`, `name`,
descrições curta e completa, `status` (`AVAILABLE` | `COMING_SOON` | `DISABLED`), `route`
e `icon`. A página inicial (`/`) lista apenas modalidades `AVAILABLE` via
`listAvailableGames()`; hoje só o Quiz está disponível. Um novo jogo se registra nesse
array sem qualquer alteração na página inicial. Não existe CRUD administrativo para o
catálogo porque as modalidades são controladas por deploy, não por usuários finais — um
banco ou painel para isso seria complexidade sem uso real no estágio atual.

O Quiz é a primeira modalidade, não a plataforma: `Game` (modalidade) e `Quiz` (conteúdo
jogável dentro da modalidade, como "Países" ou "Frutas") são conceitos distintos desde a
página inicial (`/`, mostra jogos) até `/jogos/quiz` (mostra quizzes publicados daquela
modalidade).

## `User` vs `Organizer`

O conceito de negócio é `User`: uma conta pode ser autora de quizzes, anfitriã e jogadora,
dependendo do papel exercido no recurso — não existe mais uma classificação fixa de conta.
Internamente, o modelo Prisma e o serviço permanecem nomeados `Organizer` (tabela
`Organizer`, `database.organizers`, `socket.data.organizer`): uma renomeação de tabela
tocaria toda a camada de repositórios, serviços e testes de integração por um ganho
puramente estético, e a task explicitamente pede para preferir compatibilidade a uma
renomeação destrutiva.

A semântica pública já é `User` em toda fronteira externa: as respostas HTTP usam
`{ user }` (`/api/auth/register`, `/api/auth/login`, `/api/auth/me`), e a interface usa
`user`, `setUser`, `checked` — nunca "organizer" fora do código de acesso a dados. Isso
mantém a superfície pública correta sem o custo de uma migration de renomeação sobre uma
tabela com FKs de `Quiz`, `GameSession`, `Participant` e `OrganizerSession`.

## Salas: de ad-hoc para pool persistente

O desenho original de GAME-06 prescrevia salas criadas sob demanda por um host, com
visibilidade `PUBLIC`/`PRIVATE`, capacidade, código de acesso e token de host separado do
papel de jogador. Esse desenho foi implementado e publicado, e depois substituído por
decisão de produto posterior (não desta ADR): um pool fixo de salas persistentes e sem
dono (`Room`, seed 1–24), onde qualquer conta autenticada entra, escolhe o tema e inicia a
partida — sem criação ad-hoc, sem visibilidade pública/privada por sala e sem token de
host. Os requisitos de autorização que sobrevivem à mudança (ownership de quiz, uso de
quiz publicado de terceiros, bloqueio de rascunho, prevenção de IDOR, sessão server-side)
continuam garantidos pelos mesmos mecanismos; os que dependiam do conceito de dono de sala
(token de host, papel "somente organizar", capacidade) não se aplicam ao modelo atual.
