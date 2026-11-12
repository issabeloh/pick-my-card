#!/usr/bin/env python3
"""把拉下來的 session 事件彙整成每個 session 一個 JSONL 檔。

為什麼需要這支：過去 session 的 transcript 不在容器裡，只能用 MCP 工具
`mcp__claude-code-remote__list_events` 一頁一頁拉。每頁的輸出超過上限時，harness 會把它
存成 `tool-results/mcp-claude-code-remote-list_events-*.txt`，但檔名和內容都沒有 session 代號。
本 script 讀「本次審計 session 自己的 transcript」（主對話＋subagent），把每次 list_events
呼叫的輸入（session_id）和它的結果（落檔路徑或 inline JSON）配對起來，再依 session 合併去重。

用法：
  python3 tools/audit/collect.py --out <資料目錄>
  （--transcripts 預設 ~/.claude/projects，會遞迴掃所有 .jsonl）

輸出：
  <資料目錄>/events/<session_id>.jsonl   每行一個事件，依時間排序
  <資料目錄>/collect-summary.json        每個 session 的頁數、事件數、是否拉完整
  <資料目錄>/sessions-index.json         session 代號 → 標題（來自 list_sessions 的結果）

資料目錄放 repo 外（transcript 含私人對話，不 commit）。
"""
import argparse
import glob
import json
import os
import re
import sys

SAVED_RE = re.compile(r"Output has been saved to (\S+?\.txt)")


def load_page(text):
    i = text.find('{"ccr"')
    if i < 0:
        return None
    try:
        obj, _ = json.JSONDecoder().raw_decode(text[i:])
    except ValueError:
        return None
    return obj.get("ccr")


def event_uuid(ev):
    for k, v in ev.items():
        if k == "created_at" or not isinstance(v, dict):
            continue
        if v.get("uuid"):
            return v["uuid"]
        inner = v.get("internal_anthropic_catchall")
        if isinstance(inner, dict) and inner.get("uuid"):
            return inner["uuid"]
    return json.dumps(ev, sort_keys=True)[:200]


def result_text(block):
    c = block.get("content")
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return "\n".join(x.get("text", "") for x in c if isinstance(x, dict))
    return ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--transcripts", default=os.path.expanduser("~/.claude/projects"))
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    calls = {}    # tool_use_id -> session_id
    results = {}  # tool_use_id -> text
    list_calls = set()  # list_sessions 的 tool_use_id（拿標題用）
    for path in glob.glob(os.path.join(args.transcripts, "**", "*.jsonl"), recursive=True):
        with open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if "list_events" not in line and "list_sessions" not in line and "tool_result" not in line:
                    continue
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue
                content = (rec.get("message") or {}).get("content")
                if not isinstance(content, list):
                    continue
                for b in content:
                    if not isinstance(b, dict):
                        continue
                    if b.get("type") == "tool_use" and str(b.get("name", "")).endswith("list_events"):
                        sid = (b.get("input") or {}).get("session_id")
                        if sid:
                            calls[b["id"]] = sid
                    elif b.get("type") == "tool_use" and str(b.get("name", "")).endswith("list_sessions"):
                        list_calls.add(b["id"])
                    elif b.get("type") == "tool_result":
                        results[b.get("tool_use_id")] = result_text(b)

    sessions = {}  # sid -> {"events": {uuid: ev}, "pages": n, "complete": bool, "missing": n}
    for tid, sid in calls.items():
        s = sessions.setdefault(sid, {"events": {}, "pages": 0, "complete": False, "missing": 0})
        text = results.get(tid)
        if text is None:
            s["missing"] += 1
            continue
        m = SAVED_RE.search(text)
        if m and os.path.exists(m.group(1)):
            text = open(m.group(1), encoding="utf-8", errors="replace").read()
        page = load_page(text)
        if page is None:
            s["missing"] += 1
            continue
        s["pages"] += 1
        # 只有「帶 before_id 往回翻」或第一頁就沒有更多時，has_more=false 才代表拉到開頭
        if not page.get("has_more"):
            s["complete"] = True
        for ev in page.get("data") or []:
            s["events"][event_uuid(ev)] = ev

    os.makedirs(os.path.join(args.out, "events"), exist_ok=True)
    index = {}
    for tid in list_calls:
        page = load_page(results.get(tid) or "")
        for row in (page or {}).get("data") or []:
            if row.get("id"):
                index[row["id"]] = {"title": row.get("title", ""), "created_at": row.get("created_at"),
                                    "updated_at": row.get("updated_at"), "origin": row.get("origin")}
    with open(os.path.join(args.out, "sessions-index.json"), "w", encoding="utf-8") as fh:
        json.dump(index, fh, ensure_ascii=False, indent=1)
    summary = {}
    for sid, s in sorted(sessions.items()):
        evs = sorted(s["events"].values(), key=lambda e: e.get("created_at", ""))
        with open(os.path.join(args.out, "events", sid + ".jsonl"), "w", encoding="utf-8") as fh:
            for ev in evs:
                fh.write(json.dumps(ev, ensure_ascii=False) + "\n")
        summary[sid] = {
            "pages": s["pages"], "events": len(evs), "complete": s["complete"],
            "unparsed_calls": s["missing"],
            "first": evs[0].get("created_at") if evs else None,
            "last": evs[-1].get("created_at") if evs else None,
        }
    with open(os.path.join(args.out, "collect-summary.json"), "w", encoding="utf-8") as fh:
        json.dump(summary, fh, ensure_ascii=False, indent=1)

    done = sum(1 for v in summary.values() if v["complete"])
    print(f"sessions={len(summary)} complete={done} incomplete={len(summary) - done}")
    for sid, v in summary.items():
        flag = "ok " if v["complete"] else "INCOMPLETE"
        print(f"{flag} {sid} pages={v['pages']} events={v['events']} "
              f"unparsed={v['unparsed_calls']} {str(v['first'])[:10]}..{str(v['last'])[:10]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
