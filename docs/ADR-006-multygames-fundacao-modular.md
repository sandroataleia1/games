# ADR-006 — MultyGames: fundação modular de plataforma

## Contexto

A aplicação nasceu como "QuizArena", um único jogo. PLATFORM-07A rebatiza a marca
visível para **MultyGames** e extrai um registro modular de jogos, sem tocar no domínio
de salas, partidas ou autenticação. Esta ADR documenta as decisões dessa etapa e o
caminho pretendido para as etapas seguintes (07B em diante).

## MultyGames como plataforma, Quiz como primeiro módulo

```text
MultyGames Platform
├── identidade (contas, sessões)
├── catálogo (packages/game-registry)
├── navegação (portal em apps/web)
├── salas, presença (apps/realtime, ownerless room pool)
└── módulos de jogo
    └── quiz (packages/games/quiz)
```

O Quiz deixa de ser a identidade da plataforma e passa a ser o primeiro item registrado
nela. A página inicial, o cabeçalho, o manifest PWA e os textos institucionais agora
dizem "MultyGames"; "Quiz" continua sendo o nome do primeiro jogo, exibido como tal no
catálogo.

## Separação entre núcleo e jogos

`packages/game-registry` é genérico e não sabe nada sobre Quiz: define e valida o
formato de um `GameDefinition`/`GameModule` (schema Zod) e a estrutura de um registro
imutável (`createGameRegistry`), com busca por `key`/`slug`, listagem ordenada e filtro
de disponibilidade. `packages/games/quiz` é o único pacote que conhece o Quiz; exporta
um `GameModule` (`quizGame`) com metadados públicos e um campo `implementation`
puramente documentário (`{ web, realtime }`) apontando para onde a implementação real
mora — o pacote não importa `apps/web` nem `apps/realtime`, porque isso criaria uma
dependência circular (app → package → app) e misturaria código de servidor/rotas com um
pacote de metadados. A composição fica em `apps/web/src/lib/game-catalog.js`: o único
lugar que monta `createGameRegistry([quizGame])`. Adicionar um jogo futuro significa
criar `packages/games/<jogo>` e somar um item a esse array — nenhuma outra parte do
portal muda.

## Por que não generalizar regras de jogo

`GameModule` hoje carrega só metadados (`definition`, `capabilities` derivadas dela, e
`implementation` documentário). A tarefa também previa uma interface conceitual com
`createMatch()`, `handleCommand()`, `projectStateForPlayer()`, `resume()` e
`recoverActiveMatches()` — esses métodos **não foram adicionados**: o Quiz já tem uma
implementação completa e específica dessas operações em `apps/realtime/src/lobby.js`
(perguntas, cronômetro, pontuação, ranking, lock distribuído) que não se generaliza para
"qualquer jogo" sem saber as regras de um segundo jogo real. Um contrato como
`handleCommand(command)` para Quiz e para Truco provavelmente não compartilha quase
nada de útil além do nome do método — forçar essa abstração agora produziria classes
abstratas vazias sem uso real. Quando o Truco (ou outro módulo) começar a ser
implementado, a forma certa desse contrato ficará clara a partir de dois casos reais em
vez de um caso e uma suposição; até lá, o contrato executável fica deliberadamente
menor do que o pedido.

## Registro híbrido futuro

Hoje `createGameRegistry` recebe um array estático montado em código
(`apps/web/src/lib/game-catalog.js`) — apropriado enquanto só desenvolvedores adicionam
jogos. Um caminho futuro plausível é híbrido: **o código continua definindo a
implementação de cada módulo** (schema, capacidades, rota, pacote), mas uma tabela no
banco poderia controlar `status` (disponível/em breve/desabilitado) e ordenação de
exibição sem deploy — por exemplo para desabilitar um jogo temporariamente por
manutenção. Isso não existe ainda: não foi criada tabela `Game` nesta etapa, conforme
pedido explicitamente pela tarefa. Se/quando isso for implementado, o registro em
`packages/game-registry` precisaria de uma função para mesclar/sobrescrever `status` e
ordenação por uma fonte externa, mantendo `key`/`slug`/capacidades/rota como
autoritativos no código (nunca editáveis por fora, pois definem comportamento real).

## Nomes legados preservados

Por compatibilidade, os seguintes identificadores **internos** continuam com o prefixo
"quizarena" e não foram renomeados nesta etapa — nenhum é visível ao usuário final:

