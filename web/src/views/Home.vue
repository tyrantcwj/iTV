<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api, type ChannelSummary, type Settings, formatTime } from "../api";

const settings = ref<Settings | null>(null);
const channels = ref<ChannelSummary[]>([]);
const error = ref("");

onMounted(async () => {
  try {
    settings.value = await api<Settings>("/api/settings");
    const data = await api<{ items: ChannelSummary[] }>("/api/channels");
    channels.value = data.items;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
});
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h2>总览</h2>
        <p>虚拟直播频道、片源与 M3U 入口</p>
      </div>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <div class="grid-3">
      <div class="card">
        <div class="muted-note">OneDrive 世纪互联</div>
        <h3 style="margin: 8px 0 0">
          {{ settings?.connected ? settings.displayName || "已授权" : "未连接" }}
        </h3>
        <p class="hint">{{ settings?.connected ? "可以浏览并导入视频" : "请先到设置里完成授权" }}</p>
        <router-link class="btn secondary" to="/settings">打开设置</router-link>
      </div>
      <div class="card">
        <div class="muted-note">频道</div>
        <h3 style="margin: 8px 0 0">{{ channels.length }} 个</h3>
        <p class="hint">每个频道都是 24 小时循环的假直播</p>
        <router-link class="btn secondary" to="/channels">管理频道</router-link>
      </div>
      <div class="card">
        <div class="muted-note">全部频道 M3U</div>
        <h3 style="margin: 8px 0 0">IPTV 订阅</h3>
        <p class="hint">VLC / PotPlayer 可打开此地址</p>
        <a class="btn" href="/live/playlist.m3u">下载 playlist.m3u</a>
      </div>
    </div>
    <div class="card" style="margin-top: 16px">
      <h3 style="margin-top: 0">正在播出</h3>
      <table v-if="channels.length" class="table">
        <thead>
          <tr>
            <th>频道</th>
            <th>当前节目</th>
            <th>剩余</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="ch in channels" :key="ch.id">
            <td>{{ ch.name }}</td>
            <td>{{ ch.now?.title || "暂无节目" }}</td>
            <td>{{ ch.now ? formatTime(ch.now.remaining) : "—" }}</td>
            <td><router-link class="btn secondary" :to="`/tv/${ch.id}`">收看</router-link></td>
          </tr>
        </tbody>
      </table>
      <p v-else class="hint">还没有频道。先导入片库，再创建一个频道。</p>
    </div>
  </div>
</template>
