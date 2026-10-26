import type { AssetId, SongSourceType } from "@home-ktv/domain";
import { inferVideoContentType } from "./content-type.js";
import type { MediaPathResolution, MediaPathResolver } from "../assets/media-path-resolver.js";
import type { PlayableMediaLookup, PlayableMediaRepository } from "./playable-media-repository.js";

export type MediaGatewayResolution =
  | {
      ok: true;
      sourceType: SongSourceType;
      assetId: AssetId;
      filePath: string;
      contentLength: number;
      contentType: string;
    }
  | {
      ok: true;
      redirect: true;
      sourceType: SongSourceType;
      assetId: AssetId;
      redirectUrl: string;
    }
  | {
      ok: false;
      statusCode: 404 | 409 | 500 | 501 | 503;
      code:
        | "MEDIA_SOURCE_NOT_FOUND"
        | "MEDIA_SOURCE_NOT_READY"
        | "MEDIA_ROOT_NOT_CONFIGURED"
        | "MEDIA_PATH_REJECTED"
        | "MEDIA_FILE_NOT_FOUND"
        | "ONLINE_PLAYBACK_NOT_IMPLEMENTED"
        | "YOUTUBE_STREAM_UNAVAILABLE";
    };

export type YouTubeStreamResolver = (videoId: string) => Promise<string | null>;

export interface MediaGatewayOptions {
  playableMedia: PlayableMediaRepository;
  mediaPathResolver: MediaPathResolver;
  publicBaseUrl: string;
  youtubeStreamResolver?: YouTubeStreamResolver;
}

export class MediaGateway {
  constructor(private readonly options: MediaGatewayOptions) {}

  createPlaybackUrl(source: PlayableMediaLookup): string {
    const path = `/media/${encodeURIComponent(source.sourceType)}/${encodeURIComponent(source.assetId)}`;
    const baseUrl = this.options.publicBaseUrl.trim().replace(/\/$/, "");
    return baseUrl ? `${baseUrl}${path}` : path;
  }

  async resolveForStreaming(source: PlayableMediaLookup): Promise<MediaGatewayResolution> {
    if (source.sourceType === "online") {
      return this.resolveOnlineForStreaming(source);
    }

    const asset = await this.options.playableMedia.findPlayableBySource(source);
    if (!asset) {
      return { ok: false, statusCode: 404, code: "MEDIA_SOURCE_NOT_FOUND" };
    }

    if (asset.status !== "ready") {
      return { ok: false, statusCode: 409, code: "MEDIA_SOURCE_NOT_READY" };
    }

    const resolved = await this.options.mediaPathResolver.resolveAssetFile(asset.filePath);
    if (!resolved.ok) {
      return this.mapPathResolutionFailure(resolved);
    }

    return {
      ok: true,
      sourceType: asset.sourceType,
      assetId: asset.assetId,
      filePath: resolved.filePath,
      contentLength: resolved.sizeBytes,
      contentType: inferVideoContentType(asset.filePath)
    };
  }

  private async resolveOnlineForStreaming(source: PlayableMediaLookup): Promise<MediaGatewayResolution> {
    // Only the YouTube supplement is implemented for online playback.
    // Every other online assetId keeps the historical 501 behaviour.
    const prefix = "youtube:";
    if (!source.assetId.startsWith(prefix)) {
      return { ok: false, statusCode: 501, code: "ONLINE_PLAYBACK_NOT_IMPLEMENTED" };
    }
    const videoId = source.assetId.slice(prefix.length);
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
      return { ok: false, statusCode: 404, code: "MEDIA_SOURCE_NOT_FOUND" };
    }
    if (!this.options.youtubeStreamResolver) {
      return { ok: false, statusCode: 501, code: "ONLINE_PLAYBACK_NOT_IMPLEMENTED" };
    }
    const redirectUrl = await this.options.youtubeStreamResolver(videoId);
    if (!redirectUrl) {
      return { ok: false, statusCode: 503, code: "YOUTUBE_STREAM_UNAVAILABLE" };
    }
    return {
      ok: true,
      redirect: true,
      sourceType: "online",
      assetId: source.assetId,
      redirectUrl
    };
  }

  private mapPathResolutionFailure(resolved: Extract<MediaPathResolution, { ok: false }>): MediaGatewayResolution {
    switch (resolved.reason) {
      case "media-root-not-configured":
        return { ok: false, statusCode: 503, code: "MEDIA_ROOT_NOT_CONFIGURED" };
      case "path-outside-media-root":
        return { ok: false, statusCode: 500, code: "MEDIA_PATH_REJECTED" };
      case "file-not-found":
      case "not-a-file":
        return { ok: false, statusCode: 404, code: "MEDIA_FILE_NOT_FOUND" };
    }
  }
}
