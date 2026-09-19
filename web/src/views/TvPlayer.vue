<script setup lang="ts">
import Artplayer from "artplayer";
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { api, formatTime, type NowResponse } from "../api";

const route = useRoute();
const rootEl = ref<HTMLElement | null>(null);
const playerEl = ref<HTMLElement | null>(null);
const state = ref<NowResponse | null>(null);
const error = ref("");
const muted = ref(false);
const showOsd = ref(true);
const clock = ref(Date.now());
const joinAt = ref(0);
let art: Artplayer | null = null;
let mediaKey = "";
let fetchedAt = 0;
let osdTimer = 0;
let syncTimer = 0;
let clockTimer = 0;
let seekGuardUntil = 0;
let syncing = false;

function remainingSec() {
  const cur = state.value?.current;
  if (!cur) return 0;
  return Math.max(0, cur.remaining - (Date.now() - fetchedAt) / 1000);
}

const remainingDisplay = computed(() => {
  clock.value;
  return remainingSec();
});

function expectedPlayhead() {
  const cur = state.value?.current;
  if (!cur) return 0;
  const start = cur.introSec;
  const end = Math.max(start + 1, cur.durationSec - cur.outroSec);
  const t = cur.playhead + Math.max(0, (Date.now() - fetchedAt) / 1000);
  return Math.min(end - 0.05, Math.max(start, t));
}

function sourceUrl() {
  const cur = state.value?.current;
  if (!cur) return "";
  return `${cur.streamUrl}#t=${Math.max(0, joinAt.value).toFixed(3)}`;
}

function isOldAndroid() {
  const ver = (navigator.userAgent || "").match(/Android (\d+)/i);
  return Boolean(ver && Number(ver[1]) < 8);
}

async function loadNow() {
  const id = String(route.params.id);
  state.value = await api<NowResponse>(`/api/channels/${id}/now`);
  fetchedAt = Date.now();
  const cur = state.value.current;
  if (cur && cur.mediaId !== mediaKey) {
    mediaKey = cur.mediaId;
    joinAt.value = cur.playhead;
    return true;
  }
  return false;
}

function joinSeek() {
  const el = art?.video;
  if (!el || el.readyState < 1) return;
  const target = expectedPlayhead();
  if (!Number.isFinite(target)) return;
  seekGuardUntil = Date.now() + 8000;
  if (Math.abs(el.currentTime - target) > 0.8) {
    el.currentTime = target;
  }
}

async function tryPlay() {
  if (!art) return;
  try {
    art.muted = muted.value;
    await art.play();
  } catch {
    art.muted = true;
    muted.value = true;
    try {
      await art.play();
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    }
  }
}

function onTime() {
  if (Date.now() < seekGuardUntil) return;
  const el = art?.video;
  const cur = state.value?.current;
  if (!el || !cur || el.seeking) return;
  const endAt = Math.max(cur.introSec + 1, cur.durationSec - cur.outroSec);
  if (el.currentTime >= endAt - 0.25 || remainingSec() <= 0.35) {
    void resync(true);
  }
}

async function resync(forceNext = false) {
  if (syncing) return;
  syncing = true;
  try {
    let switched = await loadNow();
    if (forceNext && !switched) {
      await new Promise((r) => setTimeout(r, 400));
      switched = await loadNow();
    }
    if (switched) {
      await nextTick();
      await applySource();
      return;
    }
    if (art?.video?.paused) void tryPlay();
  } finally {
    syncing = false;
  }
}

function destroyPlayer() {
  if (!art) return;
  art.destroy(false);
  art = null;
}

