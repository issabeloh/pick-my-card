#!/usr/bin/env python3
"""對話成本提醒（UserPromptSubmit hook）。

站長每次送出訊息時由 Claude Code 自動執行（設定在 .claude/settings.json）。
它看兩件事：這個對話現在多長、距離上一次回覆多久。超過門檻就把一段提醒塞給 Claude，
要 Claude 在回覆開頭先告訴站長成本，必要時先問要不要開新對話。

為什麼需要（2026-11 審計，docs/ops/efficiency-review.md）：
  - 每個 request 都會重讀整個對話，對話越長每一步越貴。
  - 停超過一小時再回來，整個對話要用高單價重新載入一次。
  - 09~11 月花費的 87% 來自上下文超過 30 萬 token 的 11 個對話。

限制（誠實條款）：
  - hook 在訊息送出「之前」執行，但提醒是由 Claude 在回覆裡說的，所以「這一次回來的重新載入費」
    在站長看到提醒時已經花掉了。提醒省的是接下來的每一步，以及之後每一次回來。
  - 金額是粗估（用審計期間的平均值），不是帳單。
  - 任何錯誤一律安靜結束（exit 0、不輸出），絕不擋住站長的訊息。

自我測試：python3 tools/hooks/session-cost-reminder.py --selftest
"""
import json
import os
import sys
import tempfile
import time
from datetime import datetime, timezone

# ---- 門檻（要調就改這裡；改了請在 docs/ops/efficiency-review.md 第 7 節記一筆）----
COLD_GAP_MIN = 60        # 停多久算「久停」（快取壽命是 1 小時）
COLD_CTX = 150_000       # 久停回來時，對話超過多少 token 才提醒
BIG_CTX = 300_000        # 不論停多久，對話超過多少 token 就提醒
BIG_STEP = 150_000       # 超過 BIG_CTX 後，每再多這麼多 token 再提醒一次（避免每則訊息都唸）
TAIL_BYTES = 4_000_000   # 只讀 transcript 的尾巴，檔案再大也不會慢

# ---- 粗估用的單價（來源：2026-09~11 審計的實測平均，混合了當時用過的模型）----
REBUILD_USD_PER_TOKEN = 9e-6          # 久停回來重新載入：每 100 萬 token 約 $9
STEP_USD = [(100_000, 0.09), (200_000, 0.10), (400_000, 0.19), (600_000, 0.33), (10 ** 9, 0.40)]
FRESH_STEP_USD = 0.09                 # 新對話裡每一步大約的花費


def step_cost(ctx):
    for limit, usd in STEP_USD:
        if ctx < limit:
            return usd
    return STEP_USD[-1][1]


def last_main_usage(path):
    """回傳 (上下文 token 數, 最後一次主對話回覆的時間戳秒)；讀不到回 (0, None)"""
    size = os.path.getsize(path)
    with open(path, "rb") as fh:
        if size > TAIL_BYTES:
            fh.seek(size - TAIL_BYTES)
            fh.readline()                      # 丟掉被切斷的第一行
        lines = fh.read().decode("utf-8", errors="replace").splitlines()
    for line in reversed(lines):
        if '"usage"' not in line:
            continue
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        if rec.get("isSidechain") or rec.get("type") != "assistant":
            continue                           # subagent 的回覆不算
        usage = (rec.get("message") or {}).get("usage") or {}
        ctx = ((usage.get("input_tokens") or 0) + (usage.get("cache_creation_input_tokens") or 0)
               + (usage.get("cache_read_input_tokens") or 0))
        if ctx <= 0:
            continue
        ts = None
        try:
            ts = datetime.fromisoformat(str(rec.get("timestamp", "")).replace("Z", "+00:00")).timestamp()
        except ValueError:
            pass
        return ctx, ts
    return 0, None


def fmt_gap(minutes):
    if minutes < 120:
        return f"{minutes:.0f} 分鐘"
    if minutes < 48 * 60:
        return f"{minutes / 60:.0f} 小時"
    return f"{minutes / 1440:.0f} 天"


def decide(ctx, gap_min, last_warned_ctx):
    """回傳 (kind, 新的 last_warned_ctx)；kind 是 'cold'、'big' 或 None"""
    if gap_min is not None and gap_min >= COLD_GAP_MIN and ctx >= COLD_CTX:
        return "cold", max(last_warned_ctx, ctx)
    if ctx >= BIG_CTX and ctx >= last_warned_ctx + BIG_STEP:
        return "big", ctx
    return None, last_warned_ctx


