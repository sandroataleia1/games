import { DomainError } from "@quizarena/database";
import { normalizeIp } from "./http-rate-limit.js";

export const SESSION_COOKIE = "quizarena_session";
export function cookieValue(header = "", name = SESSION_COOKIE) { for (const part of header.split(";")) { const [key, ...value] = part.trim().split("="); if (key === name) return decodeURIComponent(value.join("=")); } return null; }
const statusFor = (code) => ({ UNAUTHENTICATED: 401, INVALID_CREDENTIALS: 401, NOT_FOUND: 404, EMAIL_CONFLICT: 409, CONFLICT: 409, TRANSACTION_CONFLICT: 409, QUIZ_IN_USE: 409, QUIZ_NOT_DRAFT: 409, QUIZ_INVALID: 422, INVALID_ORDER: 422, INVALID_PAYLOAD: 422, RATE_LIMITED: 429, COORDINATION_UNAVAILABLE: 503 }[code] ?? 400);
const errorBody = (error) => ({ ok: false, error: { code: error instanceof DomainError ? error.code : "INTERNAL_ERROR", message: error instanceof DomainError ? ({ INVALID_CREDENTIALS: "E-mail ou senha inválidos.", UNAUTHENTICATED: "Autenticação necessária.", NOT_FOUND: "Recurso não encontrado.", EMAIL_CONFLICT: "Não foi possível criar a conta.", CONFLICT: "O conteúdo foi alterado em outra aba.", QUIZ_INVALID: "O quiz ainda possui pendências." }[error.code] ?? "Não foi possível concluir a operação.") : "Não foi possível concluir a operação.", ...(error instanceof DomainError && error.details ? { details: error.details } : {}) } });
const wrap = (handler) => async (request, response) => { try { await handler(request, response); } catch (error) { const code = error instanceof DomainError ? error.code : "INTERNAL_ERROR"; if (code === "RATE_LIMITED") response.set("Retry-After", String(error.details?.retryAfter ?? 1)); response.status(code === "INTERNAL_ERROR" ? 500 : statusFor(code)).json(errorBody(error)); } };

export function installApi(app, { database, webOrigin, production = false, rateLimiter }) {
  async function limited(request) {
    if (!rateLimiter) throw new DomainError("COORDINATION_UNAVAILABLE");
    await rateLimiter.consume("auth-ip", normalizeIp(request.ip));
    const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "missing";
    await rateLimiter.consume("auth-email", email);
  }
  function mutation(request, _response, next) { if (request.headers.origin !== webOrigin) return next(new DomainError("INVALID_ORIGIN")); if (!request.is("application/json")) return next(new DomainError("INVALID_CONTENT_TYPE")); next(); }
  async function auth(request, _response, next) { try { const user = await database.organizers.authenticate(cookieValue(request.headers.cookie)); if (!user) throw new DomainError("UNAUTHENTICATED"); request.user = user; next(); } catch (error) { next(error); } }
  function setSession(response, result) { response.cookie(SESSION_COOKIE, result.token, { httpOnly: true, sameSite: "lax", secure: production, path: "/", expires: result.expiresAt }); }
  app.post("/api/auth/register", mutation, wrap(async (req, res) => { await limited(req); const result = await database.organizers.register(req.body); setSession(res, result); res.status(201).json({ ok: true, data: { user: result.user } }); }));
  app.post("/api/auth/login", mutation, wrap(async (req, res) => { await limited(req); const result = await database.organizers.login(req.body); setSession(res, result); res.json({ ok: true, data: { user: result.user } }); }));
  app.post("/api/auth/logout", mutation, wrap(async (req, res) => { await database.organizers.logout(cookieValue(req.headers.cookie)); res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: "lax", secure: production, path: "/" }); res.json({ ok: true, data: {} }); }));
  app.get("/api/auth/me", wrap(async (req, res) => { const user = await database.organizers.authenticate(cookieValue(req.headers.cookie)); if (!user) throw new DomainError("UNAUTHENTICATED"); res.json({ ok: true, data: { user } }); }));
  app.get("/api/quizzes", auth, wrap(async (req, res) => res.json({ ok: true, data: { quizzes: await database.organizers.listQuizzes(req.user.id) } })));
  app.post("/api/quizzes", mutation, auth, wrap(async (req, res) => res.status(201).json({ ok: true, data: { quiz: await database.organizers.createQuiz(req.user.id, req.body) } })));
  app.get("/api/quizzes/:id", auth, wrap(async (req, res) => res.json({ ok: true, data: { quiz: await database.organizers.getQuiz(req.user.id, req.params.id) } })));
  app.patch("/api/quizzes/:id", mutation, auth, wrap(async (req, res) => res.json({ ok: true, data: { quiz: await database.organizers.updateQuiz(req.user.id, req.params.id, req.body) } })));
  app.delete("/api/quizzes/:id", mutation, auth, wrap(async (req, res) => { await database.organizers.remove(req.user.id, req.params.id); res.json({ ok: true, data: {} }); }));
  app.post("/api/quizzes/:id/publish", mutation, auth, wrap(async (req, res) => res.json({ ok: true, data: { quiz: await database.organizers.publish(req.user.id, req.params.id) } })));
  app.post("/api/quizzes/:id/unpublish", mutation, auth, wrap(async (req, res) => res.json({ ok: true, data: { quiz: await database.organizers.unpublish(req.user.id, req.params.id) } })));
  app.post("/api/quizzes/:id/questions", mutation, auth, wrap(async (req, res) => res.status(201).json({ ok: true, data: { quiz: await database.organizers.addQuestion(req.user.id, req.params.id, req.body) } })));
  app.patch("/api/quizzes/:id/questions/:questionId", mutation, auth, wrap(async (req, res) => res.json({ ok: true, data: { quiz: await database.organizers.updateQuestion(req.user.id, req.params.id, req.params.questionId, req.body) } })));
  app.delete("/api/quizzes/:id/questions/:questionId", mutation, auth, wrap(async (req, res) => { await database.organizers.deleteQuestion(req.user.id, req.params.id, req.params.questionId); res.json({ ok: true, data: {} }); }));
  app.post("/api/quizzes/:id/questions/reorder", mutation, auth, wrap(async (req, res) => res.json({ ok: true, data: { quiz: await database.organizers.reorder(req.user.id, req.params.id, req.body.ids) } })));
  app.use((error, _request, response, next) => { void next; const code = error instanceof DomainError ? error.code : "INTERNAL_ERROR"; response.status(code === "INTERNAL_ERROR" ? 500 : statusFor(code)).json(errorBody(error)); });
}
