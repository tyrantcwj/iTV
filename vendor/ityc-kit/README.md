# ityc-kit

Node 服务的两块常用基建，从一个跑在 Docker 里的实际项目里提炼出来：

- **在线更新** —— 容器内拉最新源码、构建、替换、重启，不需要重新打镜像
- **巡检通道** —— 令牌鉴权的只读快照 + 可注册的远程动作，方便人或 Agent 远程排障

两者都不依赖任何 Web 框架，也不假设你用什么存储。

```bash
npm i ityc-kit
```

需要 Node >= 20。

---

## 在线更新

### 解决什么问题

改一行代码就要重新构建镜像、推仓库、拉镜像、重建容器，链路太长。
这个模块让服务**自己**把自己更新掉：拉源码 → 装依赖 → 构建 → 替换运行文件 → 退出让编排拉起。

```ts
import { applyUpdate, checkForUpdate } from "ityc-kit/update";

// 先看看有没有新版本
const status = await checkForUpdate({
  repo: "owner/repo",
  currentCommit: process.env.BUILD_COMMIT ?? "dev",
});
// → { updateAvailable: true, current: "abc1234", latest: "def5678", message: "修复…" }

// 执行更新
const result = await applyUpdate({
  repo: "owner/repo",
  appRoot: "/app",              // 容器内 package.json 所在目录
  githubToken: process.env.GITHUB_TOKEN,  // 私有仓库才需要
  onProgress: (step) => console.log(step),
});
```

### 两种模式

| 模式 | 做什么 | 前提 |
|---|---|---|
| `source`（默认） | 容器内拉源码构建，替换 `dist`/`node_modules` 等，然后退出重启 | 无。容器里有 `npm` 和 `tar` 即可 |
| `docker` | 起一次性 Watchtower 拉新镜像重建容器 | 要把 `/var/run/docker.sock` 挂进容器 |

默认走 `source`，因为它**对权限要求最低** —— 不必把 Docker socket 暴露给应用进程。

> 容器为什么不能自己重建自己：进程被杀掉之后就没人接着往下做了。
> 所以 `docker` 模式要借一个外部的一次性容器来完成替换。

### 更新失败会怎样

替换运行文件之前会**整体备份**,任一步失败就回滚。

不回滚的话，一次失败的更新会让容器里同时存在新旧两套文件，重启后行为难以预测。
宁可退回旧版本，也不要半新半旧。

### 自定义构建步骤

默认是 `npm ci` → `npm run build` → `npm prune --omit=dev`。用别的工具就改这里：

```ts
await applyUpdate({
  repo: "owner/repo",
  appRoot: "/app",
  buildSteps: [
    { label: "Installed", command: "pnpm", args: ["install", "--frozen-lockfile"] },
    { label: "Built", command: "pnpm", args: ["build"] },
  ],
  runtimePaths: ["dist", "package.json", "node_modules"],  // 要替换进 appRoot 的路径
});
```

### 一个必须知道的坑

`source` 模式在替换完成后会安排进程退出（默认 800ms 后），由编排把它拉起来。
**这会切断当前 HTTP 连接**，触发更新的那个请求多半收不到干净的响应。

不要 `await` 它然后等着返回值给用户看。正确做法是几分钟后重新探测版本接口：

```ts
// 客户端
await fetch("/api/agent/act", { method: "POST", body: JSON.stringify({ action: "update" }) });
// 别等这个响应，改成轮询 /api/version 看 commit 变了没
```

传 `restartDelayMs: 0` 可以不自动退出，自己决定什么时候重启。

---

## 巡检通道

### 解决什么问题

线上出问题时，光看日志往往不够 —— 你需要知道**此刻**的内存、事件循环延迟、队列积压、
某个订阅的状态。而且经常需要远程触发一次操作来验证猜测。

这个模块把这件事做成插件式的：框架负责鉴权、健康采集、错误隔离和分发，
业务只管注册自己的**探针**和**动作**。

```ts
import { createInspector } from "ityc-kit/inspect";

const inspector = createInspector({
  token: () => process.env.AGENT_TOKEN,   // 也可以传 verifyToken 自定义校验
  version: "1.0.0",
  commit: process.env.BUILD_COMMIT,
  app: { db, queue },                     // 会原样传给探针和动作

  probes: [
    { key: "queue", description: "队列积压", collect: (ctx) => ctx.app.queue.stats() },
    { key: "db", collect: async (ctx) => ({ connected: await ctx.app.db.ping() }) },
  ],

  actions: [
    { name: "diagnose", mutates: false, run: () => runDiagnostics() },
    { name: "reindex", description: "重建索引", run: (input) => reindex(input) },
  ],
});

const snap = await inspector.snapshot();
// → { at, version, commit, health: { process, memoryMB, eventLoopLagMs }, queue: {...}, db: {...} }
```

### 快照里默认带什么

```jsonc
{
  "at": "2026-01-01T00:00:00.000Z",
  "version": "1.0.0",
  "commit": "abc1234",
  "health": {
    "process": { "uptimeSec": 3600, "node": "v22.0.0", "pid": 1, "platform": "linux", "arch": "x64" },
    "memoryMB": { "rss": 276.7, "heapUsed": 56.6, "heapTotal": 89.6, "external": 3.9 },
    "eventLoopLagMs": 1.11
  }
}
```

`eventLoopLagMs` 是最便宜也最能说明问题的一个指标 —— 服务卡顿时它会立刻涨上去。

### 探针互不影响

一个探针抛错**不会**让整份快照取不到，错误会被收进 `probeErrors`：

```jsonc
{ "ok": 1, "alsoOk": 2, "probeErrors": [{ "probe": "broken", "error": "数据库连不上" }] }
```

出问题的时候，正是最需要看到其余部分的时候。

### 动作与只读模式

```ts
const r = await inspector.run("reindex", { full: true });
// → { ok: true, action: "reindex", elapsedMs: 1234, result: {...} }
```

标了 `mutates: false` 的是纯诊断动作。开 `readOnly: true` 时，只有这类动作能执行 ——
适合把巡检权限给到不该改动系统的一方。

`describe()` 会列出所有已注册的探针和动作，对接方可以自我发现，不必翻文档。

### 鉴权

- 支持 `Authorization: Bearer <token>` 和 `?token=<token>` 两种
- 常数时间比较，避免用比较耗时反推令牌
- **没配令牌时一律拒绝** —— 宁可用不了，也不能裸奔

---

## 接到 Web 框架上

两个模块都是纯函数/纯对象，不绑定框架。完整示例见
[`examples/fastify.ts`](examples/fastify.ts)，Express / Koa 同理：

```ts
app.get("/api/agent/inspect", async (req, reply) => {
  if (!(await inspector.authorize(req.headers.authorization, req.query.token))) {
    return reply.code(401).send({ error: "unauthorized" });
  }
  return inspector.snapshot(req.query);
});
```

---

## 环境变量

| 变量 | 作用 | 默认 |
|---|---|---|
| `ITYC_KIT_HTTP_TIMEOUT_MS` | 访问 GitHub API 的超时 | `20000` |
| `ITYC_KIT_WATCHTOWER_IMAGE` | docker 模式用的镜像 | `containrrr/watchtower:latest` |
| `DOCKER_SOCKET` | Docker socket 路径 | `/var/run/docker.sock` |

## 开发

```bash
npm i
npm run check   # 构建 + 测试
```

## License

MIT