def build(kind, ctx, gap_min):
    wan = ctx / 10_000
    step = step_cost(ctx)
    if kind == "cold":
        rebuild = ctx * REBUILD_USD_PER_TOKEN
        fact = (f"這個對話目前約 {wan:.0f} 萬 token，距離上一次回覆已 {fmt_gap(gap_min)}。"
                f"久停後回來，整個對話要重新載入一次，這一則訊息光是載入約 ${rebuild:.1f}；"
                f"之後在這個對話裡每一步約 ${step:.2f}，新對話裡約 ${FRESH_STEP_USD:.2f}。（金額為粗估）")
    else:
        fact = (f"這個對話已經長到約 {wan:.0f} 萬 token。在這裡每一步約 ${step:.2f}，"
                f"新對話裡約 ${FRESH_STEP_USD:.2f}；之後若停超過一小時再回來，"
                f"每次重新載入約 ${ctx * REBUILD_USD_PER_TOKEN:.1f}。（金額為粗估）")
    context = (
        "【對話成本提醒｜由 tools/hooks/session-cost-reminder.py 自動產生，不是站長打的字】\n"
        + fact + "\n"
        "請照下面做（站長沒有程式背景，用白話）：\n"
        "1. 回覆的第一行先用一句話把上面的數字告訴站長。\n"
        "2. 判斷這則訊息：\n"
        "   - 只是簡短追問或確認、不需要動用工具就能回答 → 直接回答，結尾補一句「下一件事建議開新對話」。\n"
        "   - 需要動手做事（要讀檔、改檔、跑指令），而且是新的或不相干的任務 → 先不要開始做。"
        "問站長要「在這裡繼續」還是「開新對話」，並附上 3–5 行可以直接貼到新對話的交接摘要"
        "（分支名稱、已完成的事、待辦、需要先讀的檔案）。\n"
        "   - 需要動手做事，但明顯是上一件事還沒做完的延續 → 提醒一句後繼續做完，做完時附交接摘要並建議下一件事開新對話。\n"
        "3. 站長在這個對話裡已經明確說過「在這裡繼續」的話，只做第 1 點，不要再問。"
    )
    return fact, context


def run(payload, now=None):
    path = payload.get("transcript_path") or ""
    if not path or not os.path.exists(path):
        return None
    ctx, ts = last_main_usage(path)
    if ctx <= 0:
        return None
    now = now or time.time()
    gap_min = (now - ts) / 60 if ts else None
    sid = "".join(ch for ch in str(payload.get("session_id") or "unknown") if ch.isalnum() or ch in "-_")
    state_path = os.path.join(tempfile.gettempdir(), f"pmc-cost-reminder-{sid}.json")
    last = 0
    try:
        last = int(json.load(open(state_path)).get("last_warned_ctx", 0))
    except (OSError, ValueError, AttributeError):
        pass
    kind, new_last = decide(ctx, gap_min, last)
    if not kind:
        return None
    try:
        json.dump({"last_warned_ctx": new_last}, open(state_path, "w"))
    except OSError:
        pass
    fact, context = build(kind, ctx, gap_min)
    return {"systemMessage": "💰 " + fact,
            "hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": context}}


def selftest():
    def transcript(ctx, minutes_ago, sidechain_after=False):
        fd, p = tempfile.mkstemp(suffix=".jsonl")
        t = datetime.fromtimestamp(time.time() - minutes_ago * 60, timezone.utc).isoformat()
        rows = [{"type": "user", "message": {"content": "hi"}, "timestamp": t},
                {"type": "assistant", "isSidechain": False, "timestamp": t,
                 "message": {"usage": {"input_tokens": 5, "cache_creation_input_tokens": 1000,
                                       "cache_read_input_tokens": ctx - 1005}}}]
        if sidechain_after:   # subagent 的大上下文不該被算進來
            rows.append({"type": "assistant", "isSidechain": True, "timestamp": t,
                         "message": {"usage": {"input_tokens": 900_000}}})
        with os.fdopen(fd, "w") as fh:
            fh.write("\n".join(json.dumps(r) for r in rows) + "\n")
        return p

    ok = True

    def check(name, got, want):
        nonlocal ok
        good = (got is not None) == want if isinstance(want, bool) else got == want
        ok &= good
        print(("✅" if good else "❌"), name)

    sid = f"selftest-{os.getpid()}"
    state = os.path.join(tempfile.gettempdir(), f"pmc-cost-reminder-{sid}.json")

    def fresh():
        if os.path.exists(state):
            os.remove(state)

    fresh(); check("短對話、剛回覆 → 不提醒", run({"transcript_path": transcript(80_000, 2), "session_id": sid}), False)
    fresh(); check("短對話、隔天回來 → 不提醒", run({"transcript_path": transcript(80_000, 1500), "session_id": sid}), False)
    fresh(); r = run({"transcript_path": transcript(400_000, 3), "session_id": sid})
    check("40 萬 token、剛回覆 → 提醒（變長）", r, True)
    check("  同一個長度再送一則 → 不重複提醒", run({"transcript_path": transcript(410_000, 3), "session_id": sid}), False)
    check("  再長 15 萬以上 → 再提醒一次", run({"transcript_path": transcript(560_000, 3), "session_id": sid}), True)
    check("  久停回來 → 每次都提醒", run({"transcript_path": transcript(560_000, 200), "session_id": sid}), True)
    fresh(); r = run({"transcript_path": transcript(200_000, 90), "session_id": sid})
    check("20 萬 token、停 90 分鐘 → 提醒（久停）", r, True)
    check("  提醒文字含金額", bool(r and "$1.8" in r["systemMessage"]), True)
    fresh(); check("subagent 的上下文不算", run({"transcript_path": transcript(80_000, 2, True), "session_id": sid}), False)
    fresh(); check("transcript 不存在 → 安靜結束", run({"transcript_path": "/nonexistent.jsonl", "session_id": sid}), False)
    fd, bad = tempfile.mkstemp(); os.write(fd, b"not json\n{broken\n"); os.close(fd)
    check("transcript 壞掉 → 安靜結束", run({"transcript_path": bad, "session_id": sid}), False)
    check("沒有 transcript_path → 安靜結束", run({}), False)
    fresh()
    print("selftest:", "✅ 全部通過" if ok else "❌ 有失敗")
    return 0 if ok else 1


def main():
    if "--selftest" in sys.argv:
        return selftest()
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw) if raw.strip() else {}
        out = run(payload)
        if out:
            print(json.dumps(out, ensure_ascii=False))
    except Exception:           # 提醒程式自己出錯不能影響站長送訊息
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