function createPlayer(url: string) {
  if (!playerEl.value) return;
  destroyPlayer();
  Artplayer.DBCLICK_FULLSCREEN = false;
  art = new Artplayer({
    container: playerEl.value,
    url,
    theme: "#e8b44c",
    lang: "zh-cn",
    volume: 1,
    autoplay: true,
    muted: muted.value,
    isLive: true,
    autoOrientation: true,
    lock: true,
    fullscreen: false,
    fullscreenWeb: false,
    pip: false,
    screenshot: false,
    setting: false,
    playbackRate: false,
    aspectRatio: false,
    autoSize: false,
    autoMini: false,
    miniProgressBar: false,
    autoPlayback: false,
    fastForward: false,
    mutex: true,
    moreVideoAttr: {
      playsInline: true,
      "webkit-playsinline": true,
      referrerPolicy: "no-referrer",
    },
  });
  art.on("video:loadedmetadata", () => {
    joinSeek();
    void tryPlay();
  });
  art.on("video:timeupdate", onTime);
  art.on("video:ended", () => void resync(true));
  art.on("ready", () => void tryPlay());
}

async function applySource() {
  const url = sourceUrl();
  if (!url || !playerEl.value) return;
  if (!art) {
    createPlayer(url);
    return;
  }
  await art.switchUrl(url);
}

function isFullscreen() {
  const doc = document as Document & { webkitFullscreenElement?: Element | null };
  return Boolean(document.fullscreenElement || doc.webkitFullscreenElement);
}

async function toggleFullscreen() {
  const el = rootEl.value as (HTMLElement & { webkitRequestFullscreen?: () => void }) | null;
  if (!el) return;
  const doc = document as Document & {
    webkitExitFullscreen?: () => void;
    webkitFullscreenElement?: Element | null;
  };
  try {
    if (isFullscreen()) {
      if (document.exitFullscreen) await document.exitFullscreen();
      else doc.webkitExitFullscreen?.();
      return;
    }
    if (el.requestFullscreen) await el.requestFullscreen();
    else el.webkitRequestFullscreen?.();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

function bumpOsd() {
  showOsd.value = true;
  window.clearTimeout(osdTimer);
  osdTimer = window.setTimeout(() => {
    showOsd.value = false;
  }, 4000);
}

function onSurfaceClick() {
  if (art?.muted) {
    art.muted = false;
    muted.value = false;
    void art.play();
  }
  bumpOsd();
}

function onKey(ev: KeyboardEvent) {
  if (ev.key === "f") void toggleFullscreen();
  if (ev.key === "m" && art) {
    art.muted = !art.muted;
    muted.value = art.muted;
  }
  bumpOsd();
}

onMounted(async () => {
  try {
    await loadNow();
    await nextTick();
    await applySource();
    bumpOsd();
    syncTimer = window.setInterval(() => void resync(false), 30000);
    clockTimer = window.setInterval(() => {
      clock.value = Date.now();
    }, 1000);
    window.addEventListener("mousemove", bumpOsd);
    window.addEventListener("keydown", onKey);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
});

onBeforeUnmount(() => {
  destroyPlayer();
  window.clearInterval(syncTimer);
  window.clearInterval(clockTimer);
  window.clearTimeout(osdTimer);
  window.removeEventListener("mousemove", bumpOsd);
  window.removeEventListener("keydown", onKey);
});
</script>

<template>
  <div ref="rootEl" class="tv-root" @click="onSurfaceClick">
    <div v-if="state?.current" ref="playerEl" class="tv-player" />
    <img
      v-if="state?.channel?.logoUrl"
      class="tv-logo"
      :src="state.channel.logoUrl"
      :style="{
        left: state.channel.logoX + 'px',
        top: state.channel.logoY + 'px',
        width: state.channel.logoWidth + 'px',
      }"
      alt="单击切换全屏"
      title="单击切换全屏"
      @click.stop.prevent="toggleFullscreen"
    />
    <div v-if="state?.current" class="tv-osd" :style="{ visibility: showOsd ? 'visible' : 'hidden' }">
      <div class="live">● LIVE</div>
      <div style="font-size: 20px; font-weight: 700">{{ state.current.title }}</div>
      <div class="muted-note">
        下一节目 {{ state.next?.title }} · 剩余 {{ formatTime(remainingDisplay) }}
      </div>
      <div v-if="isOldAndroid()" class="muted-note">安卓 7 浏览器无法解码 4K HEVC，请改用 iTV 收看 App</div>
      <div v-if="muted" class="muted-note">点击画面恢复声音</div>
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
