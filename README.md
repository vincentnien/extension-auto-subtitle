# extension-auto-subtitle

YouTube 雙語字幕系統：Chrome Extension（薄）+ 本機 Companion Service（STT / 翻譯 / MCP）。

## 結構

```
extension/   Chrome Extension（MV3）：抓字幕 → LLM 翻譯 → 播放器 overlay + 側欄列表
service/     Companion（Python/FastAPI）：yt-dlp → whisper STT → 翻譯 → SSE 串流
docs/        設計文件（DESIGN.md）
```

## 功能

- 原生字幕優先 → YouTube 自動字幕 → 無字幕時呼叫 companion 跑語音辨識
- id-keyed 翻譯合約：缺行單行降級、絕不位移；三層快取（IDB / 磁碟 cues / 磁碟 docs）
- 側欄字幕列表：高亮跟隨、點擊跳轉、逐句重播、TTS 朗讀、顯示模式（雙語/原文/譯文）
- 配音模式：瀏覽器 TTS 朗讀譯文 + 原音壓低
- 匯出雙語 SRT；MCP wrapper 供 agent 呼叫

## 快速開始

**Extension**：`chrome://extensions` → 開發人員模式 → 載入未封裝 → 選 `extension/` → 選項頁填 Gemini API key

**Companion**：

```bash
cd service
pip install -r requirements.txt
pip install mlx-whisper        # Mac GPU（或 faster-whisper）
export GEMINI_API_KEY=...      # 沒設 = STT-only 模式
python -m app.main             # 127.0.0.1:8765
```

詳細設計見 `docs/DESIGN.md`。