import { randomBytes, scrypt as callbackScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";
import { parse } from "../errors/domain-error.js";

const scrypt = promisify(callbackScrypt);
export async function hashToken(token) {
  parse(z.string().min(32).max(512), token, "TOKEN_INVALID");
  const salt = randomBytes(16).toString("hex");
  const hash = await scrypt(token, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$v1$${salt}$${hash.toString("hex")}`;
}

export async function verifyToken(token, encodedHash) {
  parse(z.string().min(32).max(512), token, "TOKEN_INVALID");
  if (typeof encodedHash !== "string") return false;
  const [, version, salt, expected] = encodedHash.split("$");
  if (version !== "v1" || !salt || !expected) return false;
  const actual = await scrypt(token, salt, 64, { N: 16384, r: 8, p: 1 });
  const expectedBuffer = Buffer.from(expected, "hex");
  return expectedBuffer.length === actual.length && timingSafeEqual(expectedBuffer, actual);
}
