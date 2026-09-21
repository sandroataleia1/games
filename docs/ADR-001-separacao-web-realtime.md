# ADR-001: Separação entre web e realtime

## Decisão

Manter o frontend Next.js e o servidor Socket.IO em processos e workspaces separados.

## Motivo

Partidas multiplayer precisam de um processo autoritativo, persistente e independente do ciclo de renderização do Next.js. Isso permite escalar o realtime separadamente e evita que salas dependam da memória de uma instância web.

## Consequências

O navegador se conecta ao realtime por `NEXT_PUBLIC_REALTIME_URL`. Contratos e schemas ficam em `packages/contracts`, sem dependência de Express ou Next.js. PostgreSQL e Redis são dependências explícitas verificadas pelo endpoint `/health`.
