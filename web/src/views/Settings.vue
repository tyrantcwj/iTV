<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useRoute } from "vue-router";
import { api, type Settings } from "../api";

const route = useRoute();
const form = reactive({
  clientId: "",
  clientSecret: "",
  tenant: "common",
  redirectUri: "",
  publicBaseUrl: "",
});
const settings = ref<Settings | null>(null);
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
