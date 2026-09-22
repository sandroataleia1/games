# QuizArena

Fundação de um quiz multiplayer: tela principal na TV e celulares como controles. O lobby v1 permite escolher quiz publicado, criar sala, entrar com código e nome, acompanhar participantes e reassumir uma identidade anônima.

## Pré-requisitos

- Node.js 22.16+ compatível com as dependências e pnpm 11.4.0.
- Docker Engine/Desktop em execução, com Compose.
- No Windows, use `pnpm.cmd` caso o PowerShell bloqueie `pnpm.ps1`. Não é necessário alterar a política de execução.

## Instalação

Na raiz:

```powershell
pnpm.cmd install
Copy-Item .env.example .env
Copy-Item apps/web/.env.example apps/web/.env
Copy-Item apps/realtime/.env.example apps/realtime/.env
Copy-Item packages/database/.env.example packages/database/.env
pnpm.cmd infra:up
pnpm.cmd db:generate
pnpm.cmd db:migrate
pnpm.cmd db:seed
pnpm.cmd db:test:prepare
pnpm.cmd dev
```

Copie os exemplos apenas se os arquivos locais ainda não existirem. Em outros shells use `pnpm` e `cp`. As credenciais `onlinegames/onlinegames` são exclusivamente locais, sem valor em produção. Arquivos `.env` são ignorados; nunca coloque segredos reais nos exemplos.

