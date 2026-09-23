# MultyGames Web

Next.js App Router em JavaScript. Código em `src/app`, CSS Modules e cliente Socket.IO isolado em `src/lib`.

Execute pela raiz: `pnpm dev:web`. Copie `.env.example` para `.env` antes de iniciar. Veja o README da raiz para infraestrutura, validação e configuração de URLs.

O efeito React abre uma conexão e remove listeners/desconecta no cleanup, inclusive durante remontagens do Strict Mode. Nenhuma conexão é criada durante renderizações. Os botões de partidas e salas permanecem desabilitados.
