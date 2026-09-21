# ADR-001 — Web e realtime separados

Status: aceito para GAME-FOUNDATION-01.

## Contexto

A aplicação usa uma tela principal e celulares como controles. Conexões persistentes, contagem de tempo e futura pontuação exigem uma autoridade independente da renderização de páginas e dos ciclos de vida do Next.js.

## Decisão

Separar Next.js (`apps/web`) e Express/Socket.IO (`apps/realtime`) em processos no mesmo monorepo pnpm. Compartilhar contratos JavaScript/Zod em `packages/contracts`. PostgreSQL será persistência permanente; Redis sustentará estado efêmero e coordenação futura.

## Alternativas

Manter Socket.IO e partidas dentro do Next.js acoplaria o ciclo de vida das conexões ao frontend e dificultaria escalabilidade independente. Microserviços adicionais ou NestJS não são necessários para esta fundação.

## Consequências

Dois processos e uma origem CORS configurável precisam ser operados. Em troca, o realtime pode evoluir e escalar independentemente; contratos compartilhados reduzem divergências. Redis sozinho não habilita múltiplas instâncias: adapter, distribuição do estado e testes de concorrência serão necessários depois.

O documento anterior `ADR-001-separacao-web-realtime.md` foi preservado como referência histórica; este é o ADR vigente do incremento.
