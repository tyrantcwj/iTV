# 虚拟电视台轮播系统

从 OneDrive 世纪互联拉片源，在浏览器里 24 小时对齐轮播，左上角叠加自己的台标，并输出 M3U 给 VLC / IPTV。

## 功能

- 世纪互联 OAuth 授权、浏览文件夹、导入视频
- 批量勾选集数，设定片头 / 片尾（秒或 `1:30`）
- 频道节目单 + 墙上时钟对齐（刷新也会停在「现在该播的位置」）
- 网页直播页左上角台标
- `/live/playlist.m3u` 与 `/live/{频道id}.m3u`，直播流为 ffmpeg stream copy 的 MPEG-TS

## 本地开发

需要 Node.js 22。网页播放不强制 ffmpeg；M3U 直播流需要本机已安装 ffmpeg。

```bash
npm install
npm install --prefix server
npm install --prefix web
npm run dev
```

- 后台与直播页：<http://127.0.0.1:5173>
- API：<http://127.0.0.1:8787>

首次打开「设置」，填写 Azure 中国应用信息后点「连接 OneDrive」。

## Docker 镜像

推送到 `main` 后，GitHub Actions 会构建并发布多架构镜像（`linux/amd64`、`linux/arm64`）：

```bash
docker pull ghcr.io/tyrantcwj/itv:latest
```

1Panel / NAS 可直接跑镜像，不必在机器上编译：

```bash
docker run -d --name itv --restart unless-stopped \
  -p 8787:8787 \
  -v "$PWD/data:/app/data" \
  -e TZ=Asia/Shanghai \
  ghcr.io/tyrantcwj/itv:latest
```

或本地构建：

```bash
docker compose up -d --build
```

服务端口 `8787`。在 1Panel 建网站反代到该端口，建议 HTTPS。
若 GHCR 拉取提示未授权，到仓库 Packages 把 `itv` 设为 Public。

数据在 `./data`：SQLite、台标、临时 concat 文件。视频本身不落盘，只做 Range 代理。

## Azure 中国应用注册

1. [portal.azure.cn](https://portal.azure.cn) → 应用注册
2. 重定向 URI（Web）：`https://你的域名/api/onedrive/callback`
3. 新建客户端密码
4. Graph 权限：`User.Read`、`Files.Read`、`Files.Read.All`、`offline_access`

设置页里的「对外访问根地址」填公网 HTTPS 根，例如 `https://tv.example.com`，否则 M3U 里的链接可能是内网地址。

## 使用顺序

1. 设置里连接 OneDrive
2. 片库里导入一季，多选后填写片头/片尾；时长为空时点「探测时长」
3. 新建频道，上传台标，把剧集排进节目单并保存
4. 打开「收看」，或把 M3U 丢进播放器

浏览器能稳定播放 mp4 / webm。mkv 主要给 M3U / VLC 用。

台标只叠在网页直播里，不烧进 M3U 流（避免 NAS 实时转码）。
