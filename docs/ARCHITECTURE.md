# Arquitetura

## Responsabilidades

- `apps/web`: Next.js App Router JavaScript. Interface inicial e futuras APIs administrativas; **não mantém salas em memória** nem importa Prisma.
- `apps/realtime`: Express/Socket.IO. Continua somente com ping/pong e health check. Futuramente será autoritativo para partidas e pontuação.
- `packages/contracts`: constantes dos eventos, enums de domínio, schemas Zod de perguntas e snapshot v1.
- `packages/database`: Prisma, migrations, seed, repositories específicos e serviços transacionais. Único ponto de acesso persistente.
- PostgreSQL 16: catálogo, sessões, participantes, respostas e snapshots históricos permanentes.
- Redis 7: integração e saúde já disponíveis; estado efêmero de partidas, adapter e coordenação entre instâncias continuam adiados.

## Persistência

A interface e os eventos Socket.IO permanecem inalterados. A persistência é uma API interna independente. Não há controladores de domínio, autenticação, ownership, QR Code ou administração.

O pacote não conecta ao ser importado e não executa migrations em runtime. Cada consumidor cria a instância explicitamente e chama `close()`. Prisma e SQL permanecem dentro do pacote.

O catálogo é editável; sessões guardam uma cópia autossuficiente, validada e imutável no PostgreSQL. As respostas referenciam IDs do snapshot. O cliente não calculará a pontuação final nem determinará o tempo autoritativo; a persistência recebe decisões do servidor.

Veja [modelo de dados](DATA-MODEL.md) e [ADR-002](ADR-002-persistencia-e-snapshots.md).

## Saúde e ciclo de vida

`createDatabaseHealthProbe(databaseUrl)` fornece ao realtime apenas `check()` e `close()`. Redis continua independente, em `apps/realtime/src/dependencies.js`. O health checker mantém injeção de funções substituíveis em testes.

`GET /health` retorna HTTP 200 somente com PostgreSQL e Redis saudáveis; falhas retornam 503 e a dependência afetada. Há limite de tempo no health checker; falhas temporárias não encerram o processo. Encerramento libera Socket.IO, HTTP, cliente Prisma e Redis, com prazo máximo de cinco segundos.

O indicador da web confirma comunicação Socket.IO/ping-pong, não substitui o health check.

## Evolução adiada

Redis permitirá coordenação entre instâncias futuramente; ainda não há adapter nem sincronização distribuída. A queda de um cliente não poderá invalidar toda a partida. Eventos receberão versão ao evoluírem; snapshots já possuem schemaVersion 1.

O incremento atual não gera código de sala ou token, não inicia sessões por interface, não processa cronômetros e não calcula pontuação realtime.
