import { DomainError } from "../errors/domain-error.js";

export async function transaction(
  client,
  operation,
  conflictCode = "CONFLICT",
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await client.$transaction(operation, {
        isolationLevel: "Serializable",
        maxWait: 5000,
        timeout: 10000,
      });
    } catch (error) {
      if (error.code === "P2034") {
        if (attempt < 2) continue;
        throw new DomainError("TRANSACTION_CONFLICT");
      }
      if (error.code === "P2002") throw new DomainError(conflictCode);
      if (error.code === "P2003") throw new DomainError("REFERENCE_CONFLICT");
      throw error;
    }
  }
}
