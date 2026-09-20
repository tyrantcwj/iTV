<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useRoute } from "vue-router";
import { ApiError, api, type Settings, type VersionInfo } from "../api";

const route = useRoute();
const form = reactive({
  clientId: "",
  clientSecret: "",
  tenant: "common",
  redirectUri: "",
  publicBaseUrl: "",
});
const settings = ref<Settings | null>(null);
const version = ref<VersionInfo | null>(null);
const agentToken = ref("");
const updating = ref(false);
const inspecting = ref("");
const saving = ref(false);
const message = ref("");
const error = ref("");

onMounted(async () => {
  const origin = window.location.origin;
  const data = await api<Settings>("/api/settings");
  settings.value = data;
  form.clientId = data.clientId;
  form.clientSecret = data.hasClientSecret ? "********" : "";
  form.tenant = data.tenant || "common";
  form.redirectUri = data.redirectUri || `${origin}/api/onedrive/callback`;
  form.publicBaseUrl = data.publicBaseUrl || origin;
  version.value = await api<VersionInfo>("/api/version").catch(() => null);
  if (route.query.oauth === "ok") message.value = "OneDrive 授权成功";
  if (route.query.oauth === "error") error.value = String(route.query.message || "授权失败");
});

async function save() {
  saving.value = true;
  error.value = "";
  try {
    settings.value = await api<Settings>("/api/settings", {
      method: "PUT",
      body: JSON.stringify(form),
    });
    message.value = "已保存";
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    saving.value = false;
  }
}

async function disconnect() {
  settings.value = await api<Settings>("/api/onedrive/disconnect", { method: "POST" });
  message.value = "已断开 OneDrive";
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 盯着 /api/version 看 commit 变没变。
 *
 * 更新过程中这个接口会连不上（容器正在重建），所以取不到不算失败，接着等。
 */
async function waitForNewCommit(before: string, timeoutMs = 240_000): Promise<VersionInfo | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(3_000);
    const v = await api<VersionInfo>("/api/version").catch(() => null);
    if (v && v.commit !== before) {
      version.value = v;
      return v;
    }
  }
  return null;
}

async function triggerUpdate() {
  if (!agentToken.value) {
    error.value = "请填写巡检令牌 AGENT_TOKEN";
    return;
  }
  const before = version.value?.commit || "";
  updating.value = true;
  error.value = "";
  message.value = "正在更新，别关页面…";
  try {
    await api("/api/agent/act", {
      method: "POST",
      headers: { Authorization: `Bearer ${agentToken.value}` },
      body: JSON.stringify({ action: "update" }),
    });
  } catch (err) {
    /*
     * 更新成功的样子恰好和「请求失败」一模一样：容器被重建，这条连接直接断掉。
     * 所以断连不能当错误报——真错误（容器名不对、镜像拉不动）是**有响应**的，
     * 后端现在会把 Watchtower 的退出码和日志带回来。
     * 只有拿到了明确的错误响应才停，其余一律去查版本，用 commit 变没变来判定。
     */
    const status = err instanceof ApiError ? err.status : 0;
    const answered = status >= 400 && status !== 502 && status !== 503 && status !== 504;
    if (answered) {
      error.value = err instanceof Error ? err.message : String(err);
      message.value = "";
      updating.value = false;
      return;
    }
  }
  const after = await waitForNewCommit(before);
  if (after) {
    message.value = `已更新到 ${after.commit.slice(0, 7)}`;
  } else {
    message.value = "";
    error.value = "等了 4 分钟版本还是没变，更新多半没成功。到设置页点「巡检」看一眼，或者查服务器上的 docker logs。";
  }
  updating.value = false;
}

async function inspect() {
  if (!agentToken.value) {
    error.value = "请填写巡检令牌 AGENT_TOKEN";
    return;
  }
  inspecting.value = "…";
  try {
    const snap = await api<unknown>("/api/agent/inspect", {
      headers: { Authorization: `Bearer ${agentToken.value}` },
    });
    inspecting.value = JSON.stringify(snap, null, 2);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h2>设置</h2>
        <p>连接 OneDrive 世纪互联，并填写对外访问地址（生成 M3U 用）</p>
      </div>
      <span v-if="settings?.connected" class="badge">已连接 {{ settings.displayName }}</span>
      <span v-else class="badge off">未连接</span>
    </div>

    <p v-if="message" class="ok">{{ message }}</p>
    <p v-if="error" class="error">{{ error }}</p>

    <div class="card">
      <div class="grid-2">
        <label class="field">
          应用程序 (客户端) ID
          <input v-model="form.clientId" placeholder="Azure 中国门户里的 Client ID" />
        </label>
        <label class="field">
          客户端密钥
          <input v-model="form.clientSecret" type="password" placeholder="Client Secret" />
        </label>
        <label class="field">
          租户
          <input v-model="form.tenant" placeholder="common 或你的租户 ID" />
        </label>
        <label class="field">
          回调地址 Redirect URI
          <input v-model="form.redirectUri" />
        </label>
        <label class="field">
          对外访问根地址
          <input v-model="form.publicBaseUrl" placeholder="https://tv.example.com" />
        </label>
      </div>
      <div class="row" style="margin-top: 16px">
        <button class="btn" :disabled="saving" @click="save">保存</button>
        <a class="btn secondary" href="/api/onedrive/login">连接 OneDrive</a>
        <button v-if="settings?.connected" class="btn danger" @click="disconnect">断开</button>
      </div>
    </div>

    <div class="card" style="margin-top: 16px">
      <h3 style="margin-top: 0">在线更新（ityc-kit）</h3>
      <p class="hint">
        当前版本 {{ version?.version || "—" }} · commit
        <code>{{ version?.commit || "dev" }}</code>
        <span v-if="version?.update?.updateAvailable">
          · 仓库最新 {{ version.update.latest }}（{{ version.update.message }}）
        </span>
        <span v-else-if="version?.update"> · 已是最新</span>
      </p>
      <p class="hint">{{ version?.runtime?.detail }}</p>
      <label class="field" style="max-width: 420px">
        巡检令牌 AGENT_TOKEN
        <input v-model="agentToken" type="password" placeholder="容器环境变量里的令牌" />
      </label>
      <div class="row" style="margin-top: 12px">
        <button class="btn secondary" @click="inspect">巡检快照</button>
        <button class="btn" :disabled="updating" @click="triggerUpdate">
          {{ updating ? "更新中…" : "拉取更新并重启" }}
        </button>
      </div>
      <pre v-if="inspecting" class="hint" style="white-space: pre-wrap; margin-top: 12px">{{ inspecting }}</pre>
    </div>

    <div class="card" style="margin-top: 16px">
      <h3 style="margin-top: 0">在 Azure 中国门户注册应用</h3>
      <ol class="hint">
        <li>打开 <a href="https://portal.azure.cn" target="_blank" rel="noreferrer">portal.azure.cn</a>，进入「应用注册」。</li>
        <li>新建应用，受支持的帐户类型选「任何组织目录中的帐户」。</li>
        <li>添加 Web 平台重定向 URI，必须与上面的回调地址完全一致，例如 <code>{{ form.redirectUri }}</code>。</li>
        <li>证书和密码里新建客户端密码，把值和应用程序 ID 填到本页。</li>
        <li>API 权限添加 Microsoft Graph：<code>User.Read</code>、<code>Files.Read</code>、<code>Files.Read.All</code>、<code>offline_access</code>，并授予管理员同意（若需要）。</li>
        <li>用 1Panel 反代到本服务时请开启 HTTPS，否则 OAuth 回调常会失败。</li>
      </ol>
    </div>
  </div>
</template>
