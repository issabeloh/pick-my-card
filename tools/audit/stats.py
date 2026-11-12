#!/usr/bin/env python3
"""Claude Code 使用效率統計：每個 session、每種工具的 token／花費／耗時，以及機械可判的浪費旗標。

輸入：collect.py 產生的 <資料目錄>/events/<session_id>.jsonl
用法：
  python3 tools/audit/stats.py --data <資料目錄>                 # 總表（session 排名、工具表、旗標總計、規則遵守率）
  python3 tools/audit/stats.py --data <資料目錄> --session <id>  # 單一 session 細看（逐輪時間軸＋旗標證據）
  python3 tools/audit/stats.py --data <資料目錄> --checklist     # 固定門檻的檢查表（審查流程第 3 步用）
  共用選項：--since YYYY-MM-DD（只算這天之後的 session）、--repo <關鍵字>（只算 cwd 含此字串的 session）

數字的可信度（報告時要照實標）：
  精確   session 總花費、總 token（來自每輪 result 事件的 model_usage_since_last_result）
  精確   每個 API request 的 input 側 token（cache_read / cache_creation / input）
  估計   output token（事件裡只有串流開頭的值）→ 用內容長度估，再把整個 session 校正到精確總額
  估計   工具結果的 token（字元數換算：ASCII/3.6 + 非 ASCII×1.1；圖片每張 1,500）
成本歸屬方式：每個 API request 的花費，平均分給「觸發它的那批工具結果」。
  也就是說「Bash 花了 $X」＝模型為了看 Bash 的結果而發出的那些 request 的總花費（含重讀整個上下文）。
  所有工具列＋「用戶訊息」列相加＝ session 總花費，不重複不遺漏。
"""
import argparse
import collections
import glob
import json
import os
import re
import sys
from datetime import datetime

REPO_PREFIX = "/home/user/pick-my-card/"
BIG_FILES = re.compile(r"(^|/)(js/[\w-]+\.js|styles\.css|index\.html)$")
DATA_BLOBS = re.compile(r"(cards\.data|fixture\.data)")
LOGIC_FILES = re.compile(r"js/(cashback-engine|search-match|results-display)\.js$")
# 任務路由表：改到左邊的檔 → 應該讀過右邊的文件
ROUTES = [
    (re.compile(r"js/(cashback-engine|search-match)\.js$"), "docs/project/cashback-engine.md"),
    (re.compile(r"(js/(results-display|card-detail|home-ui|cards-modals|mappings-page|spending-mappings|levels-payments)\.js|styles\.css|index\.html)$"), "docs/project/ui-display.md"),
    (re.compile(r"(apps-script/.*\.gs|cards\.data|tools/build-.*\.js)$"), "docs/project/data-pipeline.md"),
    (re.compile(r"(js/auth-user-data\.js|firestore\.rules)$"), "docs/project/storage-and-security.md"),
    (re.compile(r"(^CLAUDE\.md|docs/(ops|project)/.*\.md)$"), "docs/ops/maintenance.md"),
]
# 檢查表門檻：改門檻要在 docs/ops/efficiency-review.md 的「歷次結果」記一筆原因
THRESHOLDS = {
    "big_ctx_share": 0.30,      # 花費有多少比例發生在上下文 >200K 的 request
    "cold_share": 0.10,         # 快取重建多付的錢佔比
    "single_step_share": 0.70,  # 「一次只看一個工具結果」的 request 佔比
    "error_share": 0.03,        # 工具失敗的回合成本佔比
    "dup_read_share": 0.02,     # 重複讀檔的回合成本佔比
    "preflight_fail_rate": 0.10,
    "route_min": 0.70,          # 路由表遵守率下限（該讀的 session ≥5 個才判）
    "claude_md_tokens": 6000,
    "prefix_tokens": 85000,     # session 第一個 request 的 input 中位數
    "subagent_share": 0.05,
    "rule_sessions": 3,         # 同一條規則在幾個 session 被違反就算「常被違反」
}
DEFAULT_PRICE = {"in": 5e-6, "cw": 10e-6, "cr": 0.5e-6, "out": 25e-6}  # 資料不足以擬合時的備援比例


# ---------- 基本工具 ----------

def est_tokens(s):
    if not s:
        return 0
    non_ascii = sum(1 for ch in s if ord(ch) > 127)
    return int((len(s) - non_ascii) / 3.6 + non_ascii * 1.1)


