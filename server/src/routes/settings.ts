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
    // 只回「有没有」，绝不回原值：这个站没有登录，/api/settings 是公网可读的
    githubToken: s.github_token ? "********" : "",
    hasGithubToken: Boolean(s.github_token),
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
      githubToken?: string;
    };
    const patch: Record<string, string> = {};
    if (body.clientId !== undefined) patch.client_id = body.clientId.trim();
    if (body.clientSecret && body.clientSecret !== "********") {
      patch.client_secret = body.clientSecret.trim();
    }
    if (body.tenant !== undefined) patch.tenant = body.tenant.trim() || "common";
    if (body.redirectUri !== undefined) patch.redirect_uri = body.redirectUri.trim();
    if (body.publicBaseUrl !== undefined) patch.public_base_url = body.publicBaseUrl.trim();
    /*
     * 掩码值原样回传时当作「没改」，空串当作「清除」。
     * 令牌总得有个撤下来的办法，不然只能进不能出。
     */
    if (body.githubToken !== undefined && body.githubToken !== "********") {
      patch.github_token = body.githubToken.trim();
    }
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
