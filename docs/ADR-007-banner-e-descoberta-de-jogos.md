# ADR-007 — Banner rotativo e descoberta de jogos

## Contexto

PLATFORM-07A.2 reestrutura a página inicial: `Cabeçalho → Banner rotativo → Mais
jogados → Jogos recentes → Todos os jogos → Rodapé`, substituindo o bloco de texto
estático que ocupava o topo. Esta ADR documenta as decisões duradouras dessa mudança.

## Hierarquia do portal

```text
Cabeçalho          - compartilhado (SiteHeader), autenticação
Banner rotativo     - campanhas editoriais do portal (PortalCarousel)
Mais jogados        - modalidades, hoje = todas as AVAILABLE
Jogos recentes       - modalidades por data de entrada no catálogo
Todos os jogos       - link para /jogos
/jogos                - catálogo completo, todos os status
```

`Game` (modalidade, ex.: Quiz) continua distinto de `Quiz` (conteúdo jogado dentro da
modalidade, ex.: "Países"). Nenhuma seção do portal lista quizzes individuais como se
fossem jogos - isso já valia desde o ADR-006 e continua valendo aqui.

## Banner editorial vs. registro de jogos

As lâminas do carousel (`apps/web/src/lib/portal-slides.js`) são campanhas do portal,
não definições de jogo: têm seu próprio schema (`id`, `eyebrow?`, `title`,
`description`, `actionLabel`, `actionHref`, `visual`, `accent`), validado e imutável,
mas vivem fora de `packages/game-registry` e `packages/games/quiz` de propósito. Uma
lâmina pode apontar para o mesmo jogo duas vezes com enquadramentos diferentes (grupo
vs. solo) - isso é conteúdo de marketing, não uma segunda verdade sobre o Quiz. Colocar
esse texto dentro do módulo do jogo misturaria regra de negócio com copy de portal, que
é exatamente a separação que o ADR-006 já estabeleceu entre núcleo e jogos.

## Origem de "Mais jogados" e "Jogos recentes"

**Correção (PLATFORM-07A.3):** a primeira versão desta seção descrevia
`listMostPlayedGames()` como "retorna todas as modalidades `AVAILABLE`" - na prática
isso fazia "Mais jogados" significar apenas "Disponíveis", o que deixa de ser verdade
assim que existir um segundo jogo sem métricas. Corrigido abaixo.

Nenhuma das duas seções inventa métricas ou popularidade editorial.
`listMostPlayedGames(metrics, limit)` (`apps/web/src/lib/game-catalog.js`, regra em
`apps/web/src/lib/game-discovery.js`) aceita uma coleção de `GameActivityMetric =
{ gameKey, matchesPlayed }` - o formato que o PLATFORM-07B ou uma etapa posterior
precisa fornecer a partir de dados reais. Uma métrica é descartada (não lança erro) se:
a chave não corresponde a um jogo registrado; o jogo não está `AVAILABLE`; ou
`matchesPlayed` não é um inteiro finito ≥ 0. Métricas válidas decidem a ordem
(decrescente por `matchesPlayed`, empate desempatado por `key` em ordem alfabética,
para resultado determinístico). Sem nenhuma métrica válida:

* exatamente um jogo `AVAILABLE` → esse jogo aparece (é o único candidato possível,
  não uma estimativa editorial);
* dois ou mais jogos `AVAILABLE` → lista vazia. `GameSection` já omite a seção inteira
  quando a lista é vazia (sem título vazio) - isso volta a preencher sozinho assim que
  métricas reais chegarem, sem tocar no portal.

`GameDefinition` não ganhou nenhum campo de métrica; a contagem nunca é persistida
nesta etapa, só passada como parâmetro puro.

`listRecentGames(limit)` ordena por `definition.releasedAt` (mais recente primeiro) e
aceita `AVAILABLE` e `COMING_SOON` - "recente" descreve a entrada no catálogo, não se o
jogo já pode ser jogado. `DISABLED` é excluído da home (só aparece, com ação bloqueada,
no catálogo completo `/jogos`).

Ambas aceitam um limite (`SECTION_LIMIT = 6` por padrão) para quando houver mais
modalidades; hoje, com um único jogo `AVAILABLE`, o Quiz aparece nas duas seções e no
catálogo completo - isso é factual e temporário, não um bug.

## `releasedAt`

Novo campo obrigatório em `GameDefinition` (`packages/game-registry/src/schema.js`),
validado como data-hora ISO 8601, sem valor padrão. Representa a data em que a
modalidade entrou no catálogo da MultyGames - para o Quiz, isso é o timestamp real do
commit `5cc7cd0` (PLATFORM-07A, quando o registro modular foi criado), não a data de
build nem "agora". Um jogo futuro precisa desse valor real no momento em que for
registrado; não deve ser preenchido com a data em que alguém rodou `git commit` para
uma correção não relacionada.

## Componentes reutilizáveis

