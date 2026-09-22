# ADR-002 — Persistência PostgreSQL e snapshots de partidas

Status: aceito no GAME-DOMAIN-02.

## Contexto

Perguntas editáveis não podem ser a fonte histórica de uma partida. Precisamos persistir catálogo, sessões, participantes e respostas sem acoplar os aplicativos ao ORM.

## Decisão

Usar PostgreSQL 16 e Prisma 6.19.3 encapsulado em `packages/database`. O [generator prisma-client-js](https://www.prisma.io/docs/orm/v6/prisma-schema/overview/generators) mantém o código de aplicação em JavaScript e é compatível com o Node.js 22 do projeto. Prisma CLI e Client ficam fixados na mesma versão.

Repositories são específicos de quiz e sessão. Serviços validam regras Zod compartilhadas em `packages/contracts`; operações compostas usam transações Serializable. Não haverá ORM nos aplicativos nem criação de tabelas ao iniciar o servidor.

Ao criar uma sessão, persistir JSONB versionado e completo do quiz publicado. IDs históricos de perguntas e alternativas pertencem ao snapshot, não a FKs de tabelas editáveis. Congelar as cópias retornadas e usar trigger PostgreSQL para impedir mudança de snapshot e quiz de origem. Evolução do formato exigirá uma versão nova, preservando leitores das versões antigas.

## Alternativas

Somente referenciar as tabelas editáveis permitiria alterar o passado. Duplicar todas as perguntas em tabelas históricas aumentaria o modelo neste estágio sem necessidade de consultas analíticas específicas. JSON sem validação ou sem bloqueio de update não forneceria garantia suficiente.

Um índice SQL isolado não garante exatamente uma alternativa correta entre várias linhas; essa regra permanece no serviço dentro de transação.

## Consequências

Respostas são independentes de edições no catálogo. A migration inclui SQL complementar (CHECKs e trigger) que deve ser mantido em futuras migrations, pois não é integralmente representado no schema Prisma.

Dados históricos usam relações restritivas, evitando exclusão em cascata. Os testes reais usam schema quizarena_test, com proteção contra uso do schema de desenvolvimento. O seed é separado, transacional e idempotente.

Prisma 6 utiliza o cliente JavaScript existente; uma migração futura de versão principal deverá ser avaliada separadamente. No lockfile, as adições são Prisma e suas dependências; a ligação opcional de jiti alterou chaves de peers sem atualizar os pacotes existentes. O driver pg foi substituído no health check pela API pública do pacote.

Não há autenticação ou ownership. Sessões e snapshots ainda são APIs internas, não contratos públicos de jogador. Redis não é fonte permanente e não armazena partidas neste incremento.
