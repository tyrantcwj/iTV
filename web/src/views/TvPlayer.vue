<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { api, formatTime, type NowResponse } from "../api";

const route = useRoute();
const video = ref<HTMLVideoElement | null>(null);
const state = ref<NowResponse | null>(null);
const error = ref("");
const needClick = ref(true);
const showOsd = ref(true);
let osdTimer = 0;
let syncTimer = 0;
let driftTimer = 0;

async function loadNow() {
  const id = String(route.params.id);
  state.value = await api<NowResponse>(`/api/channels/${id}/now`);
}

function applyPlayhead(force = false) {
  const el = video.value;
  const cur = state.value?.current;
  if (!el || !cur) return;
  const target = cur.playhead;
  if (force || Math.abs(el.currentTime - target) > 1.5) {
    el.currentTime = target;
  }
}

async function play() {
  const el = video.value;
  if (!el) return;
  try {
    el.muted = false;
    await el.play();
    needClick.value = false;
    applyPlayhead(true);
  } catch {
    try {
      el.muted = true;
      await el.play();
      needClick.value = true;
      applyPlayhead(true);
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    }
  }
}

function onMeta() {
  applyPlayhead(true);
}

function onTime() {
  const el = video.value;
  const cur = state.value?.current;
  if (!el || !cur) return;
  const endAt = Math.max(cur.introSec + 1, cur.durationSec - cur.outroSec);
  if (el.currentTime >= endAt - 0.25) {
    void resync(true);
  }
}

async function resync(forceNext = false) {
  const prevId = state.value?.current?.mediaId;
  await loadNow();
  if (forceNext && state.value?.current?.mediaId === prevId) {
    await new Promise((r) => setTimeout(r, 400));
    await loadNow();
  }
  applyPlayhead(true);
  void video.value?.play();
}

function bumpOsd() {
  showOsd.value = true;
  window.clearTimeout(osdTimer);
  osdTimer = window.setTimeout(() => {
    showOsd.value = false;
  }, 4000);
}

function onKey(ev: KeyboardEvent) {
  if (ev.key === "f") void video.value?.requestFullscreen();
  bumpOsd();
}

onMounted(async () => {
  try {
    await loadNow();
    bumpOsd();
    syncTimer = window.setInterval(() => void resync(), 20000);
    driftTimer = window.setInterval(() => applyPlayhead(false), 8000);
    window.addEventListener("mousemove", bumpOsd);
    window.addEventListener("keydown", onKey);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
});

onBeforeUnmount(() => {
  window.clearInterval(syncTimer);
  window.clearInterval(driftTimer);
  window.clearTimeout(osdTimer);
  window.removeEventListener("mousemove", bumpOsd);
  window.removeEventListener("keydown", onKey);
});
</script>

<template>
  <div class="tv-root" @click="needClick ? play() : bumpOsd()">
    <img
      v-if="state?.channel?.logoUrl"
      class="tv-logo"
      :src="state.channel.logoUrl"
      :style="{
        left: state.channel.logoX + 'px',
        top: state.channel.logoY + 'px',
        width: state.channel.logoWidth + 'px',
      }"
      alt=""
    />
    <video
      v-if="state?.current"
      :key="state.current.mediaId"
      ref="video"
      autoplay
      playsinline
      :src="state.current.streamUrl"
      @loadedmetadata="onMeta"
      @timeupdate="onTime"
      @ended="resync(true)"
    />
    <div v-if="needClick && state?.current" class="tv-start">
      <button class="btn">点击开始收看 {{ state?.channel?.name || "" }}</button>
    </div>
    <div v-if="state?.current" class="tv-osd" :style="{ opacity: showOsd || needClick ? 1 : 0 }">
      <div class="live">● LIVE</div>
      <div style="font-size: 20px; font-weight: 700">{{ state.current.title }}</div>
      <div class="muted-note">
        下一节目 {{ state.next?.title }} · 剩余 {{ formatTime(state.current.remaining) }}
      </div>
      <div v-if="state.current.webPlayable === false" class="error">
        此封装浏览器可能无法播放，请改用 M3U / VLC
      </div>
    </div>
    <div v-else-if="state?.empty" class="tv-start">
      <div>这个频道还没有可播节目，请先导入视频并探测时长。</div>
    </div>
    <div v-if="error" class="tv-start"><div class="error">{{ error }}</div></div>
  </div>
</template>
