import Fastify from "fastify";
import type { PlayableMediaRepository } from "../modules/media/playable-media-repository.js";
import { MediaPathResolver } from "../modules/assets/media-path-resolver.js";
import { MediaGateway } from "../modules/media/media-gateway.js";
import { registerMediaRoutes } from "../routes/media.js";
import { describe, expect, it } from "vitest";

describe("YouTube media gateway redirect", () => {
  it("302-redirects /media/online/youtube:<videoId> to the resolved stream URL", async () => {
    const server = Fastify();
    const mediaGateway = new MediaGateway({
      playableMedia: { findPlayableBySource: async () => null } as PlayableMediaRepository,
      mediaPathResolver: new MediaPathResolver({ mediaRoot: "/does-not-matter" }),
      publicBaseUrl: "",
      youtubeStreamResolver: async (videoId) =>
        videoId === "dQw4w9WgXcQ" ? "https://example.test/stream" : null
    });
    await registerMediaRoutes(server, { mediaGateway });

    const response = await server.inject({ method: "GET", url: "/media/online/youtube:dQw4w9WgXcQ" });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("https://example.test/stream");
  });

  it("keeps 501 for other online assetIds", async () => {
    const server = Fastify();
    const mediaGateway = new MediaGateway({
      playableMedia: { findPlayableBySource: async () => null } as PlayableMediaRepository,
      mediaPathResolver: new MediaPathResolver({ mediaRoot: "/does-not-matter" }),
      publicBaseUrl: "",
      youtubeStreamResolver: async () => "https://example.test/stream"
    });
    await registerMediaRoutes(server, { mediaGateway });

    const response = await server.inject({ method: "GET", url: "/media/online/some-other-asset" });
    expect(response.statusCode).toBe(501);
    expect(response.json()).toEqual({ error: "ONLINE_PLAYBACK_NOT_IMPLEMENTED" });
  });

  it("rejects an invalid YouTube videoId", async () => {
    const server = Fastify();
    const mediaGateway = new MediaGateway({
      playableMedia: { findPlayableBySource: async () => null } as PlayableMediaRepository,
      mediaPathResolver: new MediaPathResolver({ mediaRoot: "/does-not-matter" }),
      publicBaseUrl: "",
      youtubeStreamResolver: async () => "https://example.test/stream"
    });
    await registerMediaRoutes(server, { mediaGateway });

    const response = await server.inject({ method: "GET", url: "/media/online/youtube:bad;id" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "MEDIA_SOURCE_NOT_FOUND" });
  });

  it("returns 503 when stream resolution fails", async () => {
    const server = Fastify();
    const mediaGateway = new MediaGateway({
      playableMedia: { findPlayableBySource: async () => null } as PlayableMediaRepository,
      mediaPathResolver: new MediaPathResolver({ mediaRoot: "/does-not-matter" }),
      publicBaseUrl: "",
      youtubeStreamResolver: async () => null
    });
    await registerMediaRoutes(server, { mediaGateway });

    const response = await server.inject({ method: "GET", url: "/media/online/youtube:dQw4w9WgXcQ" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "YOUTUBE_STREAM_UNAVAILABLE" });
  });
});
