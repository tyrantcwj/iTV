import { test } from "node:test";
import assert from "node:assert/strict";

import { createInspector } from "../src/inspect/index.js";

test("鉴权：Bearer 与 query token 都认，未配令牌一律拒绝", async () => {
  const ins = createInspector({ token: "s3cret" });
  assert.equal(await ins.authorize("Bearer s3cret"), true);
  assert.equal(await ins.authorize(undefined, "s3cret"), true);
  assert.equal(await ins.authorize("Bearer wrong"), false);
  assert.equal(await ins.authorize(undefined, undefined), false);

  // 没配令牌时不能放行——宁可用不了，也不能裸奔
  const naked = createInspector({});
  assert.equal(await naked.authorize(undefined, "anything"), false);
  assert.equal(await naked.authorize("Bearer anything"), false);
});

test("快照：健康指标齐全，探针各自贡献字段", async () => {
  const ins = createInspector({
    token: "t",
    version: "1.2.3",
    commit: "abcdef1",
    probes: [
      { key: "queue", collect: () => ({ pending: 3 }) },
      { key: "db", collect: async () => ({ connected: true }) },
    ],
  });
  const snap = await ins.snapshot();
  assert.equal(snap.version, "1.2.3");
  assert.deepEqual(snap.queue, { pending: 3 });
  assert.deepEqual(snap.db, { connected: true });
  assert.ok(snap.health.process.pid > 0);
  assert.ok(snap.health.memoryMB.rss > 0);
  assert.ok(typeof snap.health.eventLoopLagMs === "number");
  assert.equal(snap.probeErrors, undefined);
});

test("快照：单个探针抛错不影响其余探针", async () => {
  const ins = createInspector({
    token: "t",
    probes: [
      { key: "ok", collect: () => 1 },
      {
        key: "broken",
        collect: () => {
          throw new Error("数据库连不上");
        },
      },
      { key: "alsoOk", collect: () => 2 },
    ],
  });
  const snap = await ins.snapshot();
  assert.equal(snap.ok, 1);
  assert.equal(snap.alsoOk, 2, "坏探针不该让后面的探针不执行");
  assert.equal(snap.broken, undefined);
  assert.deepEqual(snap.probeErrors, [{ probe: "broken", error: "数据库连不上" }]);
});

test("动作：执行、传参、错误与未注册", async () => {
  const ins = createInspector({
    token: "t",
    app: { factor: 10 },
    actions: [
      {
        name: "multiply",
        parseInput: (raw) => {
          const n = Number((raw as { n?: unknown })?.n);
          if (!Number.isFinite(n)) throw new Error("n 必须是数字");
          return n;
        },
        run: (n, ctx) => n * (ctx.app as { factor: number }).factor,
      },
      {
        name: "boom",
        run: () => {
          throw new Error("炸了");
        },
      },
    ],
  });

  const ok = await ins.run("multiply", { n: 4 });
  assert.equal(ok.ok, true);
  assert.equal(ok.result, 40);
  assert.ok(ok.elapsedMs >= 0);

  const badInput = await ins.run("multiply", { n: "x" });
  assert.equal(badInput.ok, false);
  assert.match(String(badInput.error), /n 必须是数字/);

  const threw = await ins.run("boom");
  assert.equal(threw.ok, false);
  assert.match(String(threw.error), /炸了/);

  const missing = await ins.run("nope");
  assert.equal(missing.ok, false);
  assert.match(String(missing.error), /未注册的动作/);
});

test("只读模式：拒绝会改状态的动作，放行纯诊断", async () => {
  const ins = createInspector({
    token: "t",
    readOnly: true,
    actions: [
      { name: "restart", run: () => "done" },
      { name: "diagnose", mutates: false, run: () => "fine" },
    ],
  });
  const blocked = await ins.run("restart");
  assert.equal(blocked.ok, false);
  assert.match(String(blocked.error), /只读模式/);

  const allowed = await ins.run("diagnose");
  assert.equal(allowed.ok, true);
  assert.equal(allowed.result, "fine");
});

test("describe：能自我发现已注册的探针与动作", async () => {
  const ins = createInspector({
    token: "t",
    probes: [{ key: "queue", description: "任务队列积压" }],
    actions: [
      { name: "poll", description: "立即轮询一次", run: () => 1 },
      { name: "diagnose", mutates: false, run: () => 1 },
    ],
  });
  const d = ins.describe();
  assert.deepEqual(d.probes, [{ key: "queue", description: "任务队列积压" }]);
  assert.deepEqual(d.actions, [
    { name: "poll", description: "立即轮询一次", mutates: true },
    { name: "diagnose", description: undefined, mutates: false },
  ]);
});

test("运行时注册：addProbe / addAction 立即生效", async () => {
  const ins = createInspector({ token: "t" });
  ins.addProbe({ key: "later", collect: () => "yes" });
  ins.addAction({ name: "later", run: () => "ran" });
  const snap = await ins.snapshot();
  assert.equal(snap.later, "yes");
  assert.equal((await ins.run("later")).result, "ran");
});
