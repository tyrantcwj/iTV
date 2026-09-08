import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { config, ensureDirs } from "./config.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerMediaRoutes } from "./routes/media.js";
import { registerStreamRoutes } from "./routes/stream.js";
import { registerChannelRoutes } from "./routes/channels.js";
import { registerLiveRoutes } from "./routes/live.js";

ensureDirs();

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024 } });

await registerSettingsRoutes(app);
await registerMediaRoutes(app);
await registerStreamRoutes(app);
await registerChannelRoutes(app);
await registerLiveRoutes(app);

const logoDir = path.join(config.dataDir, "logos");
await app.register(fastifyStatic, {
  root: logoDir,
  prefix: "/api/uploads/logos/",
  decorateReply: false,
});

const publicDir =
  process.env.NODE_ENV === "production"
    ? path.join(config.serverRoot, "public")
    : path.resolve(config.serverRoot, "../web/dist");
if (fs.existsSync(publicDir)) {
  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: "/",
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api") || req.url.startsWith("/live")) {
      return reply.code(404).send({ error: "Not found" });
    }
    return reply.sendFile("index.html");
  });
}

app.setErrorHandler((err, req, reply) => {
  const status = (err as { statusCode?: number }).statusCode || 500;
  reply.code(status).send({ error: err.message || "服务器错误" });
});

app.get("/api/health", async () => ({ ok: true }));

try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
  app.log.info(`虚拟电视台已启动: http://0.0.0.0:${config.port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