O projeto usa exclusivamente pnpm workspaces e `pnpm-lock.yaml`. O lockfile npm da mesma aplicação foi removido após validar `pnpm install --frozen-lockfile`; não execute `npm install` neste monorepo. Caches pnpm ficam em `.local/`. As permissões de scripts de dependências estão em `allowBuilds`, conforme a [migração do pnpm 11](https://github.com/pnpm/pnpm.io/blob/main/blog/releases/11.0.md).

## Variáveis

| Arquivo              | Variável                      | Padrão                                                            |
| -------------------- | ----------------------------- | ----------------------------------------------------------------- |
| `apps/web/.env`      | `NEXT_PUBLIC_REALTIME_URL`    | `http://localhost:3001`                                           |
| `apps/realtime/.env` | `REALTIME_PORT`               | `3001`                                                            |
| `apps/realtime/.env` | `WEB_ORIGIN`                  | `http://localhost:3000`                                           |
| `apps/realtime/.env` | `REDIS_URL`                   | `redis://localhost:6379`                                          |
| `apps/realtime/.env` | `DATABASE_URL`                | `postgresql://onlinegames:onlinegames@127.0.0.1:5432/onlinegames` |
| `apps/realtime/.env` | `MAX_PLAYERS` / `LOBBY_TTL_SECONDS` | `20` / `21600` |
| `.env` da raiz       | `POSTGRES_PORT`, `REDIS_PORT` | `5432`, `6379`                                                    |

O Compose lê explicitamente o `.env` da raiz; cada aplicativo lê seu próprio `.env`. O arquivo da raiz não configura automaticamente os aplicativos. Reinicie o Next.js após alterar variáveis públicas e refaça o build de produção.

Nesta máquina, os arquivos locais usam **PostgreSQL 55433** e **Redis 56379** para preservar serviços preexistentes. O Compose publica apenas em loopback. Os exemplos continuam usando as portas padrão.

## Executar

- `pnpm dev`: web e realtime juntos; Ctrl+C encerra ambos.
- `pnpm dev:web` e `pnpm dev:realtime`: executar separadamente.
- `pnpm infra:up`: subir PostgreSQL 16 e Redis 7 e aguardar healthchecks.
- `pnpm infra:down`: parar containers deste projeto; preserva volumes.

Web: http://localhost:3000. Realtime: http://localhost:3001. Saúde: http://localhost:3001/health.

O indicador mostra “Servidor conectado” após um ping/pong válido. Redis/PostgreSQL são monitorados separadamente no endpoint de saúde; falhas retornam 503 e não derrubam o processo. O código da sala aceita digitação, mas os botões ficam desabilitados.

## Validação

```powershell
pnpm.cmd test
pnpm.cmd lint
pnpm.cmd build
pnpm.cmd check
```

`check` executa testes, lint e build, nessa ordem. Os testes Vitest substituem apenas as dependências externas; os testes HTTP e Socket.IO usam servidores reais em portas temporárias e não exigem containers.

Para repetir a verificação de navegador com os dois aplicativos em execução:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD/.local/browsers"
pnpm.cmd exec playwright install chromium
node scripts/smoke-web.js
```

O smoke usa Chromium sem janela, verifica desktop/celular, botões desabilitados, navegação por teclado, estados online/offline e ausência de overflow; grava screenshots em `.local/`.

## Problemas comuns no Windows

- `db:generate` com EPERM na DLL do Prisma: encerre realtime, Studio e outros processos deste projeto que estejam usando Prisma antes de gerar novamente. No Windows, a DLL n?o pode ser substitu?da enquanto estiver carregada.
- Porta ocupada ou bloqueada: ajuste `POSTGRES_PORT`/`REDIS_PORT` na raiz e as URLs correspondentes em `apps/realtime/.env` e `packages/database/.env`. Não encerre serviços de outros projetos.
- Docker: confirme que o Engine está ativo e que seu usuário pode acessar o pipe. A falta de acesso ao Docker impede a validação real, mas não os testes unitários.
- Configuração Docker inacessível: neste ambiente de sandbox, foi usado `docker --config ./infra ...` com um diretório local sem credenciais. Isso não altera configurações globais.
- Se necessário ao usar os scripts no sandbox: `$env:DOCKER_CONFIG = "$PWD/infra"`.
- `/health` 503: veja `docker compose --env-file .env -f infra/docker-compose.yml ps` e confira as URLs.
- Navegador offline: confira `NEXT_PUBLIC_REALTIME_URL`, `WEB_ORIGIN` e a porta 3001.
- Celular físico: `localhost` aponta para o celular. Para teste em LAN, configure a URL realtime com o IP do computador e CORS com a origem web correspondente, reinicie a web e permita somente as portas web/realtime no firewall. PostgreSQL e Redis continuam em loopback.

Veja [arquitetura](docs/ARCHITECTURE.md), [ADR](docs/ADR-001-web-realtime-separados.md) e [contratos](packages/contracts/README.md).

## Persist?ncia e comandos de banco

O pacote `packages/database` l? seu pr?prio `.env`. Configure `DATABASE_URL` para desenvolvimento (schema public) e `TEST_DATABASE_URL` para schema quizarena_test. Os exemplos s?o locais e fict?cios. Nesta m?quina, ambos usam PostgreSQL em `127.0.0.1:55433`; o endere?o IPv4 expl?cito evita timeouts observados com a resolu??o de localhost no Windows.

| Comando                | A??o                                                              |
| ---------------------- | ----------------------------------------------------------------- |
| `pnpm db:generate`     | Gera o cliente Prisma JavaScript ignorado pelo Git                |
| `pnpm db:migrate`      | Aplica migrations versionadas com migrate deploy                  |
| `pnpm db:seed`         | Cria Conhecimentos Gerais; reexecu??o n?o duplica nem sobrescreve |
| `pnpm db:studio`       | Abre Prisma Studio local para inspe??o manual                     |
| `pnpm db:test:prepare` | Aplica migrations no schema exclusivo de testes, sem reset        |

Depois de instalar depend?ncias em checkout novo, execute db:generate antes dos aplicativos e testes. N?o use prisma db push. As migrations n?o cont?m seed e n?o s?o executadas em runtime.

O seed tem seis perguntas com quatro alternativas e n?o cria partidas. A integra??o remove somente os IDs de teste da execu??o e verifica que contagens dos dados de desenvolvimento n?o mudaram. N?o h? comandos autom?ticos de reset/drop/truncate.

Ainda n?o h? autentica??o, ownership, API administrativa, gera??o de tokens/c?digos, ativa??o p?blica de sess?es ou estado realtime de partidas. O score n?o ? calculado neste incremento. Veja [modelo de dados](docs/DATA-MODEL.md) e [decis?o de snapshots](docs/ADR-002-persistencia-e-snapshots.md).