def ts(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def rel(path):
    path = (path or "").strip("'\"")
    return path[len(REPO_PREFIX):] if path.startswith(REPO_PREFIX) else path


def block_text(content):
    """tool_result 的 content → (文字, 圖片張數)"""
    if isinstance(content, str):
        return content, 0
    text, imgs = [], 0
    for b in content or []:
        if not isinstance(b, dict):
            continue
        if b.get("type") == "text":
            text.append(b.get("text", ""))
        elif b.get("type") == "image":
            imgs += 1
    return "\n".join(text), imgs


READONLY_CMD = re.compile(r"^\s*(cd|grep|rg|sed -n|cat|head|tail|ls|find|wc|jq|awk|sort|uniq|cut|tr|echo|printf|file|stat|du|df|which|pwd|env|diff|"
                          r"git (log|show|diff|status|branch|remote|rev-parse|ls-files|blame|fetch|grep)|bash tools/cards-query\.sh|base64 -d)\b")
VERIFY_CMD = re.compile(r"(preflight\.sh|run-regression|regression/|playwright|http\.server|node --check|node -e|npm (test|run)|--verify|curl )")
MODIFY_CMD = re.compile(r"(git (commit|push|add|checkout|merge|rebase|reset|stash|mv|rm)|sed -i|\btee\b|>\s*[\w./$~-]|\bmv\b|\bcp\b|\brm\b|mkdir|npm install|pip install)")


SRC_EXT = r"(?:js|css|html|md|gs|json|sh|rules|py|data|version|txt|yml|toml)"


def bash_edits(cmd):
    """Bash 指令改了哪些 repo 內的檔（python heredoc 字串替換、sed -i、cat > 檔）→ [path]"""
    out = []
    if re.search(r"python3?\s+-\s*<<", cmd) and re.search(r"\.write\(|['\"]w['\"]", cmd):
        out += re.findall(r"['\"]([\w./-]+\." + SRC_EXT + r")['\"]", cmd)
    for m in re.finditer(r"sed -i[^\n;|&]*?\s([\w./-]+\." + SRC_EXT + r")(?=\s|$|;|&)", cmd):
        out.append(m.group(1))
    for m in re.finditer(r"cat\s*>+\s*([\w./-]+\." + SRC_EXT + r")\s*<<", cmd):
        out.append(m.group(1))
    seen, res = set(), []
    for p in out:
        p = rel(p)
        if p.startswith("/") or p.startswith("node_modules") or p in seen:
            continue        # repo 外（scratchpad、/tmp）不算
        seen.add(p)
        res.append(p)
    return res


def classify(name, inp):
    if name in ("Read", "Grep", "Glob"):
        return "explore"
    if name in ("Edit", "Write", "NotebookEdit"):
        return "modify"
    if name in ("WebSearch", "WebFetch"):
        return "web"
    if name in ("Agent", "Task", "SubagentHandback"):
        return "agent"
    if name == "Bash":
        cmd = inp.get("command", "") or ""
        if bash_edits(cmd):
            return "modify"
        if VERIFY_CMD.search(cmd):
            return "verify"
        if MODIFY_CMD.search(cmd):
            return "modify"
        parts = [p for p in re.split(r"&&|;|\|\||\n", cmd) if p.strip()]
        if parts and all(READONLY_CMD.match(p.split("|")[0]) for p in parts):
            return "explore"
        return "bash-other"
    if name.startswith("mcp__"):
        return "mcp"
    return "other"


def read_ops(name, inp):
    """這個工具呼叫讀了哪些檔的哪些行 → [(path, start, end)]；end=None 代表讀到底／整檔"""
    ops = []
    if name == "Read":
        p = rel(inp.get("file_path", ""))
        off = inp.get("offset") or 1
        lim = inp.get("limit")
        ops.append((p, off, off + lim - 1 if lim else None))
    elif name == "Bash":
        cmd = inp.get("command", "") or ""
        for m in re.finditer(r"sed -n\s+['\"]?(\d+),(\d+)p['\"]?\s+([^\s;|&)]+)", cmd):
            ops.append((rel(m.group(3)), int(m.group(1)), int(m.group(2))))
        for m in re.finditer(r"(?:^|[;&|]\s*)cat\s+(?:-n\s+)?([^\s;|&<>)]+)", cmd):
            if not m.group(1).startswith("<<"):
                ops.append((rel(m.group(1)), 1, None))
        for m in re.finditer(r"head\s+-(?:n\s*)?(\d+)\s+([^\s;|&)]+)", cmd):
            ops.append((rel(m.group(2)), 1, int(m.group(1))))
    return [o for o in ops if o[0] and "." in o[0].split("/")[-1]]


def overlap(a, b):
    """兩個讀取區間重疊比例（以後者 b 為分母）"""
    a0, a1 = a[1], a[2] if a[2] else 10 ** 9
    b0, b1 = b[1], b[2] if b[2] else 10 ** 9
    inter = min(a1, b1) - max(a0, b0) + 1
    size = b1 - b0 + 1
    return max(0, inter) / size if size > 0 else 0


def mentions(name, inp, needle):
    blob = json.dumps(inp, ensure_ascii=False) if isinstance(inp, dict) else str(inp)
    return needle in blob


# ---------- 解析一個 session ----------

class Call:
    __slots__ = ("id", "name", "inp", "thread", "t0", "t1", "res_text", "res_tok", "imgs", "is_err",
                 "cost", "cls", "turn", "req_ctx")

    def __init__(self, cid, name, inp, thread, t0, turn):
        self.id, self.name, self.inp, self.thread, self.t0, self.turn = cid, name, inp or {}, thread, t0, turn
        self.t1 = None
        self.res_text, self.res_tok, self.imgs, self.is_err = "", 0, 0, False
        self.cost = 0.0
        self.cls = classify(name, self.inp)
        self.req_ctx = 0


def parse_session(path):
    sid = os.path.basename(path)[:-6]
    S = {"id": sid, "cwd": "", "models": collections.Counter(), "results": [], "requests": [], "calls": {},
         "turns": [], "ctx_usage": None, "first": None, "last": None, "sub_meta": {}, "perm_denied": 0}
    reqs = {}       # message id -> request dict
    pending = collections.defaultdict(list)  # thread -> triggers（等下一個 request 來認領）
    turn_idx = -1
    for line in open(path, encoding="utf-8"):
        ev = json.loads(line)
        created = ev.get("created_at")
        S["first"] = S["first"] or created
        S["last"] = created
        kind = next((k for k in ev if k != "created_at"), None)
        body = ev.get(kind)
        if not isinstance(body, dict):
            continue
        c = body.get("internal_anthropic_catchall", body) if kind != "internal_anthropic_catchall" else body
        if not isinstance(c, dict):
            continue
        t = ts(c.get("timestamp")) or ts(created)

        if kind == "system":
            st = c.get("subtype")
            if st == "init" and c.get("cwd"):
                S["cwd"] = c["cwd"]
            elif st == "permission_denied":
                S["perm_denied"] += 1
        elif kind == "control_response":
            r = (c.get("response") or {}).get("response")
            if isinstance(r, dict) and "categories" in r:
                S["ctx_usage"] = r
        elif kind == "result":
            usage = c.get("model_usage_since_last_result") or {}
            S["results"].append({"t": ts(created), "created": created, "dur": c.get("duration_ms") or 0,
                                 "api": c.get("duration_api_ms") or 0, "usage": usage,
                                 "cum": c.get("modelUsage") or {}, "num_turns": c.get("num_turns") or 0,
                                 "first_in": c.get("first_request_input_tokens") or 0,
                                 "sub": (c.get("subagent_stats") or {}).get("spawned", 0),
                                 "is_error": c.get("is_error")})
        elif kind == "assistant":
            m = c.get("message") or {}
            thread = c.get("parent_tool_use_id") or "main"
            mid = m.get("id") or ev.get("created_at")
            u = m.get("usage") or {}
            r = reqs.get(mid)
            if r is None:
                r = {"id": mid, "thread": thread, "t": t, "model": m.get("model"), "in": 0, "cw": 0, "cr": 0,
                     "out_est": 0, "triggers": pending.pop(thread, []) or ["(continuation)"], "turn": turn_idx}
                reqs[mid] = r
                S["requests"].append(r)
                if m.get("model") and not m["model"].startswith("<"):
                    S["models"][m["model"]] += 1
            r["in"] = max(r["in"], u.get("input_tokens") or 0)
            r["cw"] = max(r["cw"], u.get("cache_creation_input_tokens") or 0)
            r["cr"] = max(r["cr"], u.get("cache_read_input_tokens") or 0)
            wire = c.get("wire_tool_inputs") or {}
            if thread != "main" and c.get("subagent_type"):
                S["sub_meta"].setdefault(thread, {"type": c.get("subagent_type"), "desc": c.get("task_description")})
            for b in m.get("content") or []:
                bt = b.get("type")
                if bt == "text":
                    r["out_est"] += est_tokens(b.get("text", ""))
                elif bt == "thinking":
                    r["out_est"] += est_tokens(b.get("thinking", "")) or 150
                elif bt == "tool_use":
                    inp = wire.get(b.get("id")) or b.get("input") or {}
                    r["out_est"] += est_tokens(json.dumps(inp, ensure_ascii=False)) + 20
                    if b["id"] not in S["calls"]:
                        S["calls"][b["id"]] = Call(b["id"], b.get("name", "?"), inp, thread, t, turn_idx)
        elif kind == "user":
            m = c.get("message") or {}
            thread = c.get("parent_tool_use_id") or "main"
            content = m.get("content")
            blocks = content if isinstance(content, list) else []
            tool_results = [b for b in blocks if isinstance(b, dict) and b.get("type") == "tool_result"]
            if tool_results:
                for b in tool_results:
                    call = S["calls"].get(b.get("tool_use_id"))
                    text, imgs = block_text(b.get("content"))
                    if call:
                        call.t1 = t
                        call.res_text, call.imgs = text, imgs
                        call.res_tok = est_tokens(text) + imgs * 1500
                        call.is_err = bool(b.get("is_error")) or bool(re.match(r"\s*(Exit code [1-9]|Error:|<tool_use_error>)", text))
                    pending[thread].append(b.get("tool_use_id"))
            else:
                text = content if isinstance(content, str) else "\n".join(
                    b.get("text", "") for b in blocks if isinstance(b, dict) and b.get("type") == "text")
                if thread == "main" and not c.get("isSynthetic"):
                    turn_idx += 1
                    S["turns"].append({"i": turn_idx, "t": t, "created": created, "text": text,
                                       "imgs": sum(1 for b in blocks if isinstance(b, dict) and b.get("type") == "image")})
                pending[thread].append("(user)")
    normalize_results(S)
    return S


USAGE_FIELDS = ("inputTokens", "cacheCreationInputTokens", "cacheReadInputTokens", "outputTokens", "costUSD")


def normalize_results(S):
    """result 事件的 modelUsage 是「同一個 process 內的累計值」，容器重啟就歸零。
    這裡把它還原成每輪的用量：沒重啟 → 本輪 = 累計差；重啟 → 本輪 = 累計值本身。
    重啟的判斷：拿這一輪所有 request 的 cache_read 加總 R 當尺，看「累計差」和「累計值」哪個比較接近 R。"""
    prev, prev_t = None, 0
    for r in S["results"]:
        cum = r["cum"]
        if not cum:
            prev_t = r["t"] or prev_t
            continue
        R = sum(q["cr"] for q in S["requests"] if prev_t < (q["t"] or 0) <= (r["t"] or 0) + 5)
        cum_cr = sum(u.get("cacheReadInputTokens", 0) for u in cum.values())
        reset = True
        if prev is not None:
            D = cum_cr - sum(u.get("cacheReadInputTokens", 0) for u in prev.values())
            reset = D < 0 or abs(cum_cr - R) < abs(D - R)
        usage = {}
        for model, u in cum.items():
            base = {} if reset else (prev.get(model) or {})
            usage[model] = {f: max(0, (u.get(f) or 0) - (base.get(f) or 0)) for f in USAGE_FIELDS}
        r["usage"], r["reset"] = usage, reset
        prev, prev_t = cum, (r["t"] or prev_t)


# ---------- 價格擬合與成本歸屬 ----------

def solve(A, b):
    n = len(A)
    M = [row[:] + [b[i]] for i, row in enumerate(A)]
    for i in range(n):
        p = max(range(i, n), key=lambda r: abs(M[r][i]))
        M[i], M[p] = M[p], M[i]
        if abs(M[i][i]) < 1e-18:
            return None
        for r in range(n):
            if r != i:
                f = M[r][i] / M[i][i]
                M[r] = [x - f * y for x, y in zip(M[r], M[i])]
    return [M[i][n] / M[i][i] for i in range(n)]


def fit_prices(sessions):
    rows = collections.defaultdict(list)
    for S in sessions:
        for r in S["results"]:
            for model, u in r["usage"].items():
                x = [u.get("inputTokens", 0), u.get("cacheCreationInputTokens", 0),
                     u.get("cacheReadInputTokens", 0), u.get("outputTokens", 0)]
                if u.get("costUSD"):
                    rows[model].append((x, u["costUSD"]))
    prices = {}
    for model, data in rows.items():
        sol = None
        if len(data) >= 8:
            A = [[sum(x[i] * x[j] for x, _ in data) for j in range(4)] for i in range(4)]
            for i in range(4):
                A[i][i] *= 1 + 1e-9
            sol = solve(A, [sum(x[i] * y for x, y in data) for i in range(4)])
        if sol and all(v > 0 for v in sol[1:]):
            prices[model] = {"in": max(sol[0], sol[2]), "cw": sol[1], "cr": sol[2], "out": sol[3], "fit": len(data)}
        else:
            w = sum(x[0] + 2 * x[1] + 0.1 * x[2] + 5 * x[3] for x, _ in data)
            p_in = sum(y for _, y in data) / w if w else DEFAULT_PRICE["in"]
            prices[model] = {"in": p_in, "cw": 2 * p_in, "cr": 0.1 * p_in, "out": 5 * p_in, "fit": 0}
    return prices


def attribute(S, prices):
    actual = sum(u.get("costUSD", 0) for r in S["results"] for u in r["usage"].values())
    tot = collections.Counter()
    for r in S["results"]:
        for u in r["usage"].values():
            tot["in"] += u.get("inputTokens", 0)
            tot["cw"] += u.get("cacheCreationInputTokens", 0)
            tot["cr"] += u.get("cacheReadInputTokens", 0)
            tot["out"] += u.get("outputTokens", 0)
    est = 0.0
    for r in S["requests"]:
        p = prices.get(r["model"]) or DEFAULT_PRICE
        r["ctx"] = r["in"] + r["cw"] + r["cr"]
        r["cost"] = r["in"] * p["in"] + r["cw"] * p["cw"] + r["cr"] * p["cr"] + r["out_est"] * p["out"]
        r["p"] = p
        est += r["cost"]
    scale = actual / est if actual and est else 1.0
    S["cost"], S["cost_est_raw"], S["scale"], S["tok"] = (actual or est), est, scale, tot
    if not actual:  # 沒有 result 事件（被中斷的輪）→ 用 request 估
        for r in S["requests"]:
            tot["in"] += r["in"]; tot["cw"] += r["cw"]; tot["cr"] += r["cr"]; tot["out"] += r["out_est"]
    S["user_cost"] = 0.0
    for r in S["requests"]:
        r["cost"] *= scale
        trig = r["triggers"]
        share = r["cost"] / len(trig)
        for tid in trig:
            call = S["calls"].get(tid)
            if call:
                call.cost += share
                call.req_ctx = r["ctx"]
            else:
                S["user_cost"] += share


# ---------- 浪費偵測 ----------

def flag(S, kind, call, tokens, cost, detail):
    S["flags"].append({"kind": kind, "turn": call.turn if call else -1, "tokens": int(tokens), "cost": cost,
                       "detail": detail, "tool": call.name if call else ""})


def detect(S):
    S["flags"] = []
    calls = sorted(S["calls"].values(), key=lambda c: c.t0 or 0)
    seen_reads = collections.defaultdict(list)   # (thread, path) -> [(start, end, call)]
    seen_cmds = {}
    docs_read = set()
    preflight_since_commit = False
    regression_run = False
    logic_edited = []
    edited_files = collections.Counter()
    for c in calls:
        inp = c.inp
        blob = json.dumps(inp, ensure_ascii=False)
        cmd = inp.get("command", "") if c.name == "Bash" else ""
        # 讀過哪些 docs（Read 或 Bash 提到路徑都算）
        for m in re.finditer(r"docs/(?:ops|project)/[\w-]+\.md", blob):
            if c.cls != "modify":
                docs_read.add(m.group(0))
        # --- 重複讀檔 ---
        for op in read_ops(c.name, inp):
            key = (c.thread, op[0])
            for prev in seen_reads[key]:
                ov = overlap(prev, op)
                if ov >= 0.5:
                    flag(S, "dup_read", c, c.res_tok * ov, c.cost,
                         f"{op[0]}:{op[1]}-{op[2] or 'EOF'} 已在第{prev[3].turn}輪讀過（重疊{int(ov * 100)}%）")
                    break
            seen_reads[key].append((op[0], op[1], op[2], c))
            # --- 規則：資料 blob 不可讀 ---
            if DATA_BLOBS.search(op[0]):
                flag(S, "rule_read_blob", c, c.res_tok, c.cost, f"直接讀 {op[0]}")
            # --- 規則：大檔一次 ≤200 行 ---
            elif BIG_FILES.search(op[0]):
                span = (op[2] - op[1] + 1) if op[2] else None
                if span is None or span > 200:
                    flag(S, "rule_big_read", c, c.res_tok, c.cost,
                         f"{op[0]} 一次讀 {span or '整檔'} 行（上限 200）")
        targets = [rel(inp.get("file_path", ""))] if c.name in ("Edit", "Write") else bash_edits(cmd)
        for p in targets:
            edited_files[p] += 1
            for key in list(seen_reads):
                if key[1] == p:
                    seen_reads[key] = []     # 檔案改過，之後重讀不算重複
            if LOGIC_FILES.search(p):
                logic_edited.append((c, p))
            if re.match(r"merchant/.*\.html$", p):
                flag(S, "rule_handedit_generated", c, 0, c.cost, f"手改生成檔 {p}")
            new = (inp.get("new_string") or "") + (inp.get("content") or "") + (cmd if c.name == "Bash" else "")
            if re.search(r"\?v=(?!dev\b)[\w.-]+", new) and p.endswith(".html"):
                flag(S, "rule_manual_version", c, 0, c.cost, f"{p} 手動寫入 ?v= 版本號")
            if "JSON.parse(localStorage.getItem" in new:
                flag(S, "rule_raw_localstorage", c, 0, c.cost, f"{p} 直接 JSON.parse(localStorage...)")
        if cmd:
            if DATA_BLOBS.search(cmd) and "base64 -d" in cmd and "cards-query" not in cmd:
                flag(S, "rule_blob_raw_decode", c, c.res_tok, c.cost, "base64 -d 直接解 cards.data（沒走 cards-query.sh）")
            if "preflight.sh" in cmd:
                preflight_since_commit = True
                if c.is_err or re.search(r"(FAIL|❌|違規)", c.res_text):
                    flag(S, "preflight_fail", c, c.res_tok, c.cost, "preflight 沒過 → 之後的修正屬重工")
            if "run-regression" in cmd:
                regression_run = True
                if c.is_err:
                    flag(S, "regression_fail", c, c.res_tok, c.cost, "回歸測試紅燈")
            if re.search(r"git commit\b", cmd) and not c.is_err:
                if not preflight_since_commit:
                    flag(S, "rule_commit_no_preflight", c, 0, 0, "git commit 前沒跑 preflight.sh")
                if logic_edited and not regression_run:
                    flag(S, "rule_logic_no_regression", c, 0, 0,
                         "改了計算/搜尋/顯示邏輯（%s）但 commit 前沒跑 run-regression.js" %
                         ",".join(sorted({x[1] for x in logic_edited})))
                preflight_since_commit = False
                logic_edited = []
            # 完全相同的指令、完全相同的輸出、輸出不小 → 重跑沒有新資訊
            if c.res_tok >= 400 and c.cls in ("explore",):
                k = (c.thread, cmd)
                if k in seen_cmds and seen_cmds[k].res_text == c.res_text:
                    flag(S, "dup_cmd", c, c.res_tok, c.cost, f"相同指令相同輸出：{cmd[:90]}")
                seen_cmds[k] = c
        # --- 失敗 ---
        if c.is_err:
            first = (c.res_text.strip().splitlines() or [""])[0][:110]
            flag(S, "tool_error", c, c.res_tok, c.cost, f"{c.name}: {first}")
        # --- 超大結果 ---
        if c.res_tok >= 8000:
            what = cmd[:80] if cmd else rel(inp.get("file_path", "")) or blob[:80]
            flag(S, "huge_result", c, c.res_tok, c.cost, f"{c.name} 單次結果約 {c.res_tok:,} tokens：{what}")
    # --- 路由表遵守 ---
    S["route"] = []
    for pattern, doc in ROUTES:
        touched = [p for p in edited_files if pattern.search(p)]
        if touched:
            ok = doc in docs_read
            S["route"].append({"doc": doc, "files": touched, "read": ok})
            if not ok:
                S["flags"].append({"kind": "rule_route_skipped", "turn": -1, "tokens": 0, "cost": 0, "tool": "",
                                   "detail": f"改了 {', '.join(touched[:3])} 但沒讀 {doc}"})
    S["docs_read"] = sorted(docs_read)
    S["edited_files"] = edited_files
    # --- 快取冷啟動（停太久，整個上下文重新寫入快取）---
    main = [r for r in S["requests"] if r["thread"] == "main"]
    S["cold"] = []
    for prev, r in zip(main, main[1:]):
        gap = (r["t"] or 0) - (prev["t"] or 0)
        if is_cold(r):
            extra = r["cw"] * (r["p"]["cw"] - r["p"]["cr"]) * S["scale"]
            S["cold"].append({"gap_min": gap / 60, "tokens": r["cw"], "cost": extra, "turn": r["turn"],
                              "model_switch": prev["model"] != r["model"], "ctx": r["ctx"]})
    # --- 探索 vs 修改 ---
    S["cls_cost"] = collections.Counter()
    S["cls_n"] = collections.Counter()
    for c in calls:
        S["cls_cost"][c.cls] += c.cost
        S["cls_n"][c.cls] += 1
    S["n_modify"] = sum(edited_files.values())
    S["n_bash_edit"] = sum(1 for c in calls if c.name == "Bash" and bash_edits(c.inp.get("command", "") or ""))
    # --- subagent ---
    S["subs"] = []
    for c in calls:
        if c.name in ("Agent", "Task"):
            sub_reqs = [r for r in S["requests"] if r["thread"] == c.id]
            sub_calls = [x for x in calls if x.thread == c.id]
            S["subs"].append({"type": inp_get(c, "subagent_type"), "desc": inp_get(c, "description"),
                              "model": sub_reqs[0]["model"] if sub_reqs else inp_get(c, "model"),
                              "reqs": len(sub_reqs), "calls": len(sub_calls),
                              "cost": sum(r["cost"] for r in sub_reqs),
                              "tokens": sum(r["ctx"] for r in sub_reqs),
                              "ret_tok": c.res_tok, "dur": (c.t1 - c.t0) if c.t1 and c.t0 else 0, "turn": c.turn})


def inp_get(c, k):
    return (c.inp or {}).get(k) or ""


# ---------- 輸出 ----------

def fmt_tok(n):
    return f"{n / 1e6:.2f}M" if n >= 1e6 else f"{n / 1e3:.0f}K"


def load_all(args):
    index = {}
    idx_path = os.path.join(args.data, "sessions-index.json")
    if os.path.exists(idx_path):
        index = json.load(open(idx_path, encoding="utf-8"))
    sessions = []
    for path in sorted(glob.glob(os.path.join(args.data, "events", "*.jsonl"))):
        S = parse_session(path)
        S["title"] = (index.get(S["id"]) or {}).get("title", "")
        if args.since and (S["last"] or "") < args.since:
            continue
        if args.repo and args.repo not in S["cwd"]:
            continue
        sessions.append(S)
    prices = fit_prices(sessions)
    for S in sessions:
        attribute(S, prices)
        detect(S)
    return sessions, prices


def summary(sessions, prices, args):
    total = sum(S["cost"] for S in sessions)
    print(f"# 總覽：{len(sessions)} 個 session，總花費 ${total:,.2f}")
    T = collections.Counter()
    for S in sessions:
        T.update(S["tok"])
    print(f"token：input {fmt_tok(T['in'])}｜cache 寫入 {fmt_tok(T['cw'])}｜cache 讀取 {fmt_tok(T['cr'])}｜output {fmt_tok(T['out'])}")
    print("\n## 擬合出的單價（USD / 百萬 token；fit=用了幾筆 result 事件，0=資料不足用備援值）")
    for m, p in sorted(prices.items()):
        print(f"  {m}: input {p['in'] * 1e6:.2f}  cache寫 {p['cw'] * 1e6:.2f}  cache讀 {p['cr'] * 1e6:.2f}  output {p['out'] * 1e6:.2f}  fit={p['fit']}")
    # cache 讀取佔花費比
    cr_cost = sum(r["cr"] * r["p"]["cr"] * S["scale"] for S in sessions for r in S["requests"])
    cw_cost = sum(r["cw"] * r["p"]["cw"] * S["scale"] for S in sessions for r in S["requests"])
    out_cost = sum(r["out_est"] * r["p"]["out"] * S["scale"] for S in sessions for r in S["requests"])
    print(f"\n花費組成（估）：重讀上下文（cache 讀取）${cr_cost:,.2f}（{cr_cost / total:.0%}）｜"
          f"寫入快取 ${cw_cost:,.2f}（{cw_cost / total:.0%}）｜output ${out_cost:,.2f}（{out_cost / total:.0%}）")

    print("\n## Session 排名（依花費）")
    print("| # | session | 標題 | 期間 | 模型 | 花費$ | req數 | 人類輪數 | 平均ctx | 最大ctx | 活躍分 | 工具呼叫 | 改檔次數 | subagent |")
    print("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for i, S in enumerate(sorted(sessions, key=lambda s: -s["cost"]), 1):
        main = [r for r in S["requests"] if r["thread"] == "main"]
        avg = sum(r["ctx"] for r in main) / len(main) if main else 0
        mx = max((r["ctx"] for r in main), default=0)
        active = sum(r["dur"] for r in S["results"]) / 60000
        model = "/".join(m.replace("claude-", "") for m, _ in S["models"].most_common(2))
        print(f"| {i} | {S['id'][-6:]} | {S['title'][:22]} | {str(S['first'])[5:10]}~{str(S['last'])[5:10]} | {model} | "
              f"{S['cost']:.2f} | {len(S['requests'])} | {len(S['turns'])} | {fmt_tok(avg)} | {fmt_tok(mx)} | {active:.0f} | "
              f"{len(S['calls'])} | {S['n_modify']} | {len(S['subs'])} |")

    print("\n## 工具表（成本＝為了看這個工具的結果而發出的 request 花費；耗時＝工具本身執行時間）")
    tools = collections.defaultdict(lambda: collections.Counter())
    user_cost = 0
    for S in sessions:
        user_cost += S["user_cost"]
        for c in S["calls"].values():
            name = c.name if not c.name.startswith("mcp__") else "mcp:" + c.name.split("__")[1]
            t = tools[name]
            t["n"] += 1; t["cost"] += c.cost; t["res"] += c.res_tok; t["err"] += c.is_err
            t["dur"] += (c.t1 - c.t0) if c.t1 and c.t0 else 0
    print("| 工具 | 次數 | 成本$ | 佔比 | 每次$ | 結果token(估) | 每次結果 | 失敗 | 工具耗時(分) |")
    print("|---|---|---|---|---|---|---|---|---|")
    for name, t in sorted(tools.items(), key=lambda kv: -kv[1]["cost"])[:22]:
        print(f"| {name} | {t['n']} | {t['cost']:.2f} | {t['cost'] / total:.1%} | {t['cost'] / t['n']:.3f} | "
              f"{fmt_tok(t['res'])} | {t['res'] // t['n']:,} | {t['err']} | {t['dur'] / 60:.0f} |")
    print(f"| (用戶訊息觸發的 request) | - | {user_cost:.2f} | {user_cost / total:.1%} | | | | | |")

    print_structure(sessions)

    print("\n## 工作類型（Bash 依指令內容分類）")
    cls_cost, cls_n = collections.Counter(), collections.Counter()
    for S in sessions:
        cls_cost.update(S["cls_cost"]); cls_n.update(S["cls_n"])
    for k, v in cls_cost.most_common():
        print(f"  {k:11s} {cls_n[k]:5d} 次  ${v:8.2f}  {v / total:.1%}")

    print("\n## 浪費旗標總計（同一次呼叫可能同時中多個旗標，各類不可直接相加）")
    F = collections.defaultdict(lambda: [0, 0, 0.0, set()])
    for S in sessions:
        for f in S["flags"]:
            x = F[f["kind"]]
            x[0] += 1; x[1] += f["tokens"]; x[2] += f["cost"]; x[3].add(S["id"])
    print("| 旗標 | 次數 | 涉及 session | 結果token(估) | 回合成本$ |")
    print("|---|---|---|---|---|")
    for k, x in sorted(F.items(), key=lambda kv: -kv[1][2]):
        print(f"| {k} | {x[0]} | {len(x[3])} | {fmt_tok(x[1])} | {x[2]:.2f} |")
    cold = [(S, c) for S in sessions for c in S["cold"]]
    print(f"| cold_cache（停超過快取壽命後重建上下文） | {len(cold)} | {len({S['id'] for S, _ in cold})} | "
          f"{fmt_tok(sum(c['tokens'] for _, c in cold))} | {sum(c['cost'] for _, c in cold):.2f}（多付的差額） |")

    print("\n## 失敗類型（前 15）")
    E = collections.Counter(); EC = collections.Counter()
    for S in sessions:
        for f in S["flags"]:
            if f["kind"] == "tool_error":
                key = re.sub(r"[\d/]+|'[^']*'|\"[^\"]*\"", "#", f["detail"])[:70]
                E[key] += 1; EC[key] += f["cost"]
    for k, n in E.most_common(15):
        print(f"  {n:4d}  ${EC[k]:6.2f}  {k}")

    print("\n## 固定開場成本（每個 request 都要帶的前綴）")
    cats = collections.defaultdict(list)
    mem = collections.defaultdict(list)
    for S in sessions:
        cu = S["ctx_usage"]
        if not cu:
            continue
        for c in cu.get("categories", []):
            if c.get("kind") == "used" and c.get("id") != "messages":
                cats[c["name"]].append(c["tokens"])
        for mf in cu.get("memoryFiles", []):
            mem[rel(mf["path"])].append(mf["tokens"])
        for a in (cu.get("messageBreakdown") or {}).get("attachmentsByType", []):
            cats["附件:" + a["name"]].append(a["tokens"])
    for name, v in sorted(cats.items(), key=lambda kv: -sum(kv[1]) / len(kv[1])):
        print(f"  {name:38s} 平均 {sum(v) // len(v):7,} tokens（{len(v)} 個 session 有紀錄）")
    for name, v in mem.items():
        print(f"  記憶檔 {name}: 平均 {sum(v) // len(v):,} tokens")
    n_req = sum(len(S["requests"]) for S in sessions)
    firsts = [r["first_in"] for S in sessions for r in S["results"][:1] if r["first_in"]]
    if firsts:
        base = sorted(firsts)[len(firsts) // 2]
        print(f"  session 第一個 request 的 input 中位數：{base:,} tokens；全部 {n_req:,} 個 request × 此前綴 ≈ {fmt_tok(base * n_req)} cache 讀取")

    print("\n## 規則遵守")
    route = collections.defaultdict(lambda: [0, 0])
    for S in sessions:
        for r in S["route"]:
            route[r["doc"]][0] += 1
            route[r["doc"]][1] += r["read"]
    for doc, (n, ok) in sorted(route.items()):
        print(f"  路由表 {doc}: 該讀的 session {n} 個，實際有讀 {ok} 個（{ok / n:.0%}）")
    docs = collections.Counter()
    for S in sessions:
        docs.update(S["docs_read"])
    print("  各 docs 被讀到的 session 數：" + "、".join(f"{d.split('/')[-1]}×{n}" for d, n in docs.most_common()))
    commits = sum(1 for S in sessions for c in S["calls"].values() if c.name == "Bash" and re.search(r"git commit\b", c.inp.get("command", "")) and not c.is_err)
    print(f"  成功的 git commit 次數：{commits}")

    print("\n## Subagent")
    subs = [(S, s) for S in sessions for s in S["subs"]]
    print(f"  共 {len(subs)} 次，花費 ${sum(s['cost'] for _, s in subs):.2f}")
    for S, s in sorted(subs, key=lambda x: -x[1]["cost"])[:25]:
        print(f"  {S['id'][-6:]} 第{s['turn']}輪 {s['type'] or '?':16s} {str(s['model']).replace('claude-', ''):10s} "
              f"req={s['reqs']:3d} 工具={s['calls']:3d} ${s['cost']:.2f} 回傳{s['ret_tok']:,}tok {s['dur'] / 60:.1f}分｜{s['desc'][:40]}")


def is_cold(r):
    return r["cw"] > 0.5 * r["ctx"] and r["ctx"] > 60000


def structure(sessions):
    """跨 session 的成本結構數字（總表與檢查表共用）"""
    total = sum(S["cost"] for S in sessions) or 1e-9
    M = {"total": total, "ctx_bucket": collections.OrderedDict(), "gap": collections.OrderedDict()}
    for k in ("<100K", "100-200K", "200-400K", "400-600K", ">600K", "subagent"):
        M["ctx_bucket"][k] = [0, 0.0]
    for k in ("<5分", "5-60分", "1-12小時", ">12小時"):
        M["gap"][k] = [0, 0, 0.0]          # 回來的次數、其中重建的次數、多付的錢
    fixed = hist = cold_cost = cap_rebuild = cap_carry = 0.0
    single = batch = n_main = 0
    for S in sessions:
        main = [r for r in S["requests"] if r["thread"] == "main"]
        base = min(main[0]["ctx"], 90000) if main else 0
        for r in S["requests"]:
            if r["thread"] != "main":
                k = "subagent"
            else:
                c = r["ctx"]
                k = "<100K" if c < 1e5 else "100-200K" if c < 2e5 else "200-400K" if c < 4e5 else "400-600K" if c < 6e5 else ">600K"
            M["ctx_bucket"][k][0] += 1
            M["ctx_bucket"][k][1] += r["cost"]
        for r in main:
            n_main += 1
            f = min(base, r["cr"])
            fixed += f * r["p"]["cr"] * S["scale"]
            hist += (r["cr"] - f) * r["p"]["cr"] * S["scale"]
            cap_carry += max(0, r["cr"] - 200000) * r["p"]["cr"] * S["scale"]
            trig = [S["calls"].get(t) for t in r["triggers"]]
            if all(trig):
                single += len(trig) == 1
                batch += len(trig) > 1
        for prev, r in zip(main, main[1:]):
            gap = ((r["t"] or 0) - (prev["t"] or 0)) / 60
            extra = r["cw"] * (r["p"]["cw"] - r["p"]["cr"]) * S["scale"] if is_cold(r) else 0
            cold_cost += extra
            if is_cold(r):
                cap_rebuild += max(0, r["cw"] - 150000) * (r["p"]["cw"] - r["p"]["cr"]) * S["scale"]
            if "(user)" in r["triggers"]:
                k = "<5分" if gap < 5 else "5-60分" if gap < 60 else "1-12小時" if gap < 720 else ">12小時"
                M["gap"][k][0] += 1
                M["gap"][k][1] += is_cold(r)
                M["gap"][k][2] += extra
    M.update(fixed=fixed, hist=hist, cold=cold_cost, cap_rebuild=cap_rebuild, cap_carry=cap_carry,
             single=single, batch=batch, n_main=n_main)
    M["big_ctx"] = sum(v[1] for k, v in M["ctx_bucket"].items() if k in ("200-400K", "400-600K", ">600K"))
    return M


def print_structure(sessions):
    M = structure(sessions)
    total = M["total"]
    print("\n## 成本結構")
    print("依 request 當下的上下文大小：")
    for k, (n, c) in M["ctx_bucket"].items():
        if n:
            print(f"  ctx {k:9s} {n:5d} 個 request  ${c:8.2f}  {c / total:5.1%}  平均 ${c / n:.3f}/request")
    print(f"cache 讀取拆成：固定前綴 ${M['fixed']:.2f}（{M['fixed'] / total:.1%}）｜累積的對話歷史 ${M['hist']:.2f}（{M['hist'] / total:.1%}）")
    print("用戶回來時的快取重建（依距離上一個 request 的間隔）：")
    for k, (n, cold, c) in M["gap"].items():
        if n:
            print(f"  停 {k:7s} 回來 {n:4d} 次，其中 {cold:3d} 次整個上下文重寫快取，多付 ${c:.2f}")
    print(f"快取重建合計多付 ${M['cold']:.2f}（{M['cold'] / total:.1%}）")
    print(f"假設試算：重建時上下文若不超過 150K 可省 ${M['cap_rebuild']:.2f}；每個 request 的歷史若不超過 200K 可省 ${M['cap_carry']:.2f}")
    print(f"主對話 {M['n_main']} 個 request 中，只看 1 個工具結果的 {M['single']} 個（{M['single'] / max(1, M['n_main']):.0%}），"
          f"一次看多個（平行呼叫）的 {M['batch']} 個")


def checklist(sessions):
    """固定門檻的檢查表：每行 [FLAG] 或 [ok]。審查流程只對 [FLAG] 的項目動作（見 docs/ops/efficiency-review.md）。"""
    M = structure(sessions)
    total = M["total"]
    T = THRESHOLDS
    rows = []

    def add(code, name, value, limit, bad, note=""):
        rows.append(("FLAG" if bad else "ok", code, name, value, limit, note))

    F = collections.defaultdict(lambda: [0, 0.0, set()])
    for S in sessions:
        for f in S["flags"]:
            x = F[f["kind"]]
            x[0] += 1; x[1] += f["cost"]; x[2].add(S["id"])
    v = M["big_ctx"] / total
    add("C1", "花費發生在上下文>200K 的比例", f"{v:.0%}", f"{T['big_ctx_share']:.0%}", v > T["big_ctx_share"])
    v = M["cold"] / total
    add("C2", "快取重建多付的比例", f"{v:.0%}", f"{T['cold_share']:.0%}", v > T["cold_share"])
    v = M["single"] / max(1, M["n_main"])
    add("C3", "一次只看一個工具結果的 request 比例", f"{v:.0%}", f"{T['single_step_share']:.0%}", v > T["single_step_share"])
    v = F["tool_error"][1] / total
    add("C4", "工具失敗的回合成本比例", f"{v:.1%}", f"{T['error_share']:.0%}", v > T["error_share"], f"{F['tool_error'][0]} 次")
    v = F["dup_read"][1] / total
    add("C5", "重複讀檔的回合成本比例", f"{v:.1%}", f"{T['dup_read_share']:.0%}", v > T["dup_read_share"], f"{F['dup_read'][0]} 次")
    runs = sum(1 for S in sessions for c in S["calls"].values() if c.name == "Bash" and "preflight.sh" in c.inp.get("command", ""))
    fails = F["preflight_fail"][0]
    v = fails / max(1, runs)
    reasons = collections.Counter()
    for S in sessions:
        for c in S["calls"].values():
            if c.name == "Bash" and "preflight.sh" in c.inp.get("command", ""):
                for line in c.res_text.splitlines():
                    if "❌" in line and "未通過" not in line:
                        reasons[re.sub(r"\d+", "#", line.strip())[:60]] += 1
    top = reasons.most_common(1)
    add("C6", "preflight 失敗率", f"{v:.0%}（{fails}/{runs}）", f"{T['preflight_fail_rate']:.0%}", v > T["preflight_fail_rate"],
        f"最常見：{top[0][0]}×{top[0][1]}" if top else "")
    route = collections.defaultdict(lambda: [0, 0])
    for S in sessions:
        for r in S["route"]:
            route[r["doc"]][0] += 1
            route[r["doc"]][1] += r["read"]
    for doc, (n, ok) in sorted(route.items()):
        if n >= 5:
            add("C7", f"路由表遵守率 {doc.split('/')[-1]}", f"{ok / n:.0%}（{ok}/{n}）", f"{T['route_min']:.0%}", ok / n < T["route_min"])
    mem = [mf["tokens"] for S in sessions if S["ctx_usage"] for mf in S["ctx_usage"].get("memoryFiles", []) if mf["path"].endswith("CLAUDE.md")]
    if mem:
        v = max(mem)
        add("C8a", "CLAUDE.md token 數（期間最大值）", f"{v:,}", f"{T['claude_md_tokens']:,}", v > T["claude_md_tokens"])
    firsts = sorted(r["first_in"] for S in sessions for r in S["results"][:1] if r["first_in"])
    if firsts:
        v = firsts[len(firsts) // 2]
        add("C8b", "session 第一個 request 的 input 中位數", f"{v:,}", f"{T['prefix_tokens']:,}", v > T["prefix_tokens"])
    docs = collections.Counter()
    for S in sessions:
        docs.update(S["docs_read"])
    here = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    unread = sorted(os.path.relpath(p, here) for p in glob.glob(os.path.join(here, "docs", "*", "*.md"))
                    if "/archive/" not in p and os.path.relpath(p, here) not in docs)
    add("C9", "期間內沒有任何 session 讀過的 docs 檔", f"{len(unread)} 個", "0", bool(unread), "、".join(u.split("/")[-1] for u in unread))
    sub_cost = sum(s["cost"] for S in sessions for s in S["subs"])
    tiny = sum(1 for S in sessions for s in S["subs"] if s["calls"] <= 3)
    add("C10", "subagent 花費比例／3 次工具以內就結束的 subagent", f"{sub_cost / total:.1%}／{tiny} 個", f"{T['subagent_share']:.0%}／0",
        sub_cost / total > T["subagent_share"] or tiny > 0, f"共 {sum(len(S['subs']) for S in sessions)} 次")
    for kind in sorted(F):
        if kind.startswith("rule_"):
            n_s = len(F[kind][2])
            add("C11", f"規則違反 {kind}", f"{F[kind][0]} 次／{n_s} 個 session", f"{T['rule_sessions']} 個 session", n_s >= T["rule_sessions"])
    print(f"# 檢查表（{len(sessions)} 個 session，總花費 ${total:,.2f}，每個 request 平均 ${total / max(1, sum(len(S['requests']) for S in sessions)):.3f}）")
    print("| 結果 | 代碼 | 項目 | 數值 | 門檻 | 備註 |")
    print("|---|---|---|---|---|---|")
    for r in rows:
        print("| " + " | ".join(r) + " |")
    print(f"\nFLAG 共 {sum(1 for r in rows if r[0] == 'FLAG')} 項。每項的處置照 docs/ops/efficiency-review.md 第 4 節的對照表，不在表上的不要動。")


def detail(S, args):
    print(f"# {S['id']}｜{S['title']}｜{S['first'][:16]} ~ {S['last'][:16]}｜cwd={S['cwd']}")
    print(f"花費 ${S['cost']:.2f}（校正係數 {S['scale']:.2f}）｜request {len(S['requests'])}｜工具呼叫 {len(S['calls'])}｜模型 {dict(S['models'])}")
    t = S["tok"]
    print(f"token：input {fmt_tok(t['in'])}｜cache寫 {fmt_tok(t['cw'])}｜cache讀 {fmt_tok(t['cr'])}｜output {fmt_tok(t['out'])}")
    print("工作類型：" + "、".join(f"{k} {S['cls_n'][k]}次 ${v:.2f}" for k, v in S["cls_cost"].most_common()) + f"、用戶訊息 ${S['user_cost']:.2f}")
    print("讀過的 docs：" + (", ".join(S["docs_read"]) or "（無）"))
    print("改過的檔：" + ", ".join(f"{p}×{n}" for p, n in S["edited_files"].most_common(15)))
    for r in S["route"]:
        print(f"  路由 {'✓' if r['read'] else '✗'} {r['doc']} ← {', '.join(r['files'][:4])}")
    print("\n## 逐輪時間軸")
    by_turn_req = collections.defaultdict(list)
    for r in S["requests"]:
        by_turn_req[r["turn"]].append(r)
    by_turn_call = collections.defaultdict(list)
    for c in S["calls"].values():
        by_turn_call[c.turn].append(c)
    by_turn_flag = collections.defaultdict(list)
    for f in S["flags"]:
        by_turn_flag[f["turn"]].append(f)
    cold_turn = collections.defaultdict(float)
    for c in S["cold"]:
        cold_turn[c["turn"]] += c["cost"]
    for turn in S["turns"]:
        i = turn["i"]
        reqs = by_turn_req.get(i, [])
        cost = sum(r["cost"] for r in reqs)
        if args.min_turn_cost and cost < args.min_turn_cost:
            continue
        ctx = max((r["ctx"] for r in reqs if r["thread"] == "main"), default=0)
        cls = collections.Counter(c.cls for c in by_turn_call.get(i, []))
        text = re.sub(r"\s+", " ", re.sub(r"<system-reminder>.*?</system-reminder>", "", turn["text"], flags=re.S)).strip()
        print(f"\n[{i}] {turn['created'][5:16]} ${cost:.2f} req={len(reqs)} ctx={fmt_tok(ctx)} "
              f"{dict(cls)}{' 冷快取+$%.2f' % cold_turn[i] if i in cold_turn else ''}{' 附圖%d' % turn['imgs'] if turn['imgs'] else ''}")
        print(f"    用戶：{text[:args.prompt_chars]}")
        fl = collections.Counter(f["kind"] for f in by_turn_flag.get(i, []))
        if fl:
            print("    旗標：" + "、".join(f"{k}×{n}" for k, n in fl.most_common()))
    print("\n## 旗標證據（依成本排序，前 %d 筆）" % args.max_flags)
    for f in sorted(S["flags"], key=lambda f: -f["cost"])[:args.max_flags]:
        print(f"  [{f['turn']}] {f['kind']} ${f['cost']:.2f} ~{f['tokens']:,}tok｜{f['detail'][:170]}")
    if S["subs"]:
        print("\n## Subagent")
        for s in S["subs"]:
            print(f"  [{s['turn']}] {s['type']} {s['model']} req={s['reqs']} 工具={s['calls']} ${s['cost']:.2f} "
                  f"回傳{s['ret_tok']:,}tok {s['dur'] / 60:.1f}分｜{s['desc'][:60]}")
    if S["cold"]:
        print("\n## 冷快取：" + "、".join(f"[{c['turn']}]停{c['gap_min']:.0f}分 重建{fmt_tok(c['tokens'])} +${c['cost']:.2f}" for c in S["cold"][:30]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--session", help="session id（可只給結尾幾碼）")
    ap.add_argument("--since")
    ap.add_argument("--repo")
    ap.add_argument("--prompt-chars", type=int, default=140)
    ap.add_argument("--max-flags", type=int, default=40)
    ap.add_argument("--min-turn-cost", type=float, default=0)
    ap.add_argument("--checklist", action="store_true", help="只印固定門檻的檢查表（給審查流程用）")
    ap.add_argument("--json", help="把每個 session 的摘要另存成 JSON")
    args = ap.parse_args()
    sessions, prices = load_all(args)
    if not sessions:
        print("沒有符合條件的 session")
        return 1
    if args.session:
        for S in sessions:
            if S["id"].endswith(args.session):
                detail(S, args)
    elif args.checklist:
        checklist(sessions)
    else:
        summary(sessions, prices, args)
    if args.json:
        out = [{"id": S["id"], "title": S["title"], "cost": S["cost"], "requests": len(S["requests"]),
                "calls": len(S["calls"]), "tokens": dict(S["tok"]), "first": S["first"], "last": S["last"],
                "flags": dict(collections.Counter(f["kind"] for f in S["flags"])),
                "flag_cost": {k: round(sum(f["cost"] for f in S["flags"] if f["kind"] == k), 2)
                              for k in {f["kind"] for f in S["flags"]}},
                "cold_cost": round(sum(c["cost"] for c in S["cold"]), 2)} for S in sessions]
        json.dump(out, open(args.json, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
