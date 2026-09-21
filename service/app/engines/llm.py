"""LLM 翻譯引擎 — id-keyed 合約（與 extension §5 同款）：缺行重試、仍缺則 null、絕不位移。"""

import asyncio
import json

import httpx

from .. import config

CHUNK_LINES = 40
CHUNK_CHARS = 3800
CONCURRENCY = 3


def _sys(tgt: str) -> str:
    return f"""你是影片字幕翻譯器，把輸入 JSON 的每個 value 翻成{tgt}。
規則：
1) 只翻 value，key 原樣保留；回傳單一 JSON 物件 {{"id":"譯文"}}，key 集合必須與輸入完全一致。
2) 專有名詞前後一致；口語自然、簡潔，像字幕。
3) 原文可能含語音辨識錯字，依上下文校正後再翻。
4) 不可合併、拆分或增刪行。"""


def parse_id_map(text: str, want_ids) -> dict:
    m = None
    try:
        m = json.loads(text)
    except Exception:
        s, e = text.find("{"), text.rfind("}")
        if s >= 0 and e > s:
            try:
                m = json.loads(text[s : e + 1])
            except Exception:
                m = None
    if not isinstance(m, dict):
        return {}
    out = {}
    for i in want_ids:
        v = m.get(str(i), m.get(i))
        if isinstance(v, str) and v.strip():
            out[i] = v.strip()
    return out


async def _call_llm(items: dict, context: list[str], tgt: str) -> dict:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{config.LLM_MODEL}:generateContent"
    pre = f"（前文僅供理解，勿翻譯：{' / '.join(context)}）\n" if context else ""
    payload = {
        "systemInstruction": {"parts": [{"text": _sys(tgt)}]},
        "contents": [{"role": "user", "parts": [{"text": pre + json.dumps(items, ensure_ascii=False)}]}],
        "generationConfig": {"temperature": 0.2, "responseMimeType": "application/json"},
    }
    headers = {"Content-Type": "application/json"}
    if config.GEMINI_API_KEY:
        url += f"?key={config.GEMINI_API_KEY}"
    async with httpx.AsyncClient(timeout=60) as client:
        for n in range(4):
            r = await client.post(url, json=payload, headers=headers)
            if r.status_code < 300:
                parts = r.json()["candidates"][0]["content"]["parts"]
                return parse_id_map("".join(p.get("text", "") for p in parts), items.keys())
            if r.status_code in (429, 500, 503) and n < 3:
                await asyncio.sleep(3 * 2**n)
                continue
            raise RuntimeError(f"Gemini HTTP {r.status_code}: {r.text[:120]}")
    raise RuntimeError("Gemini 重試次數用盡")


def build_chunks(cues: list[dict]) -> list[list[dict]]:
    chunks, cur, chars = [], [], 0
    for c in cues:
        if len(cur) >= CHUNK_LINES or (cur and chars + len(c["text"]) > CHUNK_CHARS):
            chunks.append(cur)
            cur, chars = [], 0
        cur.append(c)
        chars += len(c["text"])
    if cur:
        chunks.append(cur)
    return chunks


async def translate_cues(cues: list[dict], tgt_lang: str, on_progress=None, translate_fn=None) -> None:
    tgt = config.tgt_prompt(tgt_lang)
    translate_fn = translate_fn or _call_llm
    chunks = build_chunks(cues)
    total = max(1, len(cues))
    done = 0
    sem = asyncio.Semaphore(CONCURRENCY)

    async def run_chunk(chunk: list[dict]) -> None:
        nonlocal done
        async with sem:
            first_id = chunk[0]["id"]
            ctx = [c["text"] for c in cues[max(0, first_id - 2) : first_id]]
            m = await translate_fn({c["id"]: c["text"] for c in chunk}, ctx, tgt)
            missing = [c for c in chunk if c["id"] not in m]
            for _ in range(2):
                if not missing:
                    break
                m2 = await translate_fn({c["id"]: c["text"] for c in missing}, ctx, tgt)
                m.update(m2)
                missing = [c for c in chunk if c["id"] not in m]
            for c in chunk:
                if c["id"] in m:
                    c["trans"] = m[c["id"]]
            done += len(chunk)
            if on_progress:
                on_progress(done / total)

    await asyncio.gather(*(run_chunk(ch) for ch in chunks))