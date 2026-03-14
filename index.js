const fastify = require("fastify")({ logger: false, trustProxy: true });
const isDev = process.env.NODE_ENV !== "production";
const CUID2_REGEX = /^[a-z][a-z0-9]{11,31}$/;

if (!isDev) {
  if (!process.env.NOCODB_URL) throw new Error("NOCODB_URL is not defined");
  if (!process.env.NOCODB_TOKEN) throw new Error("NOCODB_TOKEN is not defined");
  if (!process.env.NOCODB_BASE_PATH) throw new Error("NOCODB_BASE_PATH is not defined");
}

await fastify.register(require("@fastify/cors"));
await fastify.register(require("@fastify/rate-limit"), {
  global: true,
  max: 10,
  timeWindow: "1 minute",
});

fastify.get("/", { config: { rateLimit: false } }, function (req, reply) {
  return reply.redirect("https://coolify.io");
});

fastify.get("/instances", { config: { rateLimit: false } }, async function (req, reply) {
  if (isDev && !process.env.NOCODB_URL) {
    return { count: 0 };
  }
  const baseUrl = process.env.NOCODB_URL;
  const nocodbUrl = baseUrl + process.env.NOCODB_BASE_PATH + "/InstanceCounter"
  const instances = await fetch(nocodbUrl + "/count", {
    headers: {
      'xc-token': process.env.NOCODB_TOKEN
    }
  });
  const nocodbUrlv4 = baseUrl + process.env.NOCODB_BASE_PATH + "/v4InstanceCounter"
  const instancesv4 = await fetch(nocodbUrlv4 + "/count", {
    headers: {
      'xc-token': process.env.NOCODB_TOKEN
    }
  });
  const json = await instances.json();
  const jsonv4 = await instancesv4.json();

  return { count: json.count + jsonv4.count };
});
fastify.get("/v4/alive", {
  config: {
    rateLimit: {
      max: 5,
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
  if (isDev && !process.env.NOCODB_URL) {
    return 'OK';
  }
  const baseUrl = process.env.NOCODB_URL;
  const nocodbUrl = baseUrl + process.env.NOCODB_BASE_PATH + "/v4InstanceCounter"
  const found = await fetch(nocodbUrl + "/find-one?where=where%28Uuid%2Ceq%2C" + appId + "%29", {
    headers: {
      'xc-token': process.env.NOCODB_TOKEN
    }
  })
  const json = await found.json();
  if (json && json?.Id) {
    const payload = JSON.stringify({
      LastSeen: new Date().getTime(),
      Version: version
    });
    fetch(nocodbUrl + '/' + json.Id, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'xc-token': process.env.NOCODB_TOKEN
      },
      body: payload
    });
  } else {
    const payload = JSON.stringify({
      Uuid: appId,
      LastSeen: new Date().getTime(),
      Version: version
    });
    fetch(nocodbUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'xc-token': process.env.NOCODB_TOKEN
      },
      body: payload
    });
  }
  return 'OK';
});

const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: "0.0.0.0" });
    console.log(`API listening on ${fastify.server.address().port}.`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};
start();
