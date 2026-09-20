import http from "node:http";

const DOCKER_SOCKET = process.env.DOCKER_SOCKET ?? "/var/run/docker.sock";
const WATCHTOWER_IMAGE = process.env.ITYC_KIT_WATCHTOWER_IMAGE ?? "containrrr/watchtower:latest";
const PULL_TIMEOUT_MS = Number(process.env.ITYC_KIT_PULL_TIMEOUT_MS ?? 300_000);

/**
 * 起完 Watchtower 之后最多盯着它看多久。
 *
 * 这个等待不是为了等更新成功——真成功的标志是我们自己被杀掉，
 * 那时候什么响应都发不出去。等待是为了抓住**快速失败**：
 * 容器名对不上、镜像拉不动、registry 没权限，这些几秒内就见分晓。
 * 默认 45 秒，留在常见反向代理 60 秒读超时以内。
 */
const WATCH_MS = Number(process.env.ITYC_KIT_UPDATE_WAIT_MS ?? 45_000);

const LF = String.fromCharCode(10);

type DockerReply = { status: number; text: string };

function dockerRequest(
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = 30_000,
): Promise<DockerReply> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        socketPath: DOCKER_SOCKET,
        path,
        method,
        headers: payload
          ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }
          : undefined,
        timeout: timeoutMs,
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("Docker socket 请求超时")));
    if (payload) req.write(payload);
    req.end();
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const isLetter = (code: number): boolean =>
  (code >= 65 && code <= 90) || (code >= 97 && code <= 122);

/** Watchtower 是带颜色输出的，控制码原样贴到界面上就是一串乱码 */
function stripAnsi(s: string): string {
  const ESC = 27;
  const BRACKET = 91;
  let out = "";
  for (let i = 0; i < s.length; i += 1) {
    if (s.charCodeAt(i) === ESC) {
      i += 1;
      if (s.charCodeAt(i) === BRACKET) {
        // CSI 序列一直到第一个字母为止
        i += 1;
        while (i < s.length && !isLetter(s.charCodeAt(i))) i += 1;
      }
      continue;
    }
    out += s.charAt(i);
  }
  return out;
}

/** 把日志尾巴收拾成一句能塞进界面的话 */
function tailOf(logs: string, max = 400): string {
  const clean = stripAnsi(logs)
    .split(LF)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" | ");
  return clean.length > max ? "…" + clean.slice(-max) : clean;
}

/** 容器里能不能摸到 Docker socket——决定 docker 模式可不可用 */
export async function canAccessDockerSocket(): Promise<boolean> {
  try {
    const res = await dockerRequest("GET", "/_ping");
    return res.status >= 200 && res.status < 300;
  } catch {
    return false;
  }
}

function splitImageRef(ref: string): { name: string; tag: string } {
  const at = ref.indexOf("@");
  if (at > 0) return { name: ref.slice(0, at), tag: ref.slice(at + 1) };
  const slash = ref.lastIndexOf("/");
  const colon = ref.lastIndexOf(":");
  if (colon > slash) return { name: ref.slice(0, colon), tag: ref.slice(colon + 1) };
  return { name: ref, tag: "latest" };
}

async function imageExists(ref: string): Promise<boolean> {
  const res = await dockerRequest("GET", "/images/" + encodeURIComponent(ref) + "/json");
  return res.status === 200;
}

/**
 * 拉镜像。
 *
 * 必须显式拉：Engine API 的 /containers/create 和 `docker run` 不一样，
 * 它**不会**自动拉缺失的镜像，而是直接回 404 "No such image"。
 * 一台从没跑过 Watchtower 的机器，在线更新就卡死在这一步——
 * 而且这台机器本来也没有理由预先有这个镜像。
 */
async function pullImage(ref: string): Promise<void> {
  const { name, tag } = splitImageRef(ref);
  const res = await dockerRequest(
    "POST",
    "/images/create?fromImage=" + encodeURIComponent(name) + "&tag=" + encodeURIComponent(tag),
    undefined,
    PULL_TIMEOUT_MS,
  );
  if (res.status < 200 || res.status >= 300) {
    throw new Error("拉取镜像 " + ref + " 失败：HTTP " + res.status + " " + res.text.slice(0, 200));
  }
  // 坑：拉取失败时 HTTP 状态码照样是 200，错误写在流里的某一行 JSON 上。
  // 只看状态码会把「拉不到镜像」当成拉成功，然后在下一步莫名其妙地 404。
  for (const line of res.text.split(LF)) {
    const t = line.trim();
    if (!t) continue;
    let obj: { error?: string } | null = null;
    try {
      obj = JSON.parse(t) as { error?: string };
    } catch {
      obj = null;
    }
    if (obj && obj.error) throw new Error("拉取镜像 " + ref + " 失败：" + obj.error);
  }
}

