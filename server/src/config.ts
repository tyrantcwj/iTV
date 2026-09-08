import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PORT || 8787);
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const config = {
  port,
  serverRoot,
  dataDir: process.env.DATA_DIR || path.resolve(serverRoot, "../data"),
  internalBaseUrl: process.env.INTERNAL_BASE_URL || `http://127.0.0.1:${port}`,
  china: {
    authorize: "https://login.chinacloudapi.cn",
    token: "https://login.chinacloudapi.cn",
    graph: "https://microsoftgraph.chinacloudapi.cn/v1.0",
    scopes: "offline_access User.Read Files.Read Files.Read.All",
  },
};

export function ensureDirs() {
  for (const dir of [
    config.dataDir,
    path.join(config.dataDir, "logos"),
    path.join(config.dataDir, "tmp"),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
