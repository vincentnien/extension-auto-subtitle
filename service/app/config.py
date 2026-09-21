import os
from pathlib import Path

# .env（與 app/ 同層）：KEY=VALUE 逐行，# 註解；存在即載入（不覆蓋已設定的環境變數）
_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"
if _ENV_FILE.exists():
    for _line in _ENV_FILE.read_text().splitlines():
        _line = _line.strip()
        if not _line or _line.startswith("#") or "=" not in _line:
            continue
        _k, _v = _line.split("=", 1)
        os.environ.setdefault(_k.strip(), _v.strip())

VERSION = "0.1.0"

DATA_DIR = Path(os.environ.get("SUBS_DATA_DIR", str(Path.home() / ".cache" / "bilingual-subs")))
AUDIO_DIR = DATA_DIR / "audio"
CUES_DIR = DATA_DIR / "cues"
DOCS_DIR = DATA_DIR / "docs"
AUDIO_MAX_GB = float(os.environ.get("SUBS_AUDIO_MAX_GB", "5"))

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
LLM_MODEL = os.environ.get("SUBS_LLM_MODEL", "gemini-flash-latest")
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")

STT_ENGINE = os.environ.get("SUBS_STT_ENGINE", "auto")  # auto | mlx | ct2 | groq
STT_MODEL = os.environ.get("SUBS_STT_MODEL", "")
YTDLP_EXTRA_ARGS = os.environ.get("SUBS_YTDLP_ARGS", "").split()

HOST = os.environ.get("SUBS_HOST", "127.0.0.1")
PORT = int(os.environ.get("SUBS_PORT", "8765"))
TOKEN = os.environ.get("SUBS_TOKEN", "")

TGT_PROMPT = {
    "zh-TW": "繁體中文（zh-TW）",
    "zh-CN": "簡體中文（zh-CN）",
    "zh": "中文",
    "ja": "日文",
    "ko": "韓文",
    "en": "English",
}


def tgt_prompt(tgt_lang: str) -> str:
    return TGT_PROMPT.get(tgt_lang, tgt_lang)