async function listContainerNames(): Promise<string[]> {
  const res = await dockerRequest("GET", "/containers/json?all=1");
  if (res.status !== 200) return [];
  try {
    const list = JSON.parse(res.text) as Array<{ Names?: string[] }>;
    return list
      .flatMap((c) => c.Names ?? [])
      .map((n) => (n.startsWith("/") ? n.slice(1) : n));
  } catch {
    return [];
  }
}

/**
 * 确认要更新的容器真的存在。
 *
 * Watchtower 找不到目标容器时是**安静地成功退出**的（扫了 0 个容器，退出码 0），
 * 界面上看就是「更新已触发」然后什么都没发生。容器名写错就会掉进这个坑
 * （docker compose 不写 container_name 时会起成 `<项目>-<服务>-1`），
 * 所以先自己查一遍，把名字对不上这件事直接说出来。
 */
type TargetInfo = { dns?: string[]; dnsSearch?: string[] };

async function inspectTarget(target: string): Promise<TargetInfo> {
  const res = await dockerRequest("GET", "/containers/" + encodeURIComponent(target) + "/json");
  if (res.status === 404) {
    const names = await listContainerNames();
    const hint = names.length ? "当前容器有：" + names.join("、") : "而且一个容器都列不出来";
    throw new Error("找不到要更新的容器 " + target + "（" + hint + "）。请核对 ITYC_CONTAINER_NAME。");
  }
  if (res.status !== 200) {
    throw new Error("查询容器 " + target + " 失败：HTTP " + res.status + " " + res.text.slice(0, 200));
  }
  let host: { Dns?: string[]; DnsSearch?: string[] } | undefined;
  try {
    host = (JSON.parse(res.text) as { HostConfig?: { Dns?: string[]; DnsSearch?: string[] } }).HostConfig;
  } catch {
    host = undefined;
  }
  return { dns: host?.Dns, dnsSearch: host?.DnsSearch };
}

/** 清掉上次留下的更新容器：不再用 AutoRemove，收尾得自己做 */
async function sweepStaleUpdaters(actions: string[]): Promise<void> {
  const filters = encodeURIComponent(JSON.stringify({ name: ["ityc-kit-update-"] }));
  const res = await dockerRequest("GET", "/containers/json?all=1&filters=" + filters);
  if (res.status !== 200) return;
  let list: Array<{ Id?: string; State?: string; Created?: number }> = [];
  try {
    list = JSON.parse(res.text) as typeof list;
  } catch {
    return;
  }
  const cutoff = Date.now() / 1000 - 600;
  for (const c of list) {
    if (!c.Id) continue;
    // 还在跑而且刚起来的别碰——那可能是另一次更新正在进行
    if (c.State === "running" && (c.Created ?? 0) > cutoff) continue;
    await dockerRequest("DELETE", "/containers/" + c.Id + "?force=1&v=1").catch(() => undefined);
    actions.push("Removed stale updater " + c.Id.slice(0, 12));
  }
}

async function containerLogs(id: string): Promise<string> {
  const res = await dockerRequest("GET", "/containers/" + id + "/logs?stdout=1&stderr=1&tail=60");
  return res.status >= 200 && res.status < 300 ? res.text : "";
}

export type WatchtowerRun = {
  id: string;
  /** 跑完了没有。没跑完说明它正在重建容器，多半下一秒连我们一起换掉 */
  finished: boolean;
  exitCode?: number;
  /** 日志尾巴，失败时就靠它定位 */
  logs: string;
  actions: string[];
};

/**
 * 起一次性 Watchtower 容器，拉最新镜像并重建目标容器。
 *
 * 为什么不自己 stop/start：容器不能重建自己——进程被杀掉之后就没人接着往下做了。
 * 交给一个外部的一次性容器来做，才能安全地把自己换掉。
 *
 * 这个函数会盯到 Watchtower 退出或超时，而不是起完就返回。起完就返回的写法
 * 每次都报「已触发更新」，而失败时容器带着日志一起被 AutoRemove 掉，
 * 现场什么都不剩——用起来就是「在线更新没反应」。
 */
