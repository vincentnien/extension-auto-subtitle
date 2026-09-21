# Bilingual Subs — 設計文件 v1.1

日期：2026-09-18 ｜ 狀態：定案（v1.1：同日 review 修訂） ｜ 前置研究：`../spike/FINDINGS.md`

## 0. 設計原則

1. **Extension 極薄**：MV3 是最受限、最難 debug 的環境（SW 生命週期、world 隔離、CORS）。
   只放 capture（抓字幕）+ render（顯示）；一切「文件智能」在 companion service。
2. **一個核心抽象**：全系統只有一種資料產物流動——`BilingualDoc`。
   所有來源進來先正規化；所有下游（快取/同步/渲染）只認它。
3. **Cache-first & 冪等**：每一層都有快取；job 以 videoId 冪等；重看 = 0 等待 0 成本。
4. **逐行降級**：任何故障都收斂到可顯示狀態（全雙語 → 部分雙語 → 純原文 → 清楚的錯誤提示）。
   永不空白、永不錯位。
5. **引擎皆可換**：STT / LLM 都在介面後面。硬體（MLX/CT2/Groq）與模型（Gemini/OpenAI）是設定，不是架構。

## 1. 核心資料模型

```jsonc
// BilingualDoc —— 唯一的資料產物
{
  "v": 1,
  "videoId": "VUtmIghyzOs",
  "srcLang": "ja",              // 來源語言（auto 偵測後落定）
  "tgtLang": "zh-TW",
  "cues": [
    {
      "id": 42,                 // 全文件唯一、穩定（對齊合約的錨點）
      "start": 130.2, "end": 134.8,   // 秒，排序且正規化（重疊已合併）
      "text": "直腸がんと診断されます",   // 原文
      "trans": "會診斷為直腸癌",          // null = 待翻 / 翻譯失敗（單行降級）
      "src": "stt"                       // "native" | "auto" | "stt"
    }
  ],
  "meta": { "sttModel": "large-v3-turbo", "llm": "gemini-flash", "createdAt": "..." }
}
```

規則：
- 來源優先序：**人工字幕 > auto 軌（YouTube ASR）> companion STT**。auto 軌免下載音訊、免 STT，
  是最便宜路徑（僅差翻譯）；STT 只在前兩者皆無時啟動。
- `id → trans` 是翻譯對齊合約。**不是位置對齊**——LLM 漏譯第 42 行只影響該行。
- cue 正規化：按 start 排序；重疊合併（native asr 的 rolling windows）；空行/純符號行保留但可標記。
- `v` 欄位為 schema 版本，跨版本讀取需遷移或重取。

## 2. 系統邊界與程序

```
┌─ Chrome Extension（薄）──────────────┐         ┌─ Companion（Mac 本機, 127.0.0.1:8765）────────┐
│ bridge.main.js (MAIN world)          │         │                                               │
│   getPlayerResponse() → tracks       │         │  HTTP API（見 §4）                             │
│   同源 fetch timedtext json3         │         │                                               │
│   json3 → cues ──┐                   │  HTTP   │  pipeline（純函式 DAG，每階段可快取）：        │
│                  ▼                   │ ──────> │   resolve → fetch-audio(yt-dlp)               │
│ content.js (ISOLATED)                │         │     → STT(engine 介面) → normalize(合併/VAD)  │
│   SourceResolver：                   │         │     → translate(LLM, id-keyed)                │
│     1) 人工字幕  2) auto 軌(YT ASR)  │         │     → assemble → BilingualDoc                 │
│     3) 否則 → companion jobs (STT)   │         │                                               │
│   renderer：rAF + 二分查找 + overlay │         │  引擎介面：                                    │
│   IDB 快取：BilingualDoc             │         │   STT = mlx-whisper | faster-whisper | groq   │
│                                      │         │   LLM = gemini | openai | deepl               │
│ background.js：薄代理（fetch localhost│ <────── │  磁碟快取：audio LRU + (videoId,model) cues    │
│   需 host_permissions；無狀態）       │  SSE    │  MCP wrapper：同一 pipeline 包薄皮             │
└──────────────────────────────────────┘         └───────────────────────────────────────────────┘
```

