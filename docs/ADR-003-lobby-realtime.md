# ADR-003: Lobby realtime autoritativo

## Decisão

Criação de salas, códigos, nomes, limite e identidades de reconexão são decididos pelo realtime. A confirmação persistente fica no PostgreSQL; Redis distribui eventos, mantém presença/projeção temporária, aplica rate limits e fornece o adapter de múltiplas instâncias.

## Segurança

Tokens são bytes aleatórios e persistidos somente como hashes scrypt. O token puro aparece apenas no ACK que o cria. DTOs públicos não contêm hashes, tokens, snapshot ou gabaritos. O navegador mantém credenciais apenas em `sessionStorage`; fechar completamente a aba perde a credencial anônima.

## Reconexão

`v1:room:resume` e `v1:host:resume` validam a identidade e o hash antes de reanexar o socket. A conexão mais recente prevalece; desconexões marcam presença sem apagar o participante.