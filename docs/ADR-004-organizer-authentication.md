# ADR-004 — Autenticação e gerenciamento de quizzes


## Limite distribuído de autenticação

Cadastro e login consomem orçamentos no Redis por IP normalizado e por e-mail
normalizado. Cada chave usa SHA-256 e um namespace configurável, sem armazenar
o identificador original. O incremento e a expiração são executados por um
script Lua atômico, portanto instâncias diferentes compartilham o mesmo limite.
Respostas bloqueadas usam `429 RATE_LIMITED` e `Retry-After`. Se o Redis estiver
indisponível, a API falha fechada com `503 COORDINATION_UNAVAILABLE`.

`TRUST_PROXY=true` confia em exatamente um salto de proxy. O valor padrão é
`false`, para que cabeçalhos encaminhados pelo cliente não definam sua identidade.
O servidor `apps/realtime` permanece responsável por HTTP, Socket.IO, autenticação e orquestração do domínio. O pacote `@quizarena/database` concentra Prisma, regras de propriedade e transações. O Next.js usa rewrite de `/api` para preservar same-origin no navegador e não acessa o banco.

As sessões de conta são server-side: o navegador recebe apenas um token aleatório em cookie `HttpOnly`, `SameSite=Lax`, com expiração de oito horas e `Secure` em produção; somente SHA-256 do token é persistido. Senhas usam scrypt com salt. Login substitui sessões anteriores. Socket.IO lê o mesmo cookie no handshake. O token efêmero de host continua separado e limitado à sala.

Toda mutação HTTP exige `Origin` configurado, JSON e corpo de até 32 KiB. Cadastro e login têm limite por IP. A autorização deriva sempre da sessão, e recurso alheio responde como inexistente.
