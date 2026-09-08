/** 一个探针：往巡检快照里贡献一段自己负责的内容 */
export type Probe = {
  /** 在快照里的字段名 */
  key: string;
  /** 给人看的说明，会出现在 /inspect?describe=1 里 */
  description?: string;
  /** 返回任意可 JSON 化的数据；抛错会被捕获并记进 errors，不影响其他探针 */
  collect: (ctx: InspectContext) => unknown | Promise<unknown>;
};

/** 一个可远程触发的动作 */
export type Action<TInput = unknown, TOutput = unknown> = {
  name: string;
  description?: string;
  /**
   * 是否会改动系统状态。默认 true。
   * 标记 false 的（纯诊断）在只读模式下也允许执行。
   */
  mutates?: boolean;
  /** 校验并归一化入参；抛错即视为参数非法（400） */
  parseInput?: (raw: unknown) => TInput;
  run: (input: TInput, ctx: InspectContext) => TOutput | Promise<TOutput>;
};

export type InspectContext = {
  /** 触发本次调用的查询参数 */
  query: Record<string, string | undefined>;
  /** 应用自己塞进来的东西（store、logger 等），由 createInspector 传入 */
  app: unknown;
};

export type HealthSnapshot = {
  process: {
    uptimeSec: number;
    node: string;
    pid: number;
    platform: string;
    arch: string;
  };
  memoryMB: { rss: number; heapUsed: number; heapTotal: number; external: number };
  /** 事件循环延迟：越大说明越忙或被同步代码阻塞 */
  eventLoopLagMs: number;
};

export type InspectSnapshot = {
  at: string;
  version?: string;
  commit?: string;
  builtAt?: string;
  health: HealthSnapshot;
  /** 各探针贡献的内容 */
  [key: string]: unknown;
};

export type InspectorOptions = {
  /**
   * 校验令牌。返回 true 放行。
   * 不传则退回 token 选项做常数时间比较。
   */
  verifyToken?: (token: string | undefined) => boolean | Promise<boolean>;
  /** 期望的令牌；与 verifyToken 二选一 */
  token?: string | (() => string | undefined);
  version?: string;
  commit?: string;
  builtAt?: string;
  probes?: Probe[];
  actions?: Action[];
  /** 传给探针与动作的应用上下文 */
  app?: unknown;
  /** 只读模式：拒绝一切 mutates 的动作。默认 false */
  readOnly?: boolean;
};

export type ActionResult = {
  ok: boolean;
  action: string;
  elapsedMs: number;
  result?: unknown;
  error?: string;
};
