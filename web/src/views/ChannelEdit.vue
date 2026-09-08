<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { api, formatTime, type ChannelSummary, type MediaItem } from "../api";

const route = useRoute();
const id = computed(() => String(route.params.id));
const channel = ref<ChannelSummary | null>(null);
const playlist = ref<MediaItem[]>([]);
const library = ref<MediaItem[]>([]);
const selected = ref<string[]>([]);
const error = ref("");
const notice = ref("");
const uploading = ref(false);

const name = ref("");
const logoWidth = ref(96);
const logoX = ref(24);
const logoY = ref(24);
const startLocal = ref("");

function toLocal(ms: number) {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function load() {
  const ch = await api<ChannelSummary & { items: MediaItem[] }>(`/api/channels/${id.value}`);
  channel.value = ch;
  name.value = ch.name;
  logoWidth.value = ch.logoWidth;
  logoX.value = ch.logoX;
  logoY.value = ch.logoY;
  startLocal.value = toLocal(ch.startAt);
  playlist.value = ch.items;
  const lib = await api<{ items: MediaItem[] }>("/api/media");
  library.value = lib.items;
}

onMounted(load);

const unused = computed(() => {
  const used = new Set(playlist.value.map((p) => p.id));
  return library.value.filter((m) => !used.has(m.id));
});

function addSelected() {
  const map = new Map(library.value.map((m) => [m.id, m]));
  for (const sid of selected.value) {
    const item = map.get(sid);
    if (item) playlist.value.push(item);
  }
  selected.value = [];
}

function addAll() {
  playlist.value = [...library.value];
}

function removeAt(index: number) {
  playlist.value.splice(index, 1);
}

function move(index: number, dir: number) {
  const next = index + dir;
  if (next < 0 || next >= playlist.value.length) return;
  const copy = [...playlist.value];
  const [item] = copy.splice(index, 1);
  copy.splice(next, 0, item);
  playlist.value = copy;
}

async function save() {
  error.value = "";
  try {
    await api(`/api/channels/${id.value}`, {
      method: "PUT",
      body: JSON.stringify({
        name: name.value,
        startAt: new Date(startLocal.value).getTime(),
        logoWidth: Number(logoWidth.value),
        logoX: Number(logoX.value),
        logoY: Number(logoY.value),
        mediaIds: playlist.value.map((p) => p.id),
      }),
    });
    notice.value = "频道已保存";
    await load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

async function uploadLogo(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0];
  if (!file) return;
  uploading.value = true;
  try {
    const body = new FormData();
    body.append("file", file);
    channel.value = await api<ChannelSummary>(`/api/channels/${id.value}/logo`, {
      method: "POST",
      body,
    });
    notice.value = "台标已更新";
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    uploading.value = false;
  }
}
</script>

<template>
  <div v-if="channel">
    <div class="page-head">
      <div>
        <h2>{{ name }}</h2>
        <p>上传左上角台标、设定循环起点，并把片库里的集数排进节目单</p>
      </div>
      <div class="row">
        <router-link class="btn" :to="`/tv/${id}`">收看直播</router-link>
        <a class="btn secondary" :href="`/live/${id}.m3u`">下载 M3U</a>
        <button class="btn" @click="save">保存</button>
      </div>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="notice" class="ok">{{ notice }}</p>

    <div class="grid-2">
      <div class="card">
        <label class="field">频道名称 <input v-model="name" /></label>
        <label class="field" style="margin-top: 12px">
          循环起始时间
          <input v-model="startLocal" type="datetime-local" />
        </label>
        <p class="hint">刷新页面也会按墙上时钟对齐到「现在该播到的位置」。</p>
        <div class="row" style="margin-top: 12px">
          <label class="field">台标宽度 <input v-model.number="logoWidth" type="number" /></label>
          <label class="field">左边距 <input v-model.number="logoX" type="number" /></label>
          <label class="field">上边距 <input v-model.number="logoY" type="number" /></label>
        </div>
        <div class="row" style="margin-top: 16px; align-items: flex-end">
          <img v-if="channel.logoUrl" class="logo-preview" :src="channel.logoUrl" alt="台标" />
          <label class="field">
            上传台标（PNG 透明最佳）
            <input type="file" accept="image/*" :disabled="uploading" @change="uploadLogo" />
          </label>
        </div>
      </div>

      <div class="card">
        <h3 style="margin-top: 0">从片库加入</h3>
        <div class="row" style="margin-bottom: 8px">
          <button class="btn secondary" @click="addSelected">加入勾选</button>
          <button class="btn secondary" @click="addAll">加入全部</button>
        </div>
        <div style="max-height: 260px; overflow: auto">
          <table class="table">
            <tbody>
              <tr v-for="item in unused" :key="item.id">
                <td>
                  <input
                    type="checkbox"
                    :checked="selected.includes(item.id)"
                    @change="
                      selected = ($event.target as HTMLInputElement).checked
                        ? [...selected, item.id]
                        : selected.filter((x) => x !== item.id)
                    "
                  />
                </td>
                <td>{{ item.name }}</td>
                <td class="muted-note">{{ formatTime(item.durationSec) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top: 16px">
      <h3 style="margin-top: 0">节目单（{{ playlist.length }}）</h3>
      <table class="table">
        <thead>
          <tr>
            <th>#</th>
            <th>节目</th>
            <th>时长</th>
            <th>片头/片尾</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(item, index) in playlist" :key="item.id + index">
            <td>{{ index + 1 }}</td>
            <td>{{ item.name }}</td>
            <td>{{ formatTime(item.durationSec) }}</td>
            <td>{{ formatTime(item.introSec) }} / {{ formatTime(item.outroSec) }}</td>
            <td class="row">
              <button class="btn secondary" @click="move(index, -1)">上移</button>
              <button class="btn secondary" @click="move(index, 1)">下移</button>
              <button class="btn danger" @click="removeAt(index)">移除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
