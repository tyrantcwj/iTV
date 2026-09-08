import http from "node:http";

const DOCKER_SOCKET = process.env.DOCKER_SOCKET ?? "/var/run/docker.sock";
const WATCHTOWER_IMAGE = process.env.ITYC_KIT_WATCHTOWER_IMAGE ?? "containrrr/watchtower:latest";

function dockerRequest(method: string, path: string, body?: unknown): Promise<{ status: number; text: string }> {
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
        timeout: 30_000,
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

/** 容器里能不能摸到 Docker socket——决定 docker 模式可不可用 */
export async function canAccessDockerSocket(): Promise<boolean> {
  try {
    const res = await dockerRequest("GET", "/_ping");
    return res.status >= 200 && res.status < 300;
  } catch {
    return false;
  }
}

/**
 * 起一次性 Watchtower 容器，拉最新镜像并重建目标容器。
 *
 * 为什么不自己 stop/start：容器不能重建自己——进程被杀掉之后就没人接着往下做了。
 * 交给一个外部的一次性容器来做，才能安全地把自己换掉。
 */
export async function startWatchtowerUpdate(targetContainer: string): Promise<string> {
  const name = `ityc-kit-update-${Date.now()}`;
  const created = await dockerRequest("POST", `/containers/create?name=${encodeURIComponent(name)}`, {
    Image: WATCHTOWER_IMAGE,
    Cmd: ["--run-once", "--cleanup", targetContainer],
    HostConfig: {
      AutoRemove: true,
      Binds: [`${DOCKER_SOCKET}:/var/run/docker.sock`],
    },
  });
  if (created.status < 200 || created.status >= 300) {
    throw new Error(`创建 Watchtower 容器失败：HTTP ${created.status} ${created.text.slice(0, 200)}`);
  }
  const id = (JSON.parse(created.text) as { Id?: string }).Id;
  if (!id) throw new Error("Docker 未返回容器 ID");
  const started = await dockerRequest("POST", `/containers/${id}/start`);
  if (started.status < 200 || started.status >= 300) {
    throw new Error(`启动 Watchtower 容器失败：HTTP ${started.status} ${started.text.slice(0, 200)}`);
  }
  return id;
}
