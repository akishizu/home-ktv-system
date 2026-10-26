import type { FastifyInstance } from "fastify";
import type {
  OnlineCandidateCard,
  SongSearchIndexedResult,
  SongSearchNasResult,
  SongSearchOnlineResult,
  SongSearchResponse
} from "@home-ktv/domain";
import type { KtvIndexReadRepository } from "../modules/ktv-index/ktv-index-read-repository.js";
import type { QueueEntryRepository } from "../modules/playback/repositories/queue-entry-repository.js";
import type { RoomRepository } from "../modules/rooms/repositories/room-repository.js";
import {
  classifyYouTubeCandidate,
  type YouTubeSearchResult
} from "../modules/youtube/youtube-search.js";

export type YouTubeSearchFn = (input: {
  query: string;
  limit: number;
}) => Promise<YouTubeSearchResult[]>;

export interface SongSearchRouteDependencies {
  rooms: RoomRepository;
  queueEntries: QueueEntryRepository;
  ktvIndex?: Pick<KtvIndexReadRepository, "searchIndexedSongs">;
  /**
   * Injectable YouTube search. When absent, the online section keeps the
   * historical disabled behaviour, so existing callers and tests that do
   * not provide a search function are unaffected. In production, server.ts
   * supplies the real yt-dlp search when YOUTUBE_ENABLED is not "false".
   */
  youtubeSearch?: YouTubeSearchFn;
  youtubeEnabled?: boolean;
  youtubeSearchLimit?: number;
}

interface SongSearchQuery {
  q?: string;
  limit?: string | number;
}

export async function registerSongSearchRoutes(
  server: FastifyInstance,
  dependencies: SongSearchRouteDependencies
): Promise<void> {
  server.get<{ Params: { roomSlug: string }; Querystring: SongSearchQuery }>(
    "/rooms/:roomSlug/songs/search",
    async (request, reply) => {
      const room = await dependencies.rooms.findBySlug(request.params.roomSlug);
      if (!room) {
        await reply.code(404).send({ code: "ROOM_NOT_FOUND" });
        return;
      }

      const query = String(request.query.q ?? "");
      const rawLimit = request.query.limit;
      const parsedLimit =
        typeof rawLimit === "number" ? Math.trunc(rawLimit) : Number.parseInt(String(rawLimit ?? ""), 10);
      const limit = Math.min(50, Math.max(1, Number.isFinite(parsedLimit) ? parsedLimit : 30));
      const queue = await dependencies.queueEntries.listEffectiveQueue(room.id);
      const queuedNasAssetIds = queue
        .filter((entry) => (entry.source?.sourceType ?? "nas") === "nas")
        .map((entry) => entry.source?.assetId ?? entry.assetId);
      const indexedResults =
        (await dependencies.ktvIndex?.searchIndexedSongs({
          query,
          limit: Math.min(20, limit),
          versionsPerSong: 4,
          queuedIndexedAssetIds: queuedNasAssetIds,
          unreadableIndexedAssetIds: []
        })) ?? [];
      // YouTube is a supplement only: NAS results above are computed first
      // and are returned unchanged whatever happens below. A YouTube
      // failure must never turn the whole search into a 500.
      const online = await resolveOnlineSection({
        query,
        youtubeSearch: dependencies.youtubeSearch,
        youtubeEnabled: dependencies.youtubeEnabled,
        youtubeSearchLimit: dependencies.youtubeSearchLimit
      });
      const response: SongSearchResponse = {
        query,
        nas: {
          status: indexedResults.length > 0 ? "available" : "unavailable",
          message: indexedResults.length > 0 ? "找到 NAS 曲库结果" : "未找到 NAS 曲库结果",
          results: indexedResults.map(toNasSearchResult)
        },
        online
      };

      await reply.send(response);
    }
  );
}

const ONLINE_DISABLED: SongSearchOnlineResult = {
  status: "disabled",
  message: "暂不启用线上补歌",
  requestSupplement: {
    visible: false,
    label: "请求补歌"
  },
  candidates: []
};

async function resolveOnlineSection(input: {
  query: string;
  youtubeSearch?: YouTubeSearchFn | undefined;
  youtubeEnabled?: boolean | undefined;
  youtubeSearchLimit?: number | undefined;
}): Promise<SongSearchOnlineResult> {
  if (!input.query.trim() || input.youtubeEnabled === false || !input.youtubeSearch) {
    return ONLINE_DISABLED;
  }
  // Cap the query before it reaches yt-dlp, and cap the result count.
  const query = input.query.trim().slice(0, 200);
  const limit = Math.min(20, Math.max(1, Math.trunc(input.youtubeSearchLimit ?? 10) || 10));
  let results: YouTubeSearchResult[];
  try {
    results = await input.youtubeSearch({ query, limit });
  } catch {
    return {
      status: "disabled",
      message: "YouTube 搜尋暫時無法使用，請稍後再試",
      requestSupplement: {
        visible: false,
        label: "请求补歌"
      },
      candidates: []
    };
  }
  if (results.length === 0) {
    return {
      status: "available",
      message: "YouTube 未找到相關結果",
      requestSupplement: {
        visible: false,
        label: "请求补歌"
      },
      candidates: []
    };
  }
  return {
    status: "available",
    message: `找到 ${results.length} 個 YouTube 補充結果`,
    requestSupplement: {
      visible: false,
      label: "请求补歌"
    },
    candidates: results.map(toYouTubeCandidate)
  };
}

function toYouTubeCandidate(result: YouTubeSearchResult): OnlineCandidateCard {
  return {
    provider: "youtube",
    providerCandidateId: result.videoId,
    title: result.title,
    artistName: result.channelTitle,
    sourceLabel: "YouTube",
    durationMs: result.durationMs,
    candidateType: classifyYouTubeCandidate(result.title),
    reliabilityLabel: "unknown",
    riskLabel: "normal",
    taskState: "discovered",
    taskId: null
  };
}

function toNasSearchResult(record: SongSearchIndexedResult): SongSearchNasResult {
  return {
    songId: record.indexedSongId,
    title: record.title,
    artistName: record.artistName,
    ...(record.styleTags ? { styleTags: record.styleTags } : {}),
    category: record.category,
    sourceLabel: "NAS曲库",
    matchReason: record.matchReason,
    versions: record.versions.map((version) => ({
      assetId: version.indexedAssetId,
      displayName: version.displayName,
      sourceLabel: "NAS曲库",
      extension: version.extension,
      sizeBytes: version.sizeBytes,
      audioTrackCount: version.audioTrackCount,
      ...(version.styleTags ? { styleTags: version.styleTags } : {}),
      category: version.category,
      queueState: version.queueState,
      canQueue: version.canQueue,
      disabledLabel: version.disabledLabel
    }))
  };
}
