import { execFile } from "node:child_process";

export interface YouTubeSearchResult {
  videoId: string;
  title: string;
  channelTitle: string;
  durationMs: number | null;
  thumbnailUrl: string | null;
  watchUrl: string;
}

export interface YouTubeSearchOptions {
  ytDlpPath?: string;
  limit?: number;
  /**
   * How long to wait for yt-dlp before giving up. Default 20s: long enough
   * for a healthy host, short enough that a slow host does not hold up the
   * whole search response for a minute. A timeout never propagates to the
   * caller as a search failure for the whole request: the caller
   * (song-search route) still returns the NAS results.
   */
  timeoutMs?: number;
}

export const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export function isValidYouTubeVideoId(videoId: string): boolean {
  return YOUTUBE_VIDEO_ID_PATTERN.test(videoId);
}

export function youtubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

const KARAOKE_TITLE_PATTERN = /karaoke|伴奏|KTV|卡拉OK/i;

export function classifyYouTubeCandidate(title: string): "karaoke" | "mv" {
  return KARAOKE_TITLE_PATTERN.test(title) ? "karaoke" : "mv";
}

interface YtDlpSearchEntry {
  id?: unknown;
  title?: unknown;
  channel?: unknown;
  uploader?: unknown;
  duration?: unknown;
  thumbnail?: unknown;
  thumbnails?: unknown;
  webpage_url?: unknown;
}

/**
 * Pure mapping from yt-dlp --dump-json output (one JSON object per line)
 * to search results. Entries with a missing/invalid id or a missing/empty
 * title are skipped. This function never throws on malformed lines: it
 * skips them, so one bad line cannot poison a whole search response.
 */
export function parseYtDlpSearchOutput(stdout: string): YouTubeSearchResult[] {
  const results: YouTubeSearchResult[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let entry: YtDlpSearchEntry;
    try {
      entry = JSON.parse(trimmed) as YtDlpSearchEntry;
    } catch {
      continue;
    }
    const videoId = typeof entry.id === "string" ? entry.id : "";
    const title = typeof entry.title === "string" ? entry.title.trim() : "";
    if (!isValidYouTubeVideoId(videoId) || !title) {
      continue;
    }
    const channelTitle =
      (typeof entry.channel === "string" && entry.channel) ||
      (typeof entry.uploader === "string" && entry.uploader) ||
      "";
    const durationSeconds = typeof entry.duration === "number" ? entry.duration : null;
    const thumbnailUrl = pickThumbnail(entry) ?? youtubeThumbnailUrl(videoId);
    results.push({
      videoId,
      title,
      channelTitle,
      durationMs:
        durationSeconds !== null && Number.isFinite(durationSeconds) && durationSeconds >= 0
          ? Math.round(durationSeconds * 1000)
          : null,
      thumbnailUrl,
      watchUrl: youtubeWatchUrl(videoId)
    });
  }
  return results;
}

function pickThumbnail(entry: YtDlpSearchEntry): string | null {
  if (typeof entry.thumbnail === "string" && entry.thumbnail) {
    return entry.thumbnail;
  }
  if (Array.isArray(entry.thumbnails) && entry.thumbnails.length > 0) {
    const last = entry.thumbnails[entry.thumbnails.length - 1];
    if (last && typeof last === "object" && typeof (last as { url?: unknown }).url === "string") {
      return (last as { url: string }).url;
    }
  }
  return null;
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
 * Search YouTube via yt-dlp. Never throws: on any failure (yt-dlp missing,
 * timeout, YouTube blocking the request) it logs the error and returns [].
 * Callers must therefore never let a YouTube failure turn into a 500 for
 * the whole song search, and must never let it hide NAS results.
 *
 * Security: yt-dlp is invoked with execFile and an argument array, never
 * through a shell, so a crafted query cannot inject shell commands. The
 * query is also capped in length by the caller (see song-search route).
 */
export async function searchYouTube(
  query: string,
  options: YouTubeSearchOptions = {},
  run: ExecFileFn = defaultExecFile
): Promise<YouTubeSearchResult[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return [];
  }
  const limit = Math.min(20, Math.max(1, Math.trunc(options.limit ?? 10) || 10));
  const ytDlpPath = options.ytDlpPath?.trim() || "yt-dlp";
  try {
    const { stdout } = await run(
      ytDlpPath,
      [
        `ytsearch${limit}:${trimmedQuery}`,
        "--dump-json",
        "--no-playlist",
        "--skip-download",
        "--no-warnings",
        "--quiet"
      ],
      { timeout: options.timeoutMs ?? 20_000, maxBuffer: 10 * 1024 * 1024 }
    );
    return parseYtDlpSearchOutput(stdout).slice(0, limit);
  } catch (error) {
    console.error("[youtube] yt-dlp search failed", error instanceof Error ? error.message : error);
    return [];
  }
}