跨界通訊全部同款協定：版本化 JSON（`type` + `payload`；MAIN↔ISOLATED 用 `window.postMessage`、
ISOLATED↔background 用 `chrome.runtime`、extension↔companion 用 REST + SSE）。

> **簡化選項**：companion 回 `Access-Control-Allow-Origin: https://www.youtube.com`，MAIN world 即可
> 直連 localhost（fetch 與 SSE 皆可），整層 background 代理可移除，少一個 SW 生命週期 moving part。
> 代價：companion 綁定 origin。v1 先保留代理（標準、好 debug）；若 SW 成為痛點再切換。

## 3. 各模組職責（單一責任）

| 模組 | 程序 | 職責 | 關鍵細節 |
|---|---|---|---|
| `bridge.main.js` | MAIN | capture | `movie_player.getPlayerResponse()`（spike 驗證的第一層）→ `yt-navigate-finish` 重抓 → timedtext 同源 fetch → json3 攤平 |
| `content.js` | ISOLATED | 編排 + 渲染 | SourceResolver 決定來源（人工→auto→STT）；rAF 讀 `currentTime` + 二分查找；seek 重算；`.ad-showing` 隱藏；overlay 掛載/重掛見 §3.1 |
| `background.js` | SW | 代理 | 轉發 content ↔ companion；無狀態、可死可生；host_permissions: `http://localhost:8765/*`（可選：companion 開 CORS 後整層移除，見 §2） |
| `pipeline.py` | companion | 編排 | DAG 各階段冪等、每段獨立快取鍵 |
| `normalize.py` | companion | 正規化 | json3/SRT/whisper → cues；重疊合併；排序；VAD 自然斷句（解決 5 秒硬切坑） |
| `stt.py` | companion | 引擎介面 | `transcribe(audio, lang?) -> AsyncIterable[Cue]`；mlx（Mac GPU）/ ct2（CPU fallback）/ groq（雲端）自動偵測 |
| `translate.py` | companion | LLM | id-keyed prompt（§5）；chunk 按字元預算切、id 全域連續；缺行帶前後文補翻 |
| `cache.py` | companion | 快取 | 磁碟 LRU；key=(videoId, model)；audio 可選保留 |
| `mcp_server.py` | companion | MCP 皮 | 包 pipeline，供 MyAgent/agent 直接呼叫 |

### 3.1 Renderer：字幕怎麼掛上畫面（content.js 內）

**掛載與生命週期**
- overlay：absolute、鋪滿 player、`pointer-events: none` 的 div，掛在 `.html5-video-player`
  （player root）內 → 位於全螢幕元素內，全螢幕/劇院模式/迷你播放器免特別處理。
- **Shadow DOM（open）隔離樣式**：YouTube 的 CSS 不滲入、overlay 樣式不外洩；z-index 高於 video，
  `pointer-events: none` 不擋控制列點擊。
- **重掛**：SPA 導航/廣告/畫質切換會重建 player DOM → MutationObserver 偵測 overlay 被移除或
  player root 重建即重掛；video element 不快取引用，每幀從 player root 當場查詢。
- **縮放**：ResizeObserver 依 video 高度設 CSS 變數（字級 = 影片高的固定百分比），行為像原生字幕。

**時間迴圈**
- rAF 每幀讀 `currentTime` → 排序 cues 二分查找 → **僅在 active cue id 改變時寫 DOM**。
- 不用 `timeupdate`（~4Hz，倍速下會飄）；rAF + currentTime 免疫倍速，seek 走同一查找路徑自動正確。

