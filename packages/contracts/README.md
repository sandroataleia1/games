# Contratos realtime

Pacote JavaScript ESM compartilhado por web e realtime. Importe `EVENTS` e os schemas deste pacote; não replique os nomes nos aplicativos.

| Evento                               | Payload                    |
| ------------------------------------ | -------------------------- |
| `EVENTS.SYSTEM_PING` (`system:ping`) | `{ id, sentAt }`           |
| `EVENTS.SYSTEM_PONG` (`system:pong`) | `{ id, sentAt, serverAt }` |

`id`: string não vazia de até 128 caracteres (espaços nas extremidades são normalizados). Os horários são strings ISO-8601 com fuso. `sentAt` é devolvido sem conversão e `serverAt` é determinado pelo servidor ao processar a mensagem. Horários do cliente nunca serão fonte autoritativa para pontuação.

O servidor valida o ping com Zod, emite pong e devolve o mesmo pong no acknowledgement. O cliente web valida o acknowledgement antes de indicar conexão estabelecida. O evento pong também pode ser consumido diretamente.

Payload inválido recebe acknowledgement `{ error: "invalid_payload" }`, validável com `systemErrorSchema`; não emite pong nem encerra a conexão. O emissor deve fornecer acknowledgement para receber o erro. Sem callback, o payload inválido é descartado. Campos extras são rejeitados.

Não há eventos de salas, jogadores ou perguntas. A versão dos eventos será introduzida quando os contratos começarem a evoluir.

## Contratos de dom?nio

`QUIZ_STATUS`, `SESSION_STATUS` e `QUESTION_TYPE` s?o enums compartilhados. `quizInputSchema`, `questionInputSchema` e `quizSnapshotSchema` validam o dom?nio. Snapshot v1 exige UUIDs distintos, posi??es ?nicas e ordenadas, 2?6 alternativas com exatamente uma correta, dura??o 5?120s e pontos-base 100?10.000. O snapshot completo inclui gabaritos e ? interno do servidor; n?o deve ser enviado ao jogador sem DTO espec?fico. N?o foram adicionados eventos Socket.IO de partidas.
