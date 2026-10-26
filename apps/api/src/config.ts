import { parseMediaPathMappings, type MediaPathMapping } from "./modules/assets/media-path-mapping.js";

export interface ApiConfig {
  corsAllowedOrigins: readonly string[];
  databaseUrl: string;
  controllerBaseUrl?: string;
  mediaPathMappings: readonly MediaPathMapping[];
  mediaRoot: string;
  onlineDemoReadyAssetId: string;
  onlineProviderIds: readonly string[];
  onlineProviderKillSwitchIds: readonly string[];
  publicBaseUrl: string;
  roomSlug: string;
  port: number;
  host: string;
  scanIntervalMinutes: number;
  youtubeEnabled: boolean;
  ytDlpPath: string;
  youtubeSearchLimit: number;
  youtubeStreamCacheMs: number;
  youtubeTimeoutMs: number;
}

export type ApiConfigInput = Omit<
  ApiConfig,
  | "mediaPathMappings"
  | "onlineDemoReadyAssetId"
  | "onlineProviderIds"
  | "onlineProviderKillSwitchIds"
  | "scanIntervalMinutes"
  | "youtubeEnabled"
  | "ytDlpPath"
  | "youtubeSearchLimit"
  | "youtubeStreamCacheMs"
  | "youtubeTimeoutMs"
> & {
  mediaPathMappings?: readonly MediaPathMapping[];
  onlineDemoReadyAssetId?: string;
  onlineProviderIds?: readonly string[];
  onlineProviderKillSwitchIds?: readonly string[];
  scanIntervalMinutes?: number;
  youtubeEnabled?: boolean;
  ytDlpPath?: string;
  youtubeSearchLimit?: number;
  youtubeStreamCacheMs?: number;
  youtubeTimeoutMs?: number;
};

const DEFAULT_ROOM_SLUG = "living-room";
const DEFAULT_PORT = 4000;
const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_SCAN_INTERVAL_MINUTES = 360;
const DEFAULT_YT_DLP_PATH = "yt-dlp";
const DEFAULT_YOUTUBE_SEARCH_LIMIT = 10;
const DEFAULT_YOUTUBE_STREAM_CACHE_MS = 600_000;
const DEFAULT_YOUTUBE_TIMEOUT_MS = 20_000;

function readString(value: string | undefined): string {
  return value?.trim() ?? "";
}

function readPort(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : DEFAULT_PORT;
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return {
    corsAllowedOrigins: readList(env.CORS_ALLOWED_ORIGINS),
    databaseUrl: readString(env.DATABASE_URL),
    controllerBaseUrl: readString(env.CONTROLLER_BASE_URL),
    mediaPathMappings: parseMediaPathMappings(env.MEDIA_PATH_MAPPINGS),
    mediaRoot: readString(env.MEDIA_ROOT),
    onlineDemoReadyAssetId: readString(env.ONLINE_DEMO_READY_ASSET_ID),
    onlineProviderIds: readList(env.ONLINE_PROVIDER_IDS),
    onlineProviderKillSwitchIds: readList(env.ONLINE_PROVIDER_KILL_SWITCH_IDS),
    publicBaseUrl: readString(env.PUBLIC_BASE_URL),
    roomSlug: readString(env.TV_ROOM_SLUG) || DEFAULT_ROOM_SLUG,
    port: readPort(env.PORT),
    host: readString(env.HOST) || DEFAULT_HOST,
    scanIntervalMinutes: readPositiveInteger(env.SCAN_INTERVAL_MINUTES, DEFAULT_SCAN_INTERVAL_MINUTES),
    youtubeEnabled: (env.YOUTUBE_ENABLED ?? "").trim().toLowerCase() !== "false",
    ytDlpPath: readString(env.YT_DLP_PATH) || DEFAULT_YT_DLP_PATH,
    youtubeSearchLimit: readPositiveInteger(env.YOUTUBE_SEARCH_LIMIT, DEFAULT_YOUTUBE_SEARCH_LIMIT),
    youtubeStreamCacheMs: readPositiveInteger(env.YOUTUBE_STREAM_CACHE_MS, DEFAULT_YOUTUBE_STREAM_CACHE_MS),
    youtubeTimeoutMs: readPositiveInteger(env.YOUTUBE_TIMEOUT_MS, DEFAULT_YOUTUBE_TIMEOUT_MS)
  };
}

export function normalizeApiConfig(config: ApiConfigInput): ApiConfig {
  return {
    ...config,
    mediaPathMappings: config.mediaPathMappings ?? [],
    onlineDemoReadyAssetId: config.onlineDemoReadyAssetId ?? "",
    onlineProviderIds: config.onlineProviderIds ?? [],
    onlineProviderKillSwitchIds: config.onlineProviderKillSwitchIds ?? [],
    scanIntervalMinutes: config.scanIntervalMinutes ?? DEFAULT_SCAN_INTERVAL_MINUTES,
    youtubeEnabled: config.youtubeEnabled ?? true,
    ytDlpPath: config.ytDlpPath ?? DEFAULT_YT_DLP_PATH,
    youtubeSearchLimit: config.youtubeSearchLimit ?? DEFAULT_YOUTUBE_SEARCH_LIMIT,
    youtubeStreamCacheMs: config.youtubeStreamCacheMs ?? DEFAULT_YOUTUBE_STREAM_CACHE_MS,
    youtubeTimeoutMs: config.youtubeTimeoutMs ?? DEFAULT_YOUTUBE_TIMEOUT_MS
  };
}
