# QuizArena

Fundação de um quiz multiplayer: tela principal na TV e celulares como controles. Este incremento contém apenas interface inicial, conexão Socket.IO, ping/pong validado e saúde de Redis/PostgreSQL. Criar e entrar em partidas permanecem desabilitados.

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
pnpm.cmd infra:up
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
| `apps/realtime/.env` | `DATABASE_URL`                | `postgresql://onlinegames:onlinegames@localhost:5432/onlinegames` |
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

- Porta ocupada ou bloqueada: ajuste `POSTGRES_PORT`/`REDIS_PORT` na raiz e as URLs correspondentes em `apps/realtime/.env`. Não encerre serviços de outros projetos.
- Docker: confirme que o Engine está ativo e que seu usuário pode acessar o pipe. A falta de acesso ao Docker impede a validação real, mas não os testes unitários.
- Configuração Docker inacessível: neste ambiente de sandbox, foi usado `docker --config ./infra ...` com um diretório local sem credenciais. Isso não altera configurações globais.
- Se necessário ao usar os scripts no sandbox: `$env:DOCKER_CONFIG = "$PWD/infra"`.
- `/health` 503: veja `docker compose --env-file .env -f infra/docker-compose.yml ps` e confira as URLs.
- Navegador offline: confira `NEXT_PUBLIC_REALTIME_URL`, `WEB_ORIGIN` e a porta 3001.
- Celular físico: `localhost` aponta para o celular. Para teste em LAN, configure a URL realtime com o IP do computador e CORS com a origem web correspondente, reinicie a web e permita somente as portas web/realtime no firewall. PostgreSQL e Redis continuam em loopback.

Veja [arquitetura](docs/ARCHITECTURE.md), [ADR](docs/ADR-001-web-realtime-separados.md) e [contratos](packages/contracts/README.md).