export async function runWatchtowerUpdate(target: string): Promise<WatchtowerRun> {
  const actions: string[] = [];

  const info = await inspectTarget(target);
  actions.push("Target container: " + target);

  await sweepStaleUpdaters(actions);

  if (await imageExists(WATCHTOWER_IMAGE)) {
    actions.push("Watchtower image ready: " + WATCHTOWER_IMAGE);
  } else {
    await pullImage(WATCHTOWER_IMAGE);
    actions.push("Pulled " + WATCHTOWER_IMAGE);
  }

  const name = "ityc-kit-update-" + Date.now();
  const created = await dockerRequest("POST", "/containers/create?name=" + encodeURIComponent(name), {
    Image: WATCHTOWER_IMAGE,
    Cmd: ["--run-once", "--cleanup", target],
    // 开 TTY，日志就是一条裸流，省得自己拆 Docker 那 8 字节的多路复用帧头
    Tty: true,
    HostConfig: {
      // 不用 AutoRemove：容器一退出就连日志一起蒸发，失败时等于没有现场。改成跑完自己删。
      AutoRemove: false,
      RestartPolicy: { Name: "no" },
      Binds: [DOCKER_SOCKET + ":/var/run/docker.sock"],
      // 跟着目标容器用同一组 DNS。目标容器特意写了 dns:，通常就说明宿主机
      // 那套解析在容器里不好使；新起的容器不继承这个，会卡在解析 registry 上，
      // 表现出来又是一次「更新没反应」。
      ...(info.dns && info.dns.length ? { Dns: info.dns } : {}),
      ...(info.dnsSearch && info.dnsSearch.length ? { DnsSearch: info.dnsSearch } : {}),
    },
  });
  if (created.status < 200 || created.status >= 300) {
    throw new Error("创建 Watchtower 容器失败：HTTP " + created.status + " " + created.text.slice(0, 200));
  }
  const id = (JSON.parse(created.text) as { Id?: string }).Id;
  if (!id) throw new Error("Docker 未返回容器 ID");

  const started = await dockerRequest("POST", "/containers/" + id + "/start");
  if (started.status < 200 || started.status >= 300) {
    const why = "启动 Watchtower 容器失败：HTTP " + started.status + " " + started.text.slice(0, 200);
    await dockerRequest("DELETE", "/containers/" + id + "?force=1&v=1").catch(() => undefined);
    throw new Error(why);
  }
  actions.push("Started Watchtower " + id.slice(0, 12));

  const deadline = Date.now() + WATCH_MS;
  let running = true;
  let exitCode: number | undefined;
  while (Date.now() < deadline) {
    await sleep(1_000);
    const res = await dockerRequest("GET", "/containers/" + id + "/json");
    if (res.status !== 200) break;
    const state = (JSON.parse(res.text) as { State?: { Running?: boolean; ExitCode?: number } }).State;
    if (state && state.Running === false) {
      running = false;
      exitCode = state.ExitCode;
      break;
    }
  }

  const logs = tailOf(await containerLogs(id));
  if (!running) {
    await dockerRequest("DELETE", "/containers/" + id + "?force=1&v=1").catch(() => undefined);
  }
  return { id, finished: !running, exitCode, logs, actions };
}

export type DockerPreflight = {
  socket: boolean;
  target: { name: string; exists: boolean; image?: string; others?: string[] };
  watchtower: { image: string; present: boolean };
};

/**
 * 只读预检：不动任何东西，回答「现在点更新会不会成」。
 *
 * 在线更新出问题最难受的地方是只能靠点一下试试，而点一下的代价是可能把服务重建掉。
 * 有了这个就能先看一眼容器名对不对、Watchtower 镜像在不在。
 */
export async function dockerUpdatePreflight(target: string): Promise<DockerPreflight> {
  const socket = await canAccessDockerSocket();
  const out: DockerPreflight = {
    socket,
    target: { name: target, exists: false },
    watchtower: { image: WATCHTOWER_IMAGE, present: false },
  };
  if (!socket) return out;

  const res = await dockerRequest("GET", "/containers/" + encodeURIComponent(target) + "/json");
  if (res.status === 200) {
    out.target.exists = true;
    try {
      out.target.image = (JSON.parse(res.text) as { Config?: { Image?: string } }).Config?.Image;
    } catch {
      out.target.image = undefined;
    }
  } else {
    out.target.others = await listContainerNames();
  }
  out.watchtower.present = await imageExists(WATCHTOWER_IMAGE);
  return out;
}

/** @deprecated 用 runWatchtowerUpdate——它会等结果，这个起完就撒手不管 */
export async function startWatchtowerUpdate(targetContainer: string): Promise<string> {
  const run = await runWatchtowerUpdate(targetContainer);
  return run.id;
}