| Identificador | Onde | Por quê |
| --- | --- | --- |
| `@quizarena/*` (nomes de pacote) | `package.json` de cada workspace | renomear rompe todo import interno (`apps/realtime`, `apps/web`, `packages/database` importam `@quizarena/contracts`) por ganho puramente estético |
| Tabela `Organizer`, `OrganizerSession` | `packages/database/prisma/schema.prisma` | renomear tabela é migration com risco; a ADR-005 já documentou a decisão de expor a semântica `User` publicamente mantendo o nome interno |
| Cookie `quizarena_session` | `apps/realtime/src/api.js`, `server.js` | trocar invalida toda sessão ativa no primeiro deploy |
| Prefixos Redis `quizarena:*` | `apps/realtime/src/lobby.js`, `http-rate-limit.js` | trocar quebra rate limit e presença até o TTL antigo expirar, sem benefício |
| `organizador@quizarena.local` / senha `QuizArena2026` | seed de desenvolvimento (`packages/database/prisma/seed.js`) e ~10 arquivos de teste que fazem login com essa credencial fixa | é uma credencial de fixture, não uma marca visível; renomear exigiria editar todos os testes que a citam por um valor sem nenhum efeito de produto |
| `"Conteúdo QuizArena"` (nome padrão) | `scripts/seed-easy-quizzes.js` | script de seed local, parametrizável por `SEED_ORGANIZER_NAME`; não é executado em produção |

Nenhum desses nomes aparece na interface, em `/health`, em respostas HTTP públicas ou em
qualquer lugar que o usuário final veja.

## Caminho para Truco

Um segundo jogo seguiria o mesmo padrão: `packages/games/truco` com seu próprio
`GameModule` (`status: "COMING_SOON"` até ter implementação real), registrado em
`apps/web/src/lib/game-catalog.js`. Quando `games.length > 1`, o portal já alterna
automaticamente do card de destaque único para a grade responsiva (`apps/web/src/app/
page.js`, `home.module.css`) — isso já foi testado com um módulo `COMING_SOON`
fictício em `packages/game-registry/test.js`, sem exigir alteração posterior no portal.
A implementação real do Truco (regras, mesa, rodadas) pertence a `apps/realtime` e a um
módulo próprio, fora do escopo desta etapa.

## Preparação para identidade social

Não implementado nesta etapa. Documentado como requisito futuro: a conta (`Organizer`
internamente, `User` publicamente) hoje sempre tem `passwordHash`. Um login social
(Google/Facebook/Apple) exigiria um provedor de credencial que **não presume senha
local** — nem toda conta futura terá uma. Requisitos a observar quando isso for
desenhado:

- múltiplos provedores vinculados à mesma conta (local + Google, por exemplo);
- vinculação seria uma ação explícita e autenticada (reautenticar antes de vincular um
  novo provedor à conta já logada), nunca automática;
- nunca associar duas contas só porque o e-mail bate — e-mail de provedor social nem
  sempre é verificado da mesma forma que o e-mail local;
- prevenção de conta duplicada quando a mesma pessoa se cadastra primeiro localmente e
  depois via um provedor (ou vice-versa).

Nada disso está implementado; o login atual (e-mail/senha, sessão server-side por
cookie) permanece exatamente como está.

## Preparação para amigos

Não implementado nesta etapa. A camada social pertenceria à plataforma (não ao módulo
Quiz), documentada como: solicitação de amizade, amizade aceita, remoção, bloqueio,
presença ("quem está online"), jogo atual do amigo, convite direto para uma sala, e
controles de privacidade sobre quem vê o quê. Colocar isso dentro de `packages/games/
quiz` seria o mesmo erro que a tarefa pede para evitar: amigos são um recurso da
plataforma que qualquer jogo futuro também usaria, não uma regra do Quiz.

## Riscos de migração

Nenhuma migration de banco foi criada nesta etapa (nenhuma tabela `Game` foi
necessária). O risco desta etapa é inteiramente de código: quebrar o import de
`listAvailableGames`/`getGameBySlug` que antes vinha de `@quizarena/contracts`. Esse
import tinha um único consumidor (`apps/web/src/app/page.js`), confirmado por busca no
repositório antes da remoção; o arquivo antigo (`packages/contracts/src/games.js`) foi
removido para não deixar metadados do Quiz duplicados em dois lugares, e os testes que
o cobriam foram substituídos por testes equivalentes (e mais completos) em
`packages/game-registry/test.js`, `packages/games/quiz/test.js` e
`apps/web/src/lib/game-catalog.test.js`.
