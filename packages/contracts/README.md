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
