import { spawn } from "node:child_process";

export function ffprobeDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "ffprobe",
      [
        "-v",
        "error",
        "-hide_banner",
        "-user_agent",
        "iTV/0.1",
        "-analyzeduration",
        "40000000",
        "-probesize",
        "40000000",
        "-show_entries",
        "format=duration:stream=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        url,
      ],
      { windowsHide: true },
    );
    let out = "";
    let err = "";
    proc.stdout.on("data", (chunk) => {
      out += chunk;
    });
    proc.stderr.on("data", (chunk) => {
      err += chunk;
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      const n = out
        .split(/\s+/)
        .map(Number)
        .filter((x) => Number.isFinite(x) && x > 0)
        .sort((a, b) => b - a)[0];
      if (n > 0) resolve(n);
      else reject(new Error(err.trim() || `ffprobe 失败 (${code})`));
    });
  });
}

export function hasFfmpeg(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("ffmpeg", ["-version"], { windowsHide: true });
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));
  });
}

export function spawnWebCompat(url: string, startSec: number) {
  const start = Math.max(0, Number.isFinite(startSec) ? startSec : 0);
  return spawn(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-user_agent",
      "iTV/0.1",
      "-reconnect",
      "1",
      "-reconnect_streamed",
      "1",
      "-reconnect_delay_max",
      "5",
      "-ss",
      start.toFixed(3),
      "-i",
      url,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-vf",
      "scale=w='min(960,iw)':h=-2",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-tune",
      "zerolatency",
      "-profile:v",
      "baseline",
      "-level",
      "3.1",
      "-pix_fmt",
      "yuv420p",
      "-g",
      "48",
      "-bf",
      "0",
      "-threads",
      "2",
      "-c:a",
      "aac",
      "-ac",
      "2",
      "-ar",
      "44100",
      "-b:a",
      "96k",
      "-f",
      "mp4",
      "-movflags",
      "frag_keyframe+empty_moov+default_base_moof",
      "pipe:1",
    ],
    { windowsHide: true },
  );
}
