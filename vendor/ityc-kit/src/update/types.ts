/** 更新方式。auto 会按运行环境自动挑一种。 */
export type UpdateMode = "source" | "docker" | "disabled";

export type UpdateRuntime = {
  mode: UpdateMode;
  /** 当前环境是否真的能执行这种更新 */
  supported: boolean;
  /** 给用户看的一句话说明 */
  detail: string;
};

export type UpdateResult = {
  ok: boolean;
  mode: UpdateMode;
  detail: string;
  /** 逐步动作，便于在界面上展示进度与排障 */
  actions: string[];
  /** 更新到的提交号（source 模式） */
  commit?: string;
};

export type LatestCommit = {
  commit: string;
  message: string;
  date?: string;
};

export type UpdateOptions = {
  /**
   * 源码仓库，形如 owner/repo。更新时会拉这个仓库默认分支的最新提交。
   */
  repo: string;
  /**
   * 应用在容器内的根目录（package.json 所在处）。构建产物会替换到这里。
   */
  appRoot: string;
  /** 私有仓库需要；公开仓库留空即可 */
  githubToken?: string;
  /** 默认分支名，默认 main */
  branch?: string;
  /**
   * 构建步骤。默认 npm ci → npm run build → npm prune --omit=dev。
   * 只用 tsc、或者要跑别的打包器时改这里。
   */
  buildSteps?: BuildStep[];
  /**
   * 更新后要替换进 appRoot 的路径（相对源码根）。
   * 默认 ["dist", "public", "package.json", "package-lock.json", "node_modules"]。
   */
  runtimePaths?: string[];
  /** 强制指定更新方式，不传则自动判断 */
  mode?: UpdateMode | "auto";
  /** docker 模式下要重建的容器名，默认取 HOSTNAME */
  containerName?: string;
  /** docker 模式下要拉取的镜像 */
  image?: string;
  /** 更新完成后多久退出进程让编排重启，默认 800ms；传 0 表示不自动退出 */
  restartDelayMs?: number;
  /** 进度回调 */
  onProgress?: (action: string) => void;
};

export type BuildStep = {
  /** 展示用的名字，会进 actions */
  label: string;
  command: string;
  args: string[];
  timeoutMs?: number;
};

export const DEFAULT_BUILD_STEPS: BuildStep[] = [
  { label: "Installed build dependencies", command: "npm", args: ["ci", "--include=dev"], timeoutMs: 600_000 },
  { label: "Built assets", command: "npm", args: ["run", "build"], timeoutMs: 600_000 },
  { label: "Pruned dev dependencies", command: "npm", args: ["prune", "--omit=dev"], timeoutMs: 300_000 },
];

export const DEFAULT_RUNTIME_PATHS = ["dist", "public", "package.json", "package-lock.json", "node_modules"];
