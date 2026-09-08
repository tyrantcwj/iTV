import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getSettings, updateSettings } from "../db.js";
import { authUrl, consumeOAuthState, createOAuthState, handleCode } from "../lib/onedrive.js";

function publicSettings() {
  const s = getSettings();
  return {
    clientId: s.client_id,
    clientSecret: s.client_secret ? "********" : "",
    hasClientSecret: Boolean(s.client_secret),
    tenant: s.tenant || "common",
    redirectUri: s.redirect_uri,
    publicBaseUrl: s.public_base_url,
    connected: Boolean(s.refresh_token),
    displayName: s.display_name,
  };
}

export async function registerSettingsRoutes(app: FastifyInstance) {
  app.get("/api/settings", async () => publicSettings());

  app.put("/api/settings", async (req) => {
    const body = req.body as {
      clientId?: string;
      clientSecret?: string;
      tenant?: string;
      redirectUri?: string;
      publicBaseUrl?: string;
    };
    const patch: Record<string, string> = {};
    if (body.clientId !== undefined) patch.client_id = body.clientId.trim();
    if (body.clientSecret && body.clientSecret !== "********") {
      patch.client_secret = body.clientSecret.trim();
    }
    if (body.tenant !== undefined) patch.tenant = body.tenant.trim() || "common";
    if (body.redirectUri !== undefined) patch.redirect_uri = body.redirectUri.trim();
    if (body.publicBaseUrl !== undefined) patch.public_base_url = body.publicBaseUrl.trim();
    updateSettings(patch);
    return publicSettings();
  });

  app.get("/api/onedrive/login", async (req: FastifyRequest, reply: FastifyReply) => {
    const s = getSettings();
    if (!s.client_id || !s.client_secret || !s.redirect_uri) {
      return reply.code(400).send({ error: "请先填写 Client ID、密钥和回调地址" });
    }
    const state = createOAuthState();
    return reply.redirect(authUrl(state));
  });

  app.get("/api/onedrive/callback", async (req: FastifyRequest, reply: FastifyReply) => {
    const q = req.query as { code?: string; state?: string; error?: string; error_description?: string };
    if (q.error) {
      return reply.redirect(`/?oauth=error&message=${encodeURIComponent(q.error_description || q.error)}`);
    }
    if (!q.code || !q.state || !consumeOAuthState(q.state)) {
      return reply.redirect("/?oauth=error&message=" + encodeURIComponent("授权状态无效，请重试"));
    }
    try {
      await handleCode(q.code);
      return reply.redirect("/settings?oauth=ok");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.redirect(`/settings?oauth=error&message=${encodeURIComponent(message)}`);
    }
  });

  app.post("/api/onedrive/disconnect", async () => {
    updateSettings({
      refresh_token: "",
      access_token: "",
      access_expires_at: 0,
      display_name: "",
    });
    return publicSettings();
  });
}
