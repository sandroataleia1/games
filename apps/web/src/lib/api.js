export async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, { credentials: "include", ...options, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers } });
  const body = await response.json().catch(() => ({ error: { message: "Resposta inválida do servidor." } }));
  if (!response.ok) throw Object.assign(new Error(body.error?.message || "Não foi possível concluir."), { status: response.status, details: body.error?.details, code: body.error?.code });
  return body.data;
}
