import { describe, expect, it, vi } from "vitest";
import {
  classifyYouTubeCandidate,
  isValidYouTubeVideoId,
  parseYtDlpSearchOutput,
  searchYouTube,
  youtubeThumbnailUrl,
  youtubeWatchUrl
} from "../modules/youtube/youtube-search.js";
import {
  clearYouTubeStreamCache,
  resolveYouTubeStreamUrl
} from "../modules/youtube/youtube-stream.js";

describe("YouTube videoId validation", () => {
  it("accepts exactly 11 URL-safe characters", () => {
    expect(isValidYouTubeVideoId("dQw4w9WgXcQ")).toBe(true);
    expect(isValidYouTubeVideoId("abc-DEF_123")).toBe(true);
  });

  it("rejects short, long, and shell-metacharacter ids", () => {
    expect(isValidYouTubeVideoId("short")).toBe(false);
    expect(isValidYouTubeVideoId("dQw4w9WgXcQ1")).toBe(false);
    expect(isValidYouTubeVideoId("dQw4w9WgXc;")).toBe(false);
    expect(isValidYouTubeVideoId("dQw4w9WgXc$(id)")).toBe(false);
    expect(isValidYouTubeVideoId("")).toBe(false);
  });
});

describe("yt-dlp search JSON parsing", () => {
  it("maps entries and skips bad lines and bad entries", () => {
    const stdout = [
      JSON.stringify({
        id: "dQw4w9WgXcQ",
        title: "Test Song 伴奏",
        channel: "Test Channel",
        duration: 241.5,
        thumbnail: "https://example.test/thumb.jpg"
      }),
      "this is not json",
      JSON.stringify({ id: "short", title: "Nope" }),
      JSON.stringify({ id: "aBcDeFgHiJk", title: "   " }),
      JSON.stringify({
        id: "aBcDeFgHiJk",
        title: "Second Song",
        uploader: "Uploader Name",
        duration: null
      })
    ].join("\n");

    const results = parseYtDlpSearchOutput(stdout);
    expect(results).toEqual([
      {
        videoId: "dQw4w9WgXcQ",
        title: "Test Song 伴奏",
        channelTitle: "Test Channel",
        durationMs: 241500,
        thumbnailUrl: "https://example.test/thumb.jpg",
        watchUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
      },
      {
        videoId: "aBcDeFgHiJk",
        title: "Second Song",
        channelTitle: "Uploader Name",
        durationMs: null,
        thumbnailUrl: youtubeThumbnailUrl("aBcDeFgHiJk"),
        watchUrl: youtubeWatchUrl("aBcDeFgHiJk")
      }
    ]);
  });

  it("classifies karaoke titles", () => {
    expect(classifyYouTubeCandidate("周杰倫 七里香 伴奏")).toBe("karaoke");
    expect(classifyYouTubeCandidate("周杰倫 七里香 Karaoke")).toBe("karaoke");
    expect(classifyYouTubeCandidate("周杰倫 七里香 MV")).toBe("mv");
  });
});

describe("searchYouTube", () => {
  it("passes ytsearch and limit through execFile arguments, never a shell string", async () => {
    const run = vi.fn(async () => ({
      stdout: JSON.stringify({ id: "dQw4w9WgXcQ", title: "Song", channel: "Chan", duration: 60 }),
      stderr: ""
    }));
    const results = await searchYouTube("七里香", { limit: 5 }, run as never);
    expect(results).toHaveLength(1);
    const [file, args] = run.mock.calls[0] as unknown as [string, readonly string[]];
    expect(file).toBe("yt-dlp");
    expect(args[0]).toBe("ytsearch5:七里香");
    expect(args).toContain("--dump-json");
    expect(args).toContain("--skip-download");
  });

  it("returns [] instead of throwing when yt-dlp fails", async () => {
    const run = vi.fn(async () => {
      throw new Error("yt-dlp not found");
    });
    const results = await searchYouTube("七里香", {}, run as never);
    expect(results).toEqual([]);
  });

  it("returns [] for an empty query without invoking yt-dlp", async () => {
    const run = vi.fn(async () => ({ stdout: "", stderr: "" }));
    expect(await searchYouTube("   ", {}, run as never)).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("resolveYouTubeStreamUrl", () => {
  it("rejects an invalid videoId without invoking yt-dlp", async () => {
    const run = vi.fn(async () => ({ stdout: "https://example.test/stream", stderr: "" }));
    expect(await resolveYouTubeStreamUrl("bad;id", {}, run as never)).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it("returns the first stream URL and caches it briefly", async () => {
    clearYouTubeStreamCache();
    const run = vi.fn(async () => ({ stdout: "https://example.test/stream\n", stderr: "" }));
    expect(await resolveYouTubeStreamUrl("dQw4w9WgXcQ", {}, run as never)).toBe(
      "https://example.test/stream"
    );
    expect(await resolveYouTubeStreamUrl("dQw4w9WgXcQ", {}, run as never)).toBe(
      "https://example.test/stream"
    );
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("returns null when yt-dlp fails", async () => {
    clearYouTubeStreamCache();
    const run = vi.fn(async () => {
      throw new Error("timeout");
    });
    expect(await resolveYouTubeStreamUrl("aBcDeFgHiJk", {}, run as never)).toBeNull();
  });
});
