# Arquitetura

O processo realtime também hospeda a API HTTP autenticada. Isso reaproveita a conexão Prisma e mantém uma única autoridade para criar salas. O frontend Next.js encaminha `/api/*` ao processo realtime e envia o cookie no handshake Socket.IO.

## Responsabilidades

- `apps/web`: Next.js App Router JavaScript. Interface inicial e futuras APIs administrativas; **não mantém salas em memória** nem importa Prisma.
- `apps/realtime`: Express/Socket.IO. Autoritativo para salas, participantes e presença do lobby; partidas e pontuação continuam adiadas.
- `packages/contracts`: constantes dos eventos, enums de domínio, schemas Zod de perguntas e snapshot v1.
- `packages/database`: Prisma, migrations, seed, repositories específicos e serviços transacionais. Único ponto de acesso persistente.
- PostgreSQL 16: catálogo, sessões, participantes, respostas e snapshots históricos permanentes.
- Redis 7: projeção efêmera do lobby, presença, rate limits, adapter Socket.IO e coordenação entre instâncias.

## Persistência

A interface e os eventos Socket.IO permanecem inalterados. A persistência é uma API interna independente. Não há controladores de domínio, autenticação, ownership, QR Code ou administração.

O pacote não conecta ao ser importado e não executa migrations em runtime. Cada consumidor cria a instância explicitamente e chama `close()`. Prisma e SQL permanecem dentro do pacote.

O catálogo é editável; sessões guardam uma cópia autossuficiente, validada e imutável no PostgreSQL. As respostas referenciam IDs do snapshot. O cliente não calculará a pontuação final nem determinará o tempo autoritativo; a persistência recebe decisões do servidor.

Veja [modelo de dados](DATA-MODEL.md) e [ADR-002](ADR-002-persistencia-e-snapshots.md).

## Saúde e ciclo de vida

`createDatabaseHealthProbe(databaseUrl)` fornece ao realtime apenas `check()` e `close()`. Redis continua independente, em `apps/realtime/src/dependencies.js`. O health checker mantém injeção de funções substituíveis em testes.

`GET /health` retorna HTTP 200 somente com PostgreSQL e Redis saudáveis; falhas retornam 503 e a dependência afetada. Há limite de tempo no health checker; falhas temporárias não encerram o processo. Encerramento libera Socket.IO, HTTP, cliente Prisma e Redis, com prazo máximo de cinco segundos.

O indicador da web confirma comunicação Socket.IO/ping-pong, não substitui o health check.

## Lobby e evolução adiada

O lobby usa eventos versionados, Redis Adapter e hidratação a partir do PostgreSQL quando uma projeção expira. O cliente recebe apenas DTOs públicos; tokens e gabaritos permanecem no servidor. A queda de um cliente marca sua presença como desconectada sem excluir imediatamente o participante. A aba fechada perde a credencial anônima mantida em `sessionStorage`.

O incremento atual não inicia sessões por interface, não processa perguntas, cronômetros, respostas ou pontuação realtime.
