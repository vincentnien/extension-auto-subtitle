"""薄 MCP 皮：包 pipeline，供 MyAgent/agent 直接呼叫。

執行：pip install "mcp" 後 python -m app.mcp_server
"""

from . import pipeline


def main() -> None:
    try:
        from mcp.server.fastmcp import FastMCP
    except ImportError:
        raise SystemExit("需要 mcp 套件：pip install 'mcp'")

    mcp = FastMCP("bilingual-subs")

    @mcp.tool()
    async def get_bilingual_subtitles(url: str, tgt_lang: str = "zh-TW") -> dict:
        """下載音訊、語音轉寫並翻譯 YouTube 影片，回傳雙語字幕文件（BilingualDoc）。

        回傳格式：{videoId, srcLang, tgtLang, cues: [{id, start, end, text, trans}], meta}
        有磁碟快取：重看同一部影片 0 成本。
        """
        return await pipeline.run_url(url, tgt_lang)

    mcp.run()


if __name__ == "__main__":
    main()