// Primitives and generic platform services. This package knows nothing about
// any game: game modules receive these (client, transactions, errors, hashing)
// and the composition root (@multygames/server-bootstrap) wires everything.
export { DomainError, parse } from "./errors/domain-error.js";
export { createClient, createDatabaseHealthProbe } from "./client.js";
export { transaction } from "./repositories/transaction.js";
export { hashSecret, verifySecret, hashToken, verifyToken } from "./services/tokens.js";
export { createIdentityService } from "./services/identity.js";
export { createPlatform } from "./platform/index.js";
export { roomDTO } from "./platform/rooms.js";
export { matchDTO } from "./platform/matches.js";
