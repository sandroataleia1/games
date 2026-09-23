import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { DomainError } from "../errors/domain-error.js";
import { transaction } from "../repositories/transaction.js";
import { hashSecret, verifySecret } from "./tokens.js";

// Identity of the authenticated account (still named Organizer): registration,
// login, sessions. Game-agnostic - no quiz, room or match knowledge.
const nameSchema = z.string().trim().min(2).max(100);
const emailSchema = z.string().trim().max(254).pipe(z.email()).transform((value) => value.toLowerCase());
const passwordSchema = z.string().min(10).max(128).refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), "A senha deve conter letra e número.");
const SESSION_MS = 8 * 60 * 60 * 1000;
const digest = (token) => createHash("sha256").update(token).digest("hex");
const userDTO = ({ id, name, email, createdAt }) => ({ id, name, email, createdAt });

function parse(schema, value, code = "INVALID_PAYLOAD") { const result = schema.safeParse(value); if (!result.success) throw new DomainError(code, code, result.error.issues.map((issue) => ({ code: "INVALID", path: issue.path.join("."), message: issue.message }))); return result.data; }
async function sessionResult(db, owner, replace = true) { if (replace) await db.organizerSession.deleteMany({ where: { ownerId: owner.id } }); const token = randomBytes(32).toString("hex"); const expiresAt = new Date(Date.now() + SESSION_MS); await db.organizerSession.create({ data: { ownerId: owner.id, tokenHash: digest(token), expiresAt } }); return { token, expiresAt, user: userDTO(owner) }; }

export function createIdentityService(client) {
  return {
    normalizeEmail: (email) => parse(emailSchema, email),
    validatePassword: (password) => parse(passwordSchema, password),
    register(input) { return transaction(client, async (tx) => { const data = parse(z.object({ name: nameSchema, email: emailSchema, password: passwordSchema }).strict(), input); const owner = await tx.organizer.create({ data: { name: data.name, email: data.email, passwordHash: await hashSecret(data.password) } }); return sessionResult(tx, owner); }, "EMAIL_CONFLICT"); },
    login(input) { return transaction(client, async (tx) => { const data = parse(z.object({ email: emailSchema, password: z.string().max(128) }).strict(), input); const owner = await tx.organizer.findUnique({ where: { email: data.email } }); if (!owner || !(await verifySecret(data.password, owner.passwordHash).catch(() => false))) throw new DomainError("INVALID_CREDENTIALS"); return sessionResult(tx, owner); }); },
    async authenticate(token) { if (!token) return null; const row = await client.organizerSession.findUnique({ where: { tokenHash: digest(token) }, include: { owner: true } }); if (!row || row.expiresAt <= new Date()) { if (row) await client.organizerSession.delete({ where: { id: row.id } }); return null; } return userDTO(row.owner); },
    async logout(token) { if (token) await client.organizerSession.deleteMany({ where: { tokenHash: digest(token) } }); },
  };
}
