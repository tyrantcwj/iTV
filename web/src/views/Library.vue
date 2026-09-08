<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api, formatSize, formatTime, type DriveBrowseItem, type MediaItem } from "../api";

type Crumb = { id: string; name: string };

const crumbs = ref<Crumb[]>([{ id: "root", name: "OneDrive" }]);
const driveItems = ref<DriveBrowseItem[]>([]);
const selectedDrive = ref<string[]>([]);
const library = ref<MediaItem[]>([]);
const selectedLib = ref<string[]>([]);
const intro = ref("0");
const outro = ref("0");
const loading = ref(false);
const probing = ref(false);
const error = ref("");
const notice = ref("");
const keyword = ref("");

const currentId = computed(() => crumbs.value[crumbs.value.length - 1].id);
const filtered = computed(() => {
  const q = keyword.value.trim().toLowerCase();
  if (!q) return library.value;
  return library.value.filter(
    (m) => m.name.toLowerCase().includes(q) || m.path.toLowerCase().includes(q),
  );
});
const allChecked = computed(
  () => filtered.value.length > 0 && filtered.value.every((m) => selectedLib.value.includes(m.id)),
);

async function loadDrive(itemId = currentId.value) {
  loading.value = true;
  error.value = "";
  try {
    const data = await api<{ items: DriveBrowseItem[] }>(
      `/api/onedrive/browse?itemId=${encodeURIComponent(itemId)}`,
    );
    driveItems.value = data.items;
    selectedDrive.value = [];
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function loadLibrary() {
  const data = await api<{ items: MediaItem[] }>("/api/media");
  library.value = data.items;
}

onMounted(async () => {
  await loadLibrary();
  await loadDrive("root");
});

function openFolder(item: DriveBrowseItem) {
  crumbs.value.push({ id: item.id, name: item.name });
  loadDrive(item.id);
}

function goCrumb(index: number) {
  crumbs.value = crumbs.value.slice(0, index + 1);
  loadDrive();
}

function toggleDrive(id: string, checked: boolean) {
  if (checked) selectedDrive.value = [...new Set([...selectedDrive.value, id])];
  else selectedDrive.value = selectedDrive.value.filter((x) => x !== id);
}

function toggleLib(id: string, checked: boolean) {
  if (checked) selectedLib.value = [...new Set([...selectedLib.value, id])];
  else selectedLib.value = selectedLib.value.filter((x) => x !== id);
}

function toggleAll(checked: boolean) {
  if (checked) selectedLib.value = filtered.value.map((m) => m.id);
  else selectedLib.value = [];
}

async function importSelected() {
  loading.value = true;
  try {
    const data = await api<{ imported: MediaItem[] }>("/api/media/import", {
      method: "POST",
      body: JSON.stringify({ itemIds: selectedDrive.value }),
    });
    notice.value = `已导入 ${data.imported.length} 个视频`;
    await loadLibrary();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function importFolder() {
  loading.value = true;
  try {
    const data = await api<{ imported: MediaItem[] }>("/api/media/import", {
      method: "POST",
      body: JSON.stringify({ folderId: currentId.value }),
    });
    notice.value = `已从当前文件夹导入 ${data.imported.length} 个视频`;
    await loadLibrary();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function applySkip() {
  if (!selectedLib.value.length) return;
  await api("/api/media/skip", {
    method: "POST",
    body: JSON.stringify({ ids: selectedLib.value, intro: intro.value, outro: outro.value }),
  });
  notice.value = `已为 ${selectedLib.value.length} 集设置片头 ${intro.value} / 片尾 ${outro.value}`;
  await loadLibrary();
}

async function probeSelected() {
  if (!selectedLib.value.length) return;
  probing.value = true;
  try {
    const data = await api<{ results: { ok: boolean }[] }>("/api/media/probe", {
      method: "POST",
      body: JSON.stringify({ ids: selectedLib.value }),
    });
    const ok = data.results.filter((r) => r.ok).length;
    notice.value = `已探测 ${ok}/${data.results.length} 条时长`;
    await loadLibrary();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    probing.value = false;
  }
}

async function removeSelected() {
  if (!selectedLib.value.length) return;
  if (!confirm(`从片库移除 ${selectedLib.value.length} 条？不会删除 OneDrive 原文件。`)) return;
  await api("/api/media", { method: "DELETE", body: JSON.stringify({ ids: selectedLib.value }) });
  selectedLib.value = [];
  await loadLibrary();
}

async function saveOne(item: MediaItem, field: "introSec" | "outroSec", value: string) {
  await api(`/api/media/${item.id}`, {
    method: "PATCH",
    body: JSON.stringify(field === "introSec" ? { intro: value } : { outro: value }),
  });
  await loadLibrary();
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h2>片库</h2>
        <p>从世纪互联导入视频，批量填写片头 / 片尾秒数（也支持 1:30）</p>
      </div>
    </div>
    <p v-if="error" class="error">{{ error }} <router-link to="/settings">去设置连接</router-link></p>
    <p v-if="notice" class="ok">{{ notice }}</p>

    <div class="grid-2">
      <div class="card">
        <h3 style="margin-top: 0">OneDrive</h3>
        <div class="crumbs">
          <button v-for="(c, i) in crumbs" :key="c.id" @click="goCrumb(i)">{{ c.name }}</button>
        </div>
        <div class="row" style="margin: 12px 0">
          <button class="btn" :disabled="loading || !selectedDrive.length" @click="importSelected">
            导入勾选
          </button>
          <button class="btn secondary" :disabled="loading" @click="importFolder">
            导入当前文件夹全部视频
          </button>
        </div>
        <p v-if="loading" class="hint">加载中…</p>
        <table class="table">
          <tbody>
            <tr v-for="item in driveItems" :key="item.id">
              <td style="width: 28px">
                <input
                  v-if="item.video || item.folder"
                  type="checkbox"
                  :checked="selectedDrive.includes(item.id)"
                  @change="toggleDrive(item.id, ($event.target as HTMLInputElement).checked)"
                />
              </td>
              <td>
                <button v-if="item.folder" class="btn secondary" @click="openFolder(item)">
                  {{ item.name }}
                </button>
                <span v-else>{{ item.name }}</span>
              </td>
              <td class="muted-note">
                {{ item.folder ? `${item.childCount} 项` : formatSize(item.size) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="card">
        <h3 style="margin-top: 0">已导入 {{ library.length }} 条</h3>
        <div class="row" style="margin-bottom: 12px">
          <input v-model="keyword" placeholder="搜索文件名" style="min-width: 160px" />
          <input v-model="intro" placeholder="片头 1:30 或 90" style="width: 120px" />
          <input v-model="outro" placeholder="片尾" style="width: 120px" />
          <button class="btn" :disabled="!selectedLib.length" @click="applySkip">批量应用</button>
          <button class="btn secondary" :disabled="!selectedLib.length || probing" @click="probeSelected">
            {{ probing ? "探测中…" : "探测时长" }}
          </button>
          <button class="btn danger" :disabled="!selectedLib.length" @click="removeSelected">移除</button>
        </div>
        <table class="table">
          <thead>
            <tr>
              <th><input type="checkbox" :checked="allChecked" @change="toggleAll(($event.target as HTMLInputElement).checked)" /></th>
              <th>名称</th>
              <th>时长</th>
              <th>片头</th>
              <th>片尾</th>
              <th>网页</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in filtered" :key="item.id">
              <td>
                <input
                  type="checkbox"
                  :checked="selectedLib.includes(item.id)"
                  @change="toggleLib(item.id, ($event.target as HTMLInputElement).checked)"
                />
              </td>
              <td>
                <div>{{ item.name }}</div>
                <div class="muted-note">{{ item.path }}</div>
              </td>
              <td>{{ item.durationSec ? formatTime(item.durationSec) : "未知" }}</td>
              <td>
                <input
                  :value="item.introSec"
                  style="width: 72px"
                  @change="saveOne(item, 'introSec', ($event.target as HTMLInputElement).value)"
                />
              </td>
              <td>
                <input
                  :value="item.outroSec"
                  style="width: 72px"
                  @change="saveOne(item, 'outroSec', ($event.target as HTMLInputElement).value)"
                />
              </td>
              <td>
                <span v-if="item.webPlayable" class="badge">可播</span>
                <span v-else class="badge warn">仅 M3U</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