**雙語版面**
- 譯文主行（大、亮）+ 原文副行（小、淡）；`trans === null` → 只顯示原文（單行降級）。
- 底部置中、max-width 90%、自動換行；半透明底框或 text-shadow 保可讀性。
- `.ad-showing` → overlay 隱藏；與 YT 原生 CC 重疊 → 自動上移偏移（options 可設提示關閉原生 CC）。

> 不採用「注入 YT 原生 caption track」：原生渲染不支援雙語兩行樣式，且注入點更脆弱。

## 4. HTTP API v1

```
POST /v1/jobs   {url|video_id, tgt_lang="zh-TW", src_lang?="auto", stt_model?="auto"}
                → 202 {job_id, status:"queued", cache:"hit"|"miss"}   # cache hit 直接帶 doc
GET  /v1/jobs/{id}          → {status, stage, progress 0..1, doc?}    # 輪詢路徑
GET  /v1/jobs/{id}/events   → SSE：progress | partial-doc | done | error
GET  /v1/docs/{videoId}?tgt=zh-TW → 200 doc | 404                     # 快取快路徑
DELETE /v1/docs/{videoId}                                             # 快取管理（可選）
GET  /health                → {engines:{mlx:"ok"}, models:[...], version}
```

- 全部綁 127.0.0.1；可選 shared token（`Authorization: Bearer`）。
- **SSE partial-doc**：STT 邊轉邊推 cue，extension 即時顯示（trans 先為 null，譯完一版再整批回填）。
- **Job 冪等 + supersede**：同 (videoId, tgtLang) 重複 POST 回同一 job；SPA 快速切片時，新導航 supersede
  未完成的舊 job（取消或降為低優先），SSE 只推「當前影片」的事件，避免成本浪費與事件錯亂。
- **Job 狀態落盤**：狀態機持久化到磁碟；companion 重啟後未完成 job 標記 `stale`，客端重送即可恢復（快取使重跑便宜）。

## 5. 翻譯合約（穩健性的核心）

```
輸入 chunk：{"1": "...", "2": "...", ...}（id 全域連續；chunk 前帶前 2 行 context，標明勿翻）
要求：同 key 回傳 JSON；專有名詞一致；來源可能含 STT 同音錯字 → 依文脈校正後翻
驗證：key 集合相等 → 完成
     缺行 → 僅對缺行帶前後文重試（≤2 次）
     仍缺 → 該行 trans=null（單行降級），絕不位移其他行
```

## 6. 快取層（三層，各有主子）

| 層 | 位置 | key | 效果 |
|---|---|---|---|
| L1 | extension IDB | (videoId, tgtLang, docVersion) | 重看瞬開、離線可用 |
| L2 | companion 磁碟 | (videoId, sttModel) | 換目標語言不用重轉寫 |
| L3 | companion（併入 L2 實作） | translation per (doc, tgtLang, llm) | 換 STT 模型不用重翻譯 |

## 7. 故障模式 → 對策（總表）