`GameCard` (`apps/web/src/components/game-card.js`) é a única implementação de card de
jogo, usada em três lugares (Mais jogados, Jogos recentes, catálogo `/jogos`) via a
prop `variant` (`compact` | `catalog`). Não foi criada uma variante `featured`: nada no
portal hoje precisa dela, e criar uma variante sem uso real contrariaria a instrução de
não antecipar cenários.

**Bloqueio centralizado (PLATFORM-07A.3):** se um jogo `COMING_SOON` ou `DISABLED`
aparecer num card, ele nunca renderiza um link de início, em nenhuma variante e em
nenhuma página - isso é decidido uma única vez por `resolveCardState()`
(`apps/web/src/lib/game-card-state.js`), não recalculado por chamador. `playable` só é
`true` quando `status === "AVAILABLE"`; qualquer outro valor produz um `<button
disabled>` com o rótulo do status, nunca um `<a href>`. O selo de status fica oculto na
variante `compact` somente enquanto `AVAILABLE` (mantém o card enxuto no caso comum);
para qualquer outro status, o selo aparece mesmo em `compact` - "discreto" não pode
significar "silencioso" sobre um jogo que não pode ser iniciado. A variante `catalog`
sempre mostra o selo, disponível ou não.

## Server vs. Client Components

`page.js` (`/`) e `jogos/page.js` (`/jogos`) são Server Components - nenhum dos dois
tem estado ou efeito, então nenhum precisa de `"use client"`. Só duas peças realmente
interativas viraram Client Component: `SiteHeader` (busca `/auth/me`, tem `onClick` de
logout) e `PortalCarousel` (autoplay, pausa por hover/foco/aba oculta, teclado).
`GameCard` e `GameSection` são componentes de servidor puros. Isso significa que o HTML
da primeira lâmina do banner, dos cards de "Mais jogados"/"Jogos recentes" e de todo o
catálogo `/jogos` chega pronto no primeiro payload, sem depender de hidratação para
aparecer.

## Rota `/jogos`

Nova rota, metadata própria (`apps/web/src/app/jogos/catalog-metadata.js`), usa
`listGames()` (todas as modalidades, qualquer status) - diferente da home, que usa
`listMostPlayedGames()`/`listRecentGames()` (ambas filtram ou ordenam, nunca mostram
"tudo" indiscriminadamente). Não há paginação: com um jogo, seria complexidade sem
propósito; a grade (`repeat(auto-fill, minmax(240px, 320px))`) já se comporta
corretamente conforme mais módulos forem registrados.

## Categorias

Categorias são gêneros/famílias de jogos (`TRIVIA`, no futuro `CARDS`, `BOARD`...), não
regras de uma modalidade. A relação é muitos-para-muitos: um jogo declara
`categoryKeys` (ao menos uma, sem repetir) e uma categoria pode conter vários jogos.
O nome e a descrição vivem uma única vez, na definição da categoria
(`packages/game-registry/src/categories.js`); o jogo referencia só a chave estável
(`^[A-Z][A-Z0-9_]*$`), nunca texto livre. Uma chave inexistente faz
`createGameRegistry` lançar erro na inicialização; chaves e slugs duplicados também.

**Categoria não é capacidade.** Modo solo, multiplayer, sala pública/privada, quantidade
de jogadores e status (disponível/em breve) continuam em `capabilities` e `status` do
jogo - nunca viram categoria.

**Fonte autoritativa hoje:** código. Só `TRIVIA` (`slug: trivia`, "Quiz e
conhecimentos") está registrada, vinculada ao Quiz; nenhuma categoria futura vazia
existe. `CARDS` só entra junto do módulo do Truco. Não há tabela no banco.
Consultas do registro: `listCategories()` (ordem por `displayOrder`, depois `key`),
`getCategoryByKey`, `getCategoryBySlug`, `listGamesByCategory(key)` e
`listPublicCategories()` (DTO simples, só categorias com ao menos um jogo não
`DISABLED`). Nada no portal ramifica por jogo (`if game.key === ...`); a associação vem
só de `categoryKeys`.

**URLs e filtro em `/jogos`:** `/jogos?categoria=<slug>` (ex.: `/jogos?categoria=trivia`).
A filtragem é feita no servidor (`buildCatalogView`, `apps/web/src/lib/catalog-view.js`)
e os controles são `<a>` comuns, então a página funciona sem JavaScript e cada visão é
compartilhável. A barra de filtros ("Todos" + categorias) só aparece com duas ou mais
categorias públicas; com uma só, a categoria aparece apenas como selo no card (variante
`catalog`; a home não mostra o selo). Slug desconhecido não esvazia a página: mostra
todos os jogos com o aviso "Categoria não encontrada".

**Critério para persistir no banco:** só quando alguém precisar mudar a ordem ou a
visibilidade de uma categoria sem deploy. Nesse caso o banco controlaria apenas
`displayOrder` e visibilidade; `key`, `slug` e a referência `categoryKeys` continuariam
definidas no código, que seguiria como fonte das chaves.
