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

Nenhuma das duas seções inventa métricas. `listMostPlayedGames()`
(`apps/web/src/lib/game-catalog.js`) hoje apenas retorna as modalidades `AVAILABLE` -
não existe `popularityScore`, contagem de partidas ou de jogadores em lugar nenhum do
contrato. Essa função é o único lugar que precisaria mudar quando uma métrica real
existir; o portal não seria tocado. `listRecentGames()` ordena por
`definition.releasedAt` (mais recente primeiro) e não filtra por status - um jogo
`COMING_SOON` pode aparecer aí legitimamente, já que "recente" descreve a entrada no
catálogo, não se o jogo já pode ser jogado.

Ambas aceitam um limite (`SECTION_LIMIT = 6` por padrão) para quando houver mais
modalidades; hoje, com um único jogo, o Quiz aparece nas duas seções e no catálogo
completo - isso é factual e temporário, não um bug.

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
prop `variant` (`compact` | `catalog`) - a única diferença real entre elas é que
`catalog` mostra o selo de status e desabilita a ação quando o jogo não está
`AVAILABLE`, porque só a rota `/jogos` lista jogos fora desse status. Não foi criada
uma variante `featured`: nada no portal hoje precisa dela, e criar uma variante sem uso
real contrariaria a instrução de não antecipar cenários.

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
