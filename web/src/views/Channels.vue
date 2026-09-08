<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api, type ChannelSummary } from "../api";

const router = useRouter();

const channels = ref<ChannelSummary[]>([]);
const name = ref("电影频道");
const error = ref("");

async function load() {
  const data = await api<{ items: ChannelSummary[] }>("/api/channels");
  channels.value = data.items;
}

onMounted(load);

async function create() {
  try {
    const ch = await api<ChannelSummary>("/api/channels", {
      method: "POST",
      body: JSON.stringify({ name: name.value }),
    });
    await router.push(`/channels/${ch.id}`);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

async function remove(id: string) {
  if (!confirm("删除这个频道？")) return;
  await api(`/api/channels/${id}`, { method: "DELETE" });
  await load();
}

function copyM3u(id: string) {
  const url = `${location.origin}/live/${id}.m3u`;
  navigator.clipboard.writeText(url);
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h2>频道</h2>
        <p>每个频道 24 小时循环，带台标的网页直播，同时给出 M3U</p>
      </div>
      <div class="row">
        <input v-model="name" placeholder="频道名称" />
        <button class="btn" @click="create">新建频道</button>
      </div>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <div class="grid-3">
      <div v-for="ch in channels" :key="ch.id" class="card channel-card">
        <div class="row">
          <img v-if="ch.logoUrl" class="logo-preview" :src="ch.logoUrl" alt="台标" />
          <div>
            <h3 style="margin: 0">{{ ch.name }}</h3>
            <div class="muted-note">{{ ch.itemCount }} 个节目</div>
            <div class="muted-note">{{ ch.now?.title || "暂无正在播出" }}</div>
          </div>
        </div>
        <div class="row">
          <router-link class="btn" :to="`/tv/${ch.id}`">收看</router-link>
          <router-link class="btn secondary" :to="`/channels/${ch.id}`">编排</router-link>
          <button class="btn secondary" @click="copyM3u(ch.id)">复制 M3U</button>
          <button class="btn danger" @click="remove(ch.id)">删除</button>
        </div>
      </div>
    </div>
    <p v-if="!channels.length" class="hint">还没有频道。</p>
  </div>
</template>
