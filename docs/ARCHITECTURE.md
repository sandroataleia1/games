# Arquitetura

## Responsabilidades

- `apps/web`: Next.js App Router em JavaScript, com código em `src`. Renderiza a interface e futuramente atenderá APIs administrativas. **Não manterá salas em memória.**
- `apps/realtime`: processo Node.js separado com Express e Socket.IO. Será autoritativo para partidas, presença, cronômetros, respostas, pontuação e reconexão.
- `packages/contracts`: constantes únicas de eventos e validação Zod, compartilhadas pelos dois aplicativos.
- `packages/database`: placeholder preexistente preservado, sem tabelas, ORM ou uso em runtime neste incremento.
- PostgreSQL 16 guardará dados permanentes. Redis 7 guardará estado efêmero; não há armazenamento definitivo em memória do processo.

## Limites da fundação

Implementados somente conexão, ping/pong, health check, integração com dependências e encerramento. Next.js não gerencia estado das partidas. O cliente não calculará a pontuação final; tempo de resposta será determinado pelo servidor.

Redis permitirá múltiplas instâncias do realtime futuramente com adapter e coordenação de estado. Este incremento **não instala adapter nem implementa sincronização distribuída**. A queda de um cliente não poderá invalidar toda a partida; presença e reconexão deverão ser tratadas por participante nos próximos incrementos.

Eventos terão versão quando os contratos começarem a evoluir. Não há autenticação, salas, jogadores, questões, QR Code ou banco modelado.

## Saúde e ciclo de vida

`GET /health` retorna HTTP 200 apenas se Redis e PostgreSQL responderem. Caso contrário, HTTP 503, `status: degraded` e a dependência indisponível. As consultas têm limite de tempo. Falhas temporárias não encerram o servidor; Redis tenta reconectar e PostgreSQL é consultado novamente no próximo check.

O servidor inicia em modo degradado se as dependências estiverem offline, permitindo observar a saúde e recuperação. Configuração inválida ou porta ocupada resulta em falha de inicialização com código não zero e liberação de recursos. SIGINT/SIGTERM encerram Socket.IO, HTTP, pool PostgreSQL e Redis; o prazo máximo é de cinco segundos.

O indicador da interface confirma uma conexão Socket.IO e um acknowledgement ping/pong válido. **Não substitui o health check das dependências.** A desconexão ou erro altera o indicador, e tentativas de reconexão voltam ao estado conectando.
