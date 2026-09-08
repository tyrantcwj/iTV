import { test } from "node:test";
import assert from "node:assert/strict";

import { archiveUrl, commitsDiffer, shortSha } from "../src/update/github.js";
import { getUpdateRuntime } from "../src/update/index.js";
import { DEFAULT_BUILD_STEPS, DEFAULT_RUNTIME_PATHS } from "../src/update/types.js";

test("commitsDiffer: 长短不一的提交号按较短的前缀比", () => {
  // 界面上常拿到短号，接口给的是全号，不能直接判不等
  assert.equal(commitsDiffer("abc1234", "abc1234def5678901234567890abcdef12345678"), false);
  assert.equal(commitsDiffer("abc1234def5678901234567890abcdef12345678", "abc1234"), false);
  assert.equal(commitsDiffer("abc1234", "fff9999"), true);
  // 大小写不敏感
  assert.equal(commitsDiffer("ABC1234", "abc1234"), false);
  // 缺一边时按「有更新」处理，宁可多提示一次
  assert.equal(commitsDiffer("", "abc1234"), true);
  assert.equal(commitsDiffer("abc1234", ""), true);
  // 太短时退化成全等比较
  assert.equal(commitsDiffer("abc", "abcdef"), true);
});

test("shortSha: 取前 7 位，空值不炸", () => {
  assert.equal(shortSha("abc1234def5678"), "abc1234");
  assert.equal(shortSha(""), "");
  assert.equal(shortSha(undefined), "");
});

test("archiveUrl: 有 token 走 api.github.com 以便访问私有仓库", () => {
  assert.equal(
    archiveUrl("owner/repo", "main"),
    "https://codeload.github.com/owner/repo/tar.gz/refs/heads/main",
  );
  assert.equal(
    archiveUrl("owner/repo", "main", "ghp_x"),
    "https://api.github.com/repos/owner/repo/tarball/main",
  );
  // 分支名里的斜杠要转义
  assert.match(archiveUrl("owner/repo", "release/1.0"), /release%2F1\.0$/);
});

test("getUpdateRuntime: disabled 不可用，source 始终可用", async () => {
  assert.deepEqual(await getUpdateRuntime({ mode: "disabled" }), {
    mode: "disabled",
    supported: false,
    detail: "在线更新已关闭。",
  });
  const src = await getUpdateRuntime({ mode: "source" });
  assert.equal(src.mode, "source");
  assert.equal(src.supported, true);
  // auto 优先源码模式：对权限要求最低，不必把 Docker socket 挂进容器
  const auto = await getUpdateRuntime({ mode: "auto" });
  assert.equal(auto.mode, "source");
  assert.equal(auto.supported, true);
});

test("默认构建步骤与运行时路径符合常规 Node 服务", () => {
  assert.deepEqual(
    DEFAULT_BUILD_STEPS.map((s) => `${s.command} ${s.args.join(" ")}`),
    ["npm ci --include=dev", "npm run build", "npm prune --omit=dev"],
  );
  assert.ok(DEFAULT_RUNTIME_PATHS.includes("dist"));
  assert.ok(DEFAULT_RUNTIME_PATHS.includes("node_modules"), "依赖也要一并替换，否则新代码可能对不上旧依赖");
});
