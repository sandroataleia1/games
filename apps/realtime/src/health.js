async function boundedCheck(check, timeoutMs) {
  let timer;
  try {
    return Boolean(
      await Promise.race([
        Promise.resolve().then(check),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(false), timeoutMs);
        }),
      ]),
    );
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function createHealthChecker(
  { checkPostgres, checkRedis },
  { timeoutMs = 2000 } = {},
) {
  return async function checkHealth() {
    const [postgres, redis] = await Promise.all([
      boundedCheck(checkPostgres, timeoutMs),
      boundedCheck(checkRedis, timeoutMs),
    ]);
    return {
      status: postgres && redis ? "ok" : "degraded",
      service: "realtime",
      timestamp: new Date().toISOString(),
      dependencies: {
        postgres: postgres ? "ok" : "unavailable",
        redis: redis ? "ok" : "unavailable",
      },
    };
  };
}
