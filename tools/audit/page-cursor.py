#!/usr/bin/env python3
"""讀 list_events 落檔的那一頁，印出下一頁要用的游標。

用法：python3 tools/audit/page-cursor.py <落檔路徑>
輸出一行 JSON：{"events": N, "has_more": bool, "first_id": "...", "oldest": "...", "newest": "..."}
has_more 為 true → 下一次呼叫 list_events 帶 before_id=<first_id>；false → 該 session 拉完了。
只印游標，不印事件內容（事件內容是別的 session 的資料，不該進上下文）。
"""
import json
import sys


def load_page(text):
    i = text.find('{"ccr"')
    if i < 0:
        return None
    obj, _ = json.JSONDecoder().raw_decode(text[i:])
    return obj.get("ccr")


if __name__ == "__main__":
    page = load_page(open(sys.argv[1], encoding="utf-8").read())
    if page is None:
        print(json.dumps({"error": "no ccr payload in file"}))
        sys.exit(1)
    data = page.get("data") or []
    times = sorted(e.get("created_at", "") for e in data)
    print(json.dumps({
        "events": len(data),
        "has_more": bool(page.get("has_more")),
        "first_id": page.get("first_id"),
        "oldest": times[0] if times else None,
        "newest": times[-1] if times else None,
    }))
