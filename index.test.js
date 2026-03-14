const { describe, test, expect, beforeAll, afterAll } = require("bun:test");

const CUID2_REGEX = /^[a-z][a-z0-9]{11,31}$/;

async function buildApp(rateLimitMax = 5) {
  const app = require("fastify")({ logger: false, trustProxy: true });

  await app.register(require("@fastify/cors"));
  await app.register(require("@fastify/rate-limit"), {
    global: true,
    max: 10,
    timeWindow: "1 minute",
  });

  app.get("/", { config: { rateLimit: false } }, function (req, reply) {
    return reply.redirect("https://coolify.io");
  });

  app.get("/instances", { config: { rateLimit: false } }, async function (req, reply) {
    return { count: 0 };
  });

  app.get("/v4/alive", {
    config: {
      rateLimit: {
        max: rateLimitMax,
        timeWindow: "1 minute",
      },
    },
  }, async function (req, reply) {
    const appId = req.query.appId;
    const version = req.query.version || "0.0.0";
    if (!appId || !CUID2_REGEX.test(appId)) {
      reply.code(400);
      return { error: "Invalid or missing appId" };
    }
    return "OK";
  });

  await app.ready();
  return app;
}

describe("GET /", () => {
  let app;
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });

  test("redirects to coolify.io", async () => {
    const res = await app.inject("/");
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("https://coolify.io");
  });

  test("has no rate limit headers", async () => {
    const res = await app.inject("/");
    expect(res.headers["x-ratelimit-limit"]).toBeUndefined();
  });
});

describe("GET /instances", () => {
  let app;
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });

  test("returns count", async () => {
    const res = await app.inject("/instances");
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ count: 0 });
  });

  test("has no rate limit headers", async () => {
    const res = await app.inject("/instances");
    expect(res.headers["x-ratelimit-limit"]).toBeUndefined();
  });
});

describe("GET /v4/alive - input validation", () => {
  let app;
  // High rate limit so validation tests aren't blocked
  beforeAll(async () => { app = await buildApp(1000); });
  afterAll(async () => { await app.close(); });

  test("rejects missing appId", async () => {
    const res = await app.inject("/v4/alive");
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload)).toEqual({ error: "Invalid or missing appId" });
  });

  test("rejects empty appId", async () => {
    const res = await app.inject("/v4/alive?appId=");
    expect(res.statusCode).toBe(400);
  });

  test("rejects non-CUID2 strings", async () => {
    const res = await app.inject("/v4/alive?appId=not-a-cuid");
    expect(res.statusCode).toBe(400);
  });

  test("rejects appId starting with number", async () => {
    const res = await app.inject("/v4/alive?appId=123abcdefghijklm");
    expect(res.statusCode).toBe(400);
  });

  test("rejects appId with uppercase", async () => {
    const res = await app.inject("/v4/alive?appId=Abcdefghijklmnop");
    expect(res.statusCode).toBe(400);
  });

  test("rejects appId with special characters", async () => {
    const res = await app.inject("/v4/alive?appId=abcdef!@abcdefgh");
    expect(res.statusCode).toBe(400);
  });

  test("rejects appId too short (< 12 chars)", async () => {
    const res = await app.inject("/v4/alive?appId=abcdefghijk");
    expect(res.statusCode).toBe(400);
  });

  test("rejects appId too long (> 32 chars)", async () => {
    const res = await app.inject("/v4/alive?appId=abcdefghijklmnopqrstuvwxyz1234567");
    expect(res.statusCode).toBe(400);
  });

  test("accepts valid CUID2 (24 chars)", async () => {
    const res = await app.inject("/v4/alive?appId=clh3am1kw0000ml08m3j5bx8");
    expect(res.statusCode).toBe(200);
    expect(res.payload).toBe("OK");
  });

  test("accepts valid CUID2 (12 chars minimum)", async () => {
    const res = await app.inject("/v4/alive?appId=abcdefghijkl");
    expect(res.statusCode).toBe(200);
  });

  test("accepts valid CUID2 (32 chars maximum)", async () => {
    const res = await app.inject("/v4/alive?appId=abcdefghijklmnopqrstuvwxyz123456");
    expect(res.statusCode).toBe(200);
  });
});

describe("GET /v4/alive - rate limiting", () => {
  let app;
  beforeAll(async () => { app = await buildApp(5); });
  afterAll(async () => { await app.close(); });

  test("has rate limit headers with max 5", async () => {
    const res = await app.inject("/v4/alive?appId=ztestlimithdr0001aaaaaa");
    expect(res.headers["x-ratelimit-limit"]).toBe("5");
  });

  test("returns 429 after 5 requests", async () => {
    const results = [];
    for (let i = 0; i < 6; i++) {
      const res = await app.inject("/v4/alive?appId=ztestlimithdr0001aaaaaa");
      results.push(res.statusCode);
    }
    // First request already used above, so we have 4 left + 1 over
    expect(results[results.length - 1]).toBe(429);
  });

  test("429 response includes retry-after header", async () => {
    const res = await app.inject("/v4/alive?appId=ztestlimithdr0001aaaaaa");
    expect(res.statusCode).toBe(429);
    expect(res.headers["retry-after"]).toBeDefined();
  });
});
