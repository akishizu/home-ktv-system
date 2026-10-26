# YouTube 補充曲庫（yt-dlp）

YouTube 是**補充**曲庫，不是主曲庫。NAS 曲庫保持不變、優先顯示；只有在
搜尋時，才會在 NAS 結果下方額外顯示一個「YouTube 補充」區段。

## 運作方式

- **搜尋**：手機控制端呼叫 `GET /rooms/:roomSlug/songs/search?q=...`。
  API 除了查 NAS 索引，還會用 yt-dlp 跑 `ytsearchN:<query>`（`--dump-json
  --no-playlist --skip-download`），把結果對應成 `online.candidates`。
  標題包含 `karaoke`、`伴奏`、`KTV` 或 `卡拉OK` 的候選會標為 `karaoke`，
  其餘標為 `mv`。
- **播放**：控制端「播放」按鈕開一個新分頁到
  `/media/online/youtube:<videoId>`。API 會在播放當下用 yt-dlp 解析
  直接串流連結（`-g`），再以 HTTP 302 導向該連結，瀏覽器／Web TV
  播放器就可以直接播。串流連結會過期，所以**不會**存入曲庫，播放時
  才即時解析；同一個 videoId 的解析結果只會在記憶體快取短時間，
  方便播放器重試。
- **失敗處理**：yt-dlp 失敗、逾時或未安裝時，搜尋不會變成 500，
  NAS 結果照常回傳，`online` 區段會顯示無法使用或無結果的訊息。
  串流解析失敗時，`/media/online/...` 會回 503
  `YOUTUBE_STREAM_UNAVAILABLE`。其他非 YouTube 的 online assetId
  保持原有的 501 `ONLINE_PLAYBACK_NOT_IMPLEMENTED`。

## 設定

yt-dlp 必須裝在**跑 API 的主機**上（不是跑瀏覽器的裝置）：

```bash
yt-dlp --version
```

**Docker 部署不用另外裝**：`deploy/docker/Dockerfile.api` 已經把
yt-dlp standalone binary（預設版本 `2026.10.21`，見 Dockerfile 入面的
`YT_DLP_VERSION`）打包入 API image，`yt-dlp` 會喺 `/usr/local/bin`
入面、預設 PATH 就搵到，所以 `YT_DLP_PATH` 不用改。日後 YouTube
改版令舊版失效時，可以用
`docker build --build-arg YT_DLP_VERSION=<新版>` 重新 build，或者
直接改 Dockerfile 入面的預設版本。

**源码部署要另外裝**：喺跑 API 嗰部主機自己裝 yt-dlp（standalone
binary、pip 或系統套件管理員皆可），裝完跑 `yt-dlp --version` 驗到
先算；如果唔喺 PATH，就喺 `.env` 填絕對路徑去 `YT_DLP_PATH`。

環境變數（見 `.env.example`）：

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `YOUTUBE_ENABLED` | `true` | 設為 `false` 即完全停用 YouTube 搜尋與播放，`online` 回到原本的停用狀態 |
| `YT_DLP_PATH` | `yt-dlp` | yt-dlp 執行檔路徑；若不在 PATH，填絕對路徑，例如 `~/.local/bin/yt-dlp`（注意：`~` 不會自動展開，請填完整路徑） |
| `YOUTUBE_SEARCH_LIMIT` | `10` | 每次搜尋最多回傳幾多個 YouTube 結果（上限 20） |
| `YOUTUBE_STREAM_CACHE_MS` | `600000` | 串流連結記憶體快取時間（毫秒，預設 10 分鐘） |
| `YOUTUBE_TIMEOUT_MS` | `20000` | 每次 yt-dlp 呼叫（搜尋或串流解析）的逾時（毫秒）；逾時只會令 YouTube 區段為空，不會拖垮 NAS 搜尋 |

查詢長度上限為 200 字元，videoId 必須符合 `^[A-Za-z0-9_-]{11}$`，
否則會被拒絕。yt-dlp 一律用 `execFile` + 參數陣列呼叫，不經 shell，
查詢內容無法注入 shell 指令。

## 誠實的限制

1. **yt-dlp 是非官方工具**：YouTube 一改版就可能失效，而且在某些
   主機／網路環境下存取非常慢甚至逾時。本專案預設逾時為 20 秒
   （可用 `YOUTUBE_TIMEOUT_MS` 調校），並且讓 YouTube 失敗時不拖垮
   NAS 搜尋，但無法保證 YouTube 搜尋永遠可用。
2. **沒有原唱／伴唱切換**：YouTube 影片通常只有原唱音軌，無法像
   NAS 的雙音軌 KTV 檔案那樣切換原唱／伴唱；卡拉 OK 影片的歌詞
   也是燒在畫面裡，不是獨立歌詞軌。
3. **房間佇列／Android TV libVLC 佇列整合未包括在這次改動**：
   YouTube 是經由 `/media/online` 導向播放，Web TV／瀏覽器播放器
   可以播，但完整點歌佇列（點歌、頂歌、切歌、房間狀態機）仍只
   支援 NAS，完整佇列整合是後續工作。
4. **串流連結會過期**：每次播放都要重新解析，舊連結不能收藏重用。
5. **版權與使用條款**：yt-dlp 下載／串流解析可能違反 YouTube
   使用條款；本功能只做串流導向、不下載、不快取影片檔案，
   但在公開或商業場合使用前請自行評估合規風險。