| 故障 | 對策 | 降級結果 |
|---|---|---|
| timedtext 簽名拒絕（200+0B） | 頁面 context 立即 fetch（已驗證）；失敗 → companion | 走 STT 路線 |
| `getPlayerResponse()` 拿不到 | 輪詢等待 → ytInitialPlayerResponse → innertube | 明確錯誤提示 |
| companion 未啟動 | extension 顯示狀態；native 片照常單語顯示 | 純原文 |
| LLM 429/配額 | 指數退避；IDB 內已有部分 → 顯示已譯行 | 部分雙語 |
| LLM 行數飄移 | §5 合約驗證 | 單行降級 |
| STT 同音錯字 | large-v3-turbo + 校正 prompt | 品質最佳化 |
| 音樂/靜音幻覺 | VAD + 標記行降樣式 | 視覺降噪 |
| 廣告/seek/倍速/全螢幕 | currentTime 天然免疫倍速；seek 重算；ad 隱藏；容器鏈 | 體驗穩定 |
| SW 死亡 | 無狀態代理；SSE 斷線時客端先輪詢 `GET /v1/jobs/{id}`，job 還在跑就自動重連（≤5 次），真死了才報錯 | 自動恢復 |
| STT 模型冷啟動（首次載入/下載數百 MB～GB） | 模型載入必須在工作執行緒（不可阻塞 event loop，否則 SSE keepalive 停發 → SW 被殺 →「連線中斷」）；轉寫以 `seg.end/duration` 回報 % | 進度可見、連線不斷 |
| 下載/轉寫無進度 | yt-dlp 加 `--newline` 逐行解析 %；ct2 逐段回報 %；SSE 重連時先補發目前 stage | UI 不再卡 0% |
| 重複 job 請求 | job 冪等（同 videoId 回同一 job/doc）；error/cancelled job 重送 = 重跑（重試按鈕有效） | 無重複成本 |
| yt-dlp PO token / bot 偵測 / throttle | auto 軌優先可繞過音訊下載；`--socket-timeout 30`；失敗 → 明確錯誤 + 「更新 yt-dlp」提示 | 清楚錯誤提示 |
| Live / 無音訊片 | 進 job 前偵測，明確拒絕（v1 不支援清單）；Shorts 已支援（實測 STT 可跑完） | 清楚錯誤提示 |
| Companion 重啟 | job 狀態落盤；stale job 由客端重送恢復 | 自動恢復 |

## 8. 模組配置

```
subs-service/                 # companion（Python, FastAPI）
  app/
    main.py                   # 路由 + 啟動
    jobs.py                   # job queue、狀態機、SSE
    pipeline.py               # resolve→audio→stt→normalize→translate→assemble
    normalize.py
    engines/stt.py            # mlx | ct2 | groq
    engines/llm.py            # gemini | openai
    cache.py
    mcp_server.py             # 薄 MCP 皮
  tests/                      # golden fixtures（spike 的真實 json3/whisper 樣本）

bilingual-subs/               # extension（薄）
  manifest.json
  src/bridge.main.js          # MAIN world capture
  src/proxy.js                # background 代理的客端 helper
  src/store.js                # 單一 store（doc/status/activeId）+ 設定（unidirectional）
  src/doc.js                  # 正規化（排序/合併/gap-fill）+ SRT 匯出
  src/idb.js                  # L1 持久快取（IDB）
  src/translate.js            # Gemini id-keyed 翻譯 + 退避重試
  src/overlay.js              # 播放器字幕 + 狀態膠囊（含動作按鈕）
  src/panel.js                # 側欄字幕列表（高亮/點擊跳轉/進度/匯出）
  src/content.js              # 編排：訊息、快取、翻譯、STT client（SSE port）
  src/background.js           # 薄代理 + SSE stream 轉發
  options.html                # key、模型、軌道語言、companion URL
```

## 9. 測試策略

- **單元**：normalize（用 spike 真實 json3 + whisper 樣本做 golden test）；translate 合約（mock LLM：正常/缺行/多行/壞 JSON）
- **整合**：pipeline 端到端（本機小音檔）；job 狀態機（重複請求、取消、SSE）
- **手動**：extension 端 YouTube 實測清單（長片、asr 軌、無字幕片、全螢幕、廣告、倍速、SPA 連續切換）

## 10. 實施階段（每階段可獨立驗收）

| 階段 | 內容 | 驗收 |
|---|---|---|
| P1 | normalize + STT 引擎介面 + ct2 路徑 + CLI | 對 spike 樣本產出正規化 cues；斷句自然 |
| P2 | translate 引擎 + §5 合約 + assemble | 樣本文件缺行演練全過 |
| P3 | FastAPI jobs + SSE + 快取；extension 薄客戶端 + renderer | 端到端：丟 URL → 影片內看到雙語 |
| P4 | mlx 引擎（Mac）、MCP 皮、options 頁、打磨 | M5 上 20 分片 ≤ 5 分全雙語；MyAgent 可呼叫 |
```
