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
const showOsd = ref(false);
const clock = ref(Date.now());
const joinAt = ref(0);
const volume = ref(1);
const volumeHint = ref("");
let art: Artplayer | null = null;
let mediaKey = "";
let fetchedAt = 0;
let volumeTimer = 0;
let syncTimer = 0;
let clockTimer = 0;
let seekGuardUntil = 0;
let syncing = false;
let tearingDown = false;

function remainingSec() {
  const cur = state.value?.current;
  if (!cur) return 0;
  return Math.max(0, cur.remaining - (Date.now() - fetchedAt) / 1000);
}

const remainingDisplay = computed(() => {
  clock.value;
  return remainingSec();
});

function introWindow(cur: NonNullable<NowResponse["current"]>) {
  const introAt = cur.introAt || 0;
  const introEnd = cur.introEnd || introAt + (cur.introSec || 0);
  const outroAt = Math.max(introEnd + 1, cur.durationSec - (cur.outroSec || 0));
  return { introAt, introEnd, outroAt };
}

function expectedPlayhead() {
  const cur = state.value?.current;
  if (!cur) return 0;
  const { introAt, introEnd, outroAt } = introWindow(cur);
  let t = cur.playhead + Math.max(0, (Date.now() - fetchedAt) / 1000);
  if (cur.introSec > 0 && t >= introAt && t < introEnd) t = introEnd;
  return Math.min(outroAt - 0.05, Math.max(0, t));
}

function beijingClock(ts: number) {
  return new Date(ts).toLocaleTimeString("zh-CN", {
    hour12: false,
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function skipWindow() {
  const el = art?.video;
  const cur = state.value?.current;
  if (!el || !cur || el.readyState < 1 || el.seeking) return;
  const { introAt, introEnd, outroAt } = introWindow(cur);
  if (cur.introSec > 0 && el.currentTime >= introAt && el.currentTime < introEnd - 0.12) {
    el.currentTime = introEnd;
    return;
  }
  if (cur.outroSec > 0 && el.currentTime >= outroAt - 0.12) {
    const target = expectedPlayhead();
    if (target < outroAt - 1 && Math.abs(el.currentTime - target) > 0.8) {
      el.currentTime = target;
      return;
    }
    void resync(true);
  }
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

function isBuffered(el: HTMLVideoElement, t: number) {
  for (let i = 0; i < el.buffered.length; i++) {
    if (t >= el.buffered.start(i) && t <= el.buffered.end(i) - 0.15) return true;
  }
  return el.readyState >= 3;
}

function joinSeek() {
  const el = art?.video;
  if (!el || el.readyState < 1) return;
  const target = expectedPlayhead();
  if (!Number.isFinite(target)) return;
  if (!isBuffered(el, target) && Math.abs(el.currentTime - target) > 8) return;
  seekGuardUntil = Date.now() + 2500;
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
  skipWindow();
  if (Date.now() < seekGuardUntil) return;
  if (remainingSec() <= 0.35) void resync(true);
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
    joinSeek();
    skipWindow();
    if (art?.video?.paused) void tryPlay();
  } finally {
    syncing = false;
  }
}

function destroyPlayer() {
  tearingDown = true;
  if (!art) return;
  art.destroy(false);
  art = null;
}

function createPlayer(url: string) {
  if (!playerEl.value) return;
  destroyPlayer();
  tearingDown = false;
  Artplayer.CONTEXTMENU = false;
  Artplayer.DBCLICK_FULLSCREEN = false;
  art = new Artplayer({
    container: playerEl.value,
    url,
    theme: "#e8b44c",
    lang: "zh-cn",
    volume: volume.value,
    autoplay: true,
    muted: muted.value,
    isLive: false,
    autoOrientation: false,
    hotkey: false,
    lock: false,
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
    mutex: false,
    contextmenu: [],
    moreVideoAttr: {
      playsInline: true,
      controls: false,
      disablePictureInPicture: true,
      disableRemotePlayback: true,
      "webkit-playsinline": true,
      referrerPolicy: "no-referrer",
      controlsList: "nodownload nofullscreen noremoteplayback noplaybackrate",
    },
  });
  art.on("video:loadedmetadata", () => {
    joinSeek();
    skipWindow();
    void tryPlay();
  });
  art.on("video:playing", () => {
    joinSeek();
    skipWindow();
  });
  art.on("video:pause", () => {
    if (!tearingDown) void tryPlay();
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

function toggleOsd() {
  showOsd.value = !showOsd.value;
}

function flashVolume(level: number) {
  volumeHint.value = `音量 ${Math.round(level * 100)}%`;
  window.clearTimeout(volumeTimer);
  volumeTimer = window.setTimeout(() => {
    volumeHint.value = "";
  }, 1400);
}

function nudgeVolume(delta: number) {
  const next = Math.min(1, Math.max(0, Math.round((volume.value + delta) * 10) / 10));
  volume.value = next;
  if (art) {
    art.volume = next;
    if (next > 0) {
      art.muted = false;
      muted.value = false;
    }
  }
  flashVolume(next);
}

function onSurfaceClick() {
  if (art?.muted) {
    art.muted = false;
    muted.value = false;
    void art.play();
  }
}

function onKey(ev: KeyboardEvent) {
  if ([" ", "Spacebar", "ArrowLeft", "ArrowRight", "Home", "End", "j", "k", "l"].includes(ev.key)) {
    ev.preventDefault();
  }
  if (ev.key === "f") void toggleFullscreen();
  if (ev.key === "m" && art) {
    art.muted = !art.muted;
    muted.value = art.muted;
  }
  if (ev.key === "ArrowUp") {
    ev.preventDefault();
    nudgeVolume(0.1);
  }
  if (ev.key === "ArrowDown") {
    ev.preventDefault();
    nudgeVolume(-0.1);
  }
}

onMounted(async () => {
  try {
    await loadNow();
    await nextTick();
    await applySource();
    syncTimer = window.setInterval(() => void resync(false), 30000);
    clockTimer = window.setInterval(() => {
      clock.value = Date.now();
      skipWindow();
    }, 400);
    window.addEventListener("keydown", onKey);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
});

onBeforeUnmount(() => {
  destroyPlayer();
  window.clearInterval(syncTimer);
  window.clearInterval(clockTimer);
  window.clearTimeout(volumeTimer);
  window.removeEventListener("keydown", onKey);
});
</script>

<template>
  <div ref="rootEl" class="tv-root" @click="onSurfaceClick" @contextmenu.prevent>
    <div v-if="state?.current" ref="playerEl" class="tv-player" />
    <button
      v-if="state?.current"
      type="button"
      class="tv-vol tv-vol-up"
      title="增加音量"
      @click.stop.prevent="nudgeVolume(0.1)"
    />
    <button
      v-if="state?.current"
      type="button"
      class="tv-vol tv-vol-down"
      title="降低音量"
      @click.stop.prevent="nudgeVolume(-0.1)"
    />
    <div
      v-if="state?.current"
      class="tv-clock"
      :style="{
        top: (state.channel?.logoY ?? 50) + 'px',
        right: (state.channel?.logoX ?? 50) + 'px',
      }"
      title="显示或隐藏节目信息"
      @click.stop.prevent="toggleOsd"
    >
      {{ beijingClock(clock) }}
    </div>
    <div v-if="volumeHint" class="tv-vol-hint">{{ volumeHint }}</div>
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
