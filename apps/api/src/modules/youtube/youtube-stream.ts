import { execFile } from "node:child_process";
import { isValidYouTubeVideoId, youtubeWatchUrl } from "./youtube-search.js";

export interface YouTubeStreamOptions {
  ytDlpPath?: string;
  cacheMs?: number;
  timeoutMs?: number;
}

interface CacheEntry {
  url: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export function clearYouTubeStreamCache(): void {
  cache.clear();
}

type ExecFileFn = (
  file: string,
  args: readonly string[],
  options: { timeout: number; maxBuffer: number }
) => Promise<{ stdout: string; stderr: string }>;

function defaultExecFile(
  file: string,
  args: readonly string[],
  options: { timeout: number; maxBuffer: number }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, [...args], { timeout: options.timeout, maxBuffer: options.maxBuffer }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
    });
  });
}

/**
 * Resolve a direct stream URL for a YouTube video via yt-dlp, at play time.
 * Stream URLs expire, so they are intentionally NOT stored in the song
 * library: callers resolve them on every play request and only cache them
 * briefly (default 10 minutes) to cover a player retrying the same video.
 *
 * Returns null for an invalid videoId or for any yt-dlp failure, instead
 * of throwing, so the media route can map the failure to a clean HTTP
 * error. yt-dlp is invoked with execFile and an argument array, never
 * through a shell, and the videoId is validated before it is used.
 */
export async function resolveYouTubeStreamUrl(
  videoId: string,
  options: YouTubeStreamOptions = {},
  run: ExecFileFn = defaultExecFile
): Promise<string | null> {
  if (!isValidYouTubeVideoId(videoId)) {
    return null;
  }
  const cacheMs = options.cacheMs ?? 600_000;
  const cached = cache.get(videoId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.url;
  }
  const ytDlpPath = options.ytDlpPath?.trim() || "yt-dlp";
  try {
    const { stdout } = await run(
      ytDlpPath,
      [
        "-g",
        "-f",
        "bv*[ext=mp4]+ba[ext=m4a]/bv*[ext=mp4]/b[ext=mp4]/b",
        "--no-playlist",
        "--no-warnings",
        "--quiet",
        youtubeWatchUrl(videoId)
      ],
      { timeout: options.timeoutMs ?? 20_000, maxBuffer: 1024 * 1024 }
    );
    // -g prints one URL per selected stream; for a combined format the
    // first line is the video URL. Players follow the redirect from the
    // media route, so returning the first URL is sufficient.
    const url = stdout
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("http://") || line.startsWith("https://"));
    if (!url) {
      return null;
    }
    cache.set(videoId, { url, expiresAt: Date.now() + cacheMs });
    return url;
  } catch (error) {
    console.error("[youtube] yt-dlp stream resolution failed", error instanceof Error ? error.message : error);
    return null;
  }
}
