export class DomainError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}
export function parse(schema, value, code = "QUIZ_INVALID") {
  const result = schema.safeParse(value);
  if (!result.success) throw new DomainError(code);
  return result.data;
}
