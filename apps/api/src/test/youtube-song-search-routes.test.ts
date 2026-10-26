import Fastify from "fastify";
import type { QueueEntry, Room } from "@home-ktv/domain";
import { describe, expect, it } from "vitest";
import type { QueueEntryRepository } from "../modules/playback/repositories/queue-entry-repository.js";
import type { RoomRepository } from "../modules/rooms/repositories/room-repository.js";
import { registerSongSearchRoutes } from "../routes/song-search.js";

const now = "2026-05-28T10:00:00.000Z";

describe("song search routes with YouTube supplement", () => {
  it("fills the online section from a stubbed YouTube search and leaves NAS untouched", async () => {
    const { server } = await createHarness({
      youtubeSearch: async () => [
        {
          videoId: "dQw4w9WgXcQ",
          title: "七里香 伴奏",
          channelTitle: "KTV Channel",
          durationMs: 241000,
          thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
          watchUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        }
      ]
    });

    const response = await server.inject({
      method: "GET",
      url: "/rooms/living-room/songs/search?q=%E4%B8%83%E9%87%8C%E9%A6%99"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.nas).toEqual({ status: "unavailable", message: "未找到 NAS 曲库结果", results: [] });
    expect(body.online.status).toBe("available");
    expect(body.online.candidates).toEqual([
      {
        provider: "youtube",
        providerCandidateId: "dQw4w9WgXcQ",
        title: "七里香 伴奏",
        artistName: "KTV Channel",
        sourceLabel: "YouTube",
        durationMs: 241000,
        candidateType: "karaoke",
        reliabilityLabel: "unknown",
        riskLabel: "normal",
        taskState: "discovered",
        taskId: null
      }
    ]);
  });

  it("reports available with no candidates when YouTube returns nothing", async () => {
    const { server } = await createHarness({ youtubeSearch: async () => [] });

    const response = await server.inject({
      method: "GET",
      url: "/rooms/living-room/songs/search?q=%E6%B2%A1%E6%9C%89%E7%9A%84%E6%AD%8C"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().online).toMatchObject({ status: "available", candidates: [] });
  });

  it("keeps NAS results and a 200 when the YouTube search throws", async () => {
    const { server } = await createHarness({
      youtubeSearch: async () => {
        throw new Error("yt-dlp timed out");
      }
    });

    const response = await server.inject({
      method: "GET",
      url: "/rooms/living-room/songs/search?q=%E4%B8%83%E9%87%8C%E9%A6%99"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.nas).toEqual({ status: "unavailable", message: "未找到 NAS 曲库结果", results: [] });
    expect(body.online.status).toBe("disabled");
    expect(body.online.candidates).toEqual([]);
  });

  it("stays disabled when YouTube is disabled, even with a search function", async () => {
    const { server } = await createHarness({
      youtubeEnabled: false,
      youtubeSearch: async () => [
        {
          videoId: "dQw4w9WgXcQ",
          title: "Song",
          channelTitle: "Chan",
          durationMs: null,
          thumbnailUrl: null,
          watchUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        }
      ]
    });

    const response = await server.inject({
      method: "GET",
      url: "/rooms/living-room/songs/search?q=test"
    });

    expect(response.json().online).toMatchObject({ status: "disabled", candidates: [] });
  });
});

async function createHarness(input: {
  youtubeSearch?: Parameters<typeof registerSongSearchRoutes>[1]["youtubeSearch"];
  youtubeEnabled?: boolean;
} = {}) {
  const server = Fastify();
  await registerSongSearchRoutes(server, {
    rooms: new FakeRoomRepository(createRoom()),
    queueEntries: new FakeQueueEntryRepository([]),
    youtubeEnabled: input.youtubeEnabled ?? true,
    ...(input.youtubeSearch ? { youtubeSearch: input.youtubeSearch } : {})
  });
  await server.ready();
  return { server };
}

class FakeRoomRepository implements RoomRepository {
  constructor(private readonly room: Room | null) {}

  async findById(roomId: string): Promise<Room | null> {
    return this.room?.id === roomId ? { ...this.room } : null;
  }

  async findBySlug(slug: string): Promise<Room | null> {
    return this.room?.slug === slug ? { ...this.room } : null;
  }
}

class FakeQueueEntryRepository implements QueueEntryRepository {
  constructor(private readonly queueEntries: readonly QueueEntry[]) {}

  async listEffectiveQueue(): Promise<QueueEntry[]> {
    return this.queueEntries.map((entry) => ({ ...entry }));
  }

  async findById(): Promise<QueueEntry | null> {
    return null;
  }

  async listUndoableRemoved(): Promise<QueueEntry[]> {
    return [];
  }

  async findCurrentForRoom(): Promise<QueueEntry | null> {
    return null;
  }

  async append(): Promise<never> {
    throw new Error("Not implemented");
  }

  async markRemoved(): Promise<QueueEntry | null> {
    return null;
  }

  async undoRemoved(): Promise<QueueEntry | null> {
    return null;
  }

  async renumberQueue(): Promise<QueueEntry[]> {
    return [];
  }

  async markCompleted(): Promise<QueueEntry | null> {
    return null;
  }
}

function createRoom(): Room {
  return {
    id: "living-room",
    slug: "living-room",
    name: "Living Room",
    status: "active",
    defaultPlayerDeviceId: null,
    createdAt: now,
    updatedAt: now
  };
}
