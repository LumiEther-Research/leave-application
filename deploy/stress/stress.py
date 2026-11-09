#!/usr/bin/env python3
"""Load and concurrency test for the LumiEther backend, through the web container (nginx -> Helidon -> Postgres).

Standard library only. It needs an admin the harness can sign in as, and a pool of employees that all share one
password (seed them with SQL; there is no add-employee endpoint until Phase 2).

  python3 deploy/stress/stress.py --base http://localhost:8088 \\
      --admin-email boss@example.com --admin-password '...' --employee-password '...' --employees 200

Three kinds of check:
  load      throughput and latency at rising concurrency (login is deliberately CPU-heavy: scrypt)
  races     things that must hold when requests collide (one winner, the last admin survives, ...)
  limits    hostile input and recovery after a burst
Exit code 1 if any correctness check fails or any request got a 5xx.

The session is an httpOnly cookie (lr_session). A "token" in this file is that cookie's value: the harness reads it
from Set-Cookie after sign-in and sends it back as a Cookie header, the way a browser would. Every state-changing
request carries an Origin (--origin, default the --base address, which must be in the backend's ALLOWED_ORIGINS) and a
JSON content type, which the backend requires.
"""
import argparse
import http.client
import json
import random
import statistics
import sys
import threading
import time
import urllib.parse

ARGS = None
FAILURES = []  # correctness failures: (check, detail)
SERVER_ERRORS = []  # 5xx and transport errors seen anywhere


def check(name, ok, detail=""):
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f"  ({detail})" if detail and not ok else ""))
    if not ok:
        FAILURES.append((name, detail))


class Client:
    """One keep-alive connection. Not shared between threads."""

    def __init__(self):
        u = urllib.parse.urlparse(ARGS.base)
        self.host, self.port = u.hostname, u.port or 80
        self.conn = None
        self.last_session_cookie = None  # lr_session value set by the latest response, if any
        self.last_set_cookies = []  # every Set-Cookie header of the latest response
        self.last_headers = {}  # lower-cased response headers of the latest response

    def _connect(self):
        self.conn = http.client.HTTPConnection(self.host, self.port, timeout=ARGS.timeout)

    def call(self, method, path, body=None, token=None, raw=None, headers=None, browser=True):
        """Returns (status, json_or_None, latency_ms). Status 0 means the transport failed.

        `token` is the lr_session cookie value. `browser=True` makes state-changing requests look like a browser's own:
        an Origin and a JSON content type (also on body-less ones). `headers` are added last and win."""
        hdrs = {"Accept": "application/json"}
        data = None
        if raw is not None:
            data = raw
            hdrs["Content-Type"] = "application/json"
        elif body is not None:
            data = json.dumps(body)
            hdrs["Content-Type"] = "application/json"
        if browser and method in ("POST", "PUT", "PATCH", "DELETE"):
            hdrs.setdefault("Content-Type", "application/json")
            hdrs["Origin"] = ARGS.origin
        if token:
            hdrs["Cookie"] = "lr_session=" + token
        if headers:
            hdrs.update(headers)
        headers = hdrs
        self.last_session_cookie, self.last_set_cookies, self.last_headers = None, [], {}
        start = time.perf_counter()
        for attempt in (0, 1):
            try:
                if self.conn is None:
                    self._connect()
                self.conn.request(method, path, body=data, headers=headers)
                r = self.conn.getresponse()
                payload = r.read()
                ms = (time.perf_counter() - start) * 1000
                self.last_set_cookies = r.msg.get_all("Set-Cookie") or []
                self.last_headers = {k.lower(): v for k, v in r.getheaders()}
                for c in self.last_set_cookies:
                    if c.startswith("lr_session=") and c.split(";")[0] != "lr_session=":
                        self.last_session_cookie = c.split(";")[0][len("lr_session="):]
                try:
                    js = json.loads(payload) if payload else None
                except ValueError:
                    js = None
                if r.status >= 500:
                    SERVER_ERRORS.append((method, path, r.status, payload[:120]))
                return r.status, js, ms
            except (OSError, http.client.HTTPException) as e:
                self.conn = None
                if attempt == 1:
                    SERVER_ERRORS.append((method, path, 0, repr(e)[:120]))
                    return 0, None, (time.perf_counter() - start) * 1000
        return 0, None, 0.0


def login(client, email, password):
    s, js, ms = client.call("POST", "/api/auth/login", {"email": email, "password": password})
    return s, client.last_session_cookie, ms


KEEPER = "stress.keeper@example.org"


def ensure_keeper():
    """The bootstrap ADMIN_EMAIL can never be added again as a normal admin (by design, as in the Node app), so the
    duel test could not restore it. Use a separate admin the tests are free to remove and re-create: sign in as the
    bootstrap admin once, add the keeper, remove the bootstrap admin, and from then on run everything as the keeper."""
    c = Client()
    if login(c, KEEPER, ARGS.admin_password)[1]:
        ARGS.admin_email = KEEPER
        return
    s, boot_tok, _ = login(c, ARGS.admin_email, ARGS.admin_password)
    if not boot_tok:
        sys.exit(f"cannot sign in as {ARGS.admin_email} and the keeper does not exist yet (status {s}); reset the database")
    s, js, _ = c.call("POST", "/api/admin/admins", {"email": KEEPER, "password": ARGS.admin_password}, token=boot_tok)
    if s != 201:
        sys.exit(f"could not create the keeper admin: {s} {js}")
    # an admin can't remove themselves, so the keeper removes the bootstrap admin
    _, keeper_tok, _ = login(c, KEEPER, ARGS.admin_password)
    admins = c.call("GET", "/api/admin/admins", token=keeper_tok)[1]["admins"]
    for a in admins:
        if a["email"] == ARGS.admin_email:
            s, _, _ = c.call("DELETE", f"/api/admin/admins/{a['id']}", token=keeper_tok)
            if s != 200:
                sys.exit(f"could not remove the bootstrap admin: {s}")
    ARGS.admin_email = KEEPER
    print(f"  (ran as {KEEPER}; the bootstrap admin was replaced by it, which also exercised removing an admin)")


def pct(sorted_ms, p):
    return sorted_ms[min(len(sorted_ms) - 1, int(len(sorted_ms) * p))] if sorted_ms else float("nan")


def summarize(label, samples, seconds, expect=None):
    """samples: list of (status, ms). Prints one row and returns (rps, p95, bad)."""
    n = len(samples)
    ms = sorted(m for _, m in samples)
    codes = {}
    for s, _ in samples:
        codes[s] = codes.get(s, 0) + 1
    bad = sum(c for s, c in codes.items() if (expect is not None and s not in expect) or s == 0 or s >= 500)
    print(f"  {label:<26} {n/seconds:8.1f} req/s   p50 {pct(ms,.5):7.1f}  p95 {pct(ms,.95):7.1f}  p99 {pct(ms,.99):7.1f}  max {ms[-1] if ms else 0:8.1f} ms   "
          f"{'ok' if bad == 0 else f'UNEXPECTED {bad}'}  {dict(sorted(codes.items()))}")
    return n / seconds, pct(ms, .95), bad


def run_threads(n, fn, seconds):
    stop = time.monotonic() + seconds
    results = [[] for _ in range(n)]
    threads = [threading.Thread(target=fn, args=(i, stop, results[i])) for i in range(n)]
    start = time.perf_counter()
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    elapsed = time.perf_counter() - start
    return [s for r in results for s in r], elapsed


# ------------------------------------------------------------------------------------------------ load

def load_login(levels, seconds):
    print(f"\n== LOAD: sign-in (scrypt, one per request), {seconds}s per level, mix of admin and employees")
    emp = [f"emp{i}@gmail.com" for i in range(1, ARGS.employees + 1)]

    def worker(i, stop, out):
        c = Client()
        while time.monotonic() < stop:
            if random.random() < 0.1:
                s, _, ms = c.call("POST", "/api/auth/login", {"email": ARGS.admin_email, "password": ARGS.admin_password})
            else:
                s, _, ms = c.call("POST", "/api/auth/login", {"email": random.choice(emp), "password": ARGS.employee_password})
            out.append((s, ms))

    table = []
    for n in levels:
        samples, el = run_threads(n, worker, seconds)
        table.append((n,) + summarize(f"{n} concurrent", samples, el, expect={200}))
    return table


def load_reads(levels, seconds):
    print(f"\n== LOAD: signed-in traffic, {seconds}s per level (70% /me, 15% admin list as admin, 15% admin list as employee -> 403)")
    c0 = Client()
    _, admin_tok, _ = login(c0, ARGS.admin_email, ARGS.admin_password)
    emp_toks = []
    for i in range(1, min(ARGS.employees, 20) + 1):
        _, t, _ = login(c0, f"emp{i}@gmail.com", ARGS.employee_password)
        emp_toks.append(t)

    violations = []

    def worker(i, stop, out):
        c = Client()
        while time.monotonic() < stop:
            r = random.random()
            if r < 0.7:
                tok = admin_tok if random.random() < 0.3 else random.choice(emp_toks)
                s, _, ms = c.call("GET", "/api/auth/me", token=tok)
                if s != 200:
                    violations.append(("me", s))
            elif r < 0.85:
                s, _, ms = c.call("GET", "/api/admin/admins", token=admin_tok)
                if s != 200:
                    violations.append(("admin list as admin", s))
            else:
                s, _, ms = c.call("GET", "/api/admin/admins", token=random.choice(emp_toks))
                if s != 403:
                    violations.append(("admin list as employee", s))
            out.append((s, ms))

    table = []
    for n in levels:
        violations.clear()
        samples, el = run_threads(n, worker, seconds)
        table.append((n,) + summarize(f"{n} concurrent", samples, el, expect={200, 403}))
        check(f"{n} concurrent: every response was the right one (employees always 403 on admin routes)", not violations, str(violations[:3]))
    return table


# ------------------------------------------------------------------------------------------------ races

def race_same_email_admin(n=60):
    print(f"\n== RACE: {n} concurrent attempts to add the same admin email")
    c0 = Client()
    _, tok, _ = login(c0, ARGS.admin_email, ARGS.admin_password)
    email = f"dup{int(time.time())}@race.example".lower()
    barrier = threading.Barrier(n)
    results = []

    def go(i):
        c = Client()
        barrier.wait()
        results.append(c.call("POST", "/api/admin/admins", {"email": email, "password": "race-pass-1"}, token=tok)[:2])

    ts = [threading.Thread(target=go, args=(i,)) for i in range(n)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    codes = sorted(s for s, _ in results)
    check("exactly one 201", codes.count(201) == 1, str({c: codes.count(c) for c in set(codes)}))
    check("every other attempt is a clean 422 'already uses this email'", codes.count(422) == n - 1, str({c: codes.count(c) for c in set(codes)}))
    s, js, _ = c0.call("GET", "/api/admin/admins", token=tok)
    check("only one such admin exists afterwards", sum(1 for a in js["admins"] if a["email"] == email) == 1)
    # clean up
    for a in js["admins"]:
        if a["email"] == email:
            c0.call("DELETE", f"/api/admin/admins/{a['id']}", token=tok)


def race_add_remove_many(n=40):
    print(f"\n== RACE: add {n} distinct admins at once, then remove them all at once")
    c0 = Client()
    _, tok, _ = login(c0, ARGS.admin_email, ARGS.admin_password)
    before = c0.call("GET", "/api/admin/admins", token=tok)[1]["admins"]
    stamp = int(time.time())
    adds = []

    def add(i):
        adds.append(Client().call("POST", "/api/admin/admins", {"email": f"bulk{stamp}-{i}@race.example", "password": "race-pass-1"}, token=tok)[0])

    ts = [threading.Thread(target=add, args=(i,)) for i in range(n)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    check(f"all {n} adds succeed", adds.count(201) == n, str({c: adds.count(c) for c in set(adds)}))
    mid = c0.call("GET", "/api/admin/admins", token=tok)[1]["admins"]
    check("list shows all of them", len(mid) == len(before) + n, f"{len(mid)} vs {len(before)+n}")
    ids = [a["id"] for a in mid if a["email"].startswith(f"bulk{stamp}-")]
    dels = []

    def rm(i):
        dels.append(Client().call("DELETE", f"/api/admin/admins/{i}", token=tok)[0])

    ts = [threading.Thread(target=rm, args=(i,)) for i in ids]
    [t.start() for t in ts]
    [t.join() for t in ts]
    check(f"all {n} removals succeed", dels.count(200) == n, str({c: dels.count(c) for c in set(dels)}))
    after = c0.call("GET", "/api/admin/admins", token=tok)[1]["admins"]
    check("back to the original admins", sorted(a["id"] for a in after) == sorted(a["id"] for a in before))


def race_last_admin(rounds=15):
    print(f"\n== RACE: two admins remove each other at the same instant, {rounds} rounds")
    c0 = Client()
    _, root_tok, _ = login(c0, ARGS.admin_email, ARGS.admin_password)
    others = [a for a in c0.call("GET", "/api/admin/admins", token=root_tok)[1]["admins"] if a["email"] != ARGS.admin_email]
    check("starting from exactly one admin", not others, f"found {len(others)} extra admins")
    if others:
        print("  (skipping the duel: it needs exactly one admin to start from)")
        return
    bad, zero_seen, outcomes = [], False, {}
    for r in range(rounds):
        c0 = Client()
        _, root_tok, _ = login(c0, ARGS.admin_email, ARGS.admin_password)
        e1, e2 = f"duela{r}-{int(time.time()*1000)}@race.example", f"duelb{r}-{int(time.time()*1000)}@race.example"
        for e in (e1, e2):
            c0.call("POST", "/api/admin/admins", {"email": e, "password": "race-pass-1"}, token=root_tok)
        _, t1, _ = login(Client(), e1, "race-pass-1")
        _, t2, _ = login(Client(), e2, "race-pass-1")
        ids = {a["email"]: a["id"] for a in c0.call("GET", "/api/admin/admins", token=root_tok)[1]["admins"]}
        # take the original admin out, so only the two duellists remain
        s0, _, _ = Client().call("DELETE", f"/api/admin/admins/{ids[ARGS.admin_email]}", token=t1)
        barrier = threading.Barrier(2)
        out = {}

        def kill(name, tok, target):
            barrier.wait()
            out[name] = Client().call("DELETE", f"/api/admin/admins/{target}", token=tok)[0]

        ta = threading.Thread(target=kill, args=("a", t1, ids[e2]))
        tb = threading.Thread(target=kill, args=("b", t2, ids[e1]))
        ta.start(); tb.start(); ta.join(); tb.join()
        # Allowed: one 200 and the other 409 (last admin) or 401 (the winner already removed the loser, so the
        # loser's own session is gone). Never two 200s, and never zero admins left.
        codes = sorted(out.values())
        outcomes[tuple(codes)] = outcomes.get(tuple(codes), 0) + 1
        survivor_tok = t1 if out["a"] == 200 else (t2 if out["b"] == 200 else None)
        survivors = Client().call("GET", "/api/admin/admins", token=survivor_tok)[1]["admins"] if survivor_tok else []
        if s0 != 200 or codes.count(200) != 1 or codes[0] != 200 or codes[1] not in (401, 409) or len(survivors) != 1:
            bad.append((s0, codes, len(survivors)))
        if not survivors:
            zero_seen = True
            break
        # restore: the survivor re-adds the original admin, who then removes the survivor
        c1 = Client()
        c1.call("POST", "/api/admin/admins", {"email": ARGS.admin_email, "password": ARGS.admin_password}, token=survivor_tok)
        _, root_tok, _ = login(c1, ARGS.admin_email, ARGS.admin_password)
        for a in c1.call("GET", "/api/admin/admins", token=root_tok)[1]["admins"]:
            if a["email"] != ARGS.admin_email:
                c1.call("DELETE", f"/api/admin/admins/{a['id']}", token=root_tok)
    print(f"  outcomes (winner, loser): {outcomes}")
    check("every round: exactly one removal wins, the other is refused (409 last admin, or 401 session gone)", not bad, str(bad[:3]))
    check("the admins table never became empty", not zero_seen)
    _, root_tok, _ = login(Client(), ARGS.admin_email, ARGS.admin_password)
    final = Client().call("GET", "/api/admin/admins", token=root_tok)[1]["admins"]
    check("after all rounds only the original admin is left", [a["email"] for a in final] == [ARGS.admin_email], str([a["email"] for a in final]))


def race_password_change(n=12):
    print(f"\n== RACE: {n} concurrent password changes for the same employee, and a session that must die")
    email = "emp1@gmail.com"
    _, tok, _ = login(Client(), email, ARGS.employee_password)
    barrier = threading.Barrier(n)
    results = {}

    def change(i):
        barrier.wait()
        results[i] = Client().call("POST", "/api/account/password",
                                   {"current": ARGS.employee_password, "next": f"changed-pass-{i}", "confirm": f"changed-pass-{i}"}, token=tok)[:2]

    ts = [threading.Thread(target=change, args=(i,)) for i in range(n)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    codes = sorted(s for s, _ in results.values())
    check("no 5xx; each change is 200, 401 (session already replaced) or 422", all(c in (200, 401, 422) for c in codes), str(codes))
    check("at least one change won", 200 in codes, str(codes))
    winners = [i for i in range(n) if Client().call("POST", "/api/auth/login", {"email": email, "password": f"changed-pass-{i}"})[0] == 200]
    check("exactly one of the new passwords works afterwards", len(winners) == 1, f"{winners}")
    check("the old password no longer works", login(Client(), email, ARGS.employee_password)[0] != 200)
    check("the old session token is dead", Client().call("GET", "/api/auth/me", token=tok)[0] == 401)
    # put it back so the pool of employees stays usable
    if winners:
        _, t2, _ = login(Client(), email, f"changed-pass-{winners[0]}")
        s, js, _ = Client().call("POST", "/api/account/password", {"current": f"changed-pass-{winners[0]}", "next": ARGS.employee_password, "confirm": ARGS.employee_password}, token=t2)
        check("password restored for later tests", s == 200, str(s))


def race_session_dies_under_load():
    print("\n== RACE: a removed admin's token must stop working immediately, even while it is being hammered")
    c0 = Client()
    _, root, _ = login(c0, ARGS.admin_email, ARGS.admin_password)
    email = f"victim{int(time.time())}@race.example"
    c0.call("POST", "/api/admin/admins", {"email": email, "password": "race-pass-1"}, token=root)
    _, vtok, _ = login(Client(), email, "race-pass-1")
    vid = [a["id"] for a in c0.call("GET", "/api/admin/admins", token=root)[1]["admins"] if a["email"] == email][0]
    removed_at = [None]
    late_200 = []
    stop = threading.Event()

    def hammer():
        c = Client()
        while not stop.is_set():
            started = time.monotonic()
            s, _, _ = c.call("GET", "/api/auth/me", token=vtok)
            if s == 200 and removed_at[0] is not None and started > removed_at[0]:
                late_200.append(started)

    ts = [threading.Thread(target=hammer) for _ in range(20)]
    [t.start() for t in ts]
    time.sleep(1.0)
    s, _, _ = c0.call("DELETE", f"/api/admin/admins/{vid}", token=root)
    removed_at[0] = time.monotonic()
    time.sleep(1.5)
    stop.set()
    [t.join() for t in ts]
    check("removal succeeded", s == 200, str(s))
    check("no request that started after the removal was still accepted", not late_200, f"{len(late_200)} late 200s")


# ------------------------------------------------------------------------------------------------ limits

def limits_hostile_input():
    print("\n== LIMITS: hostile and malformed input")
    c = Client()
    s, _, _ = c.call("POST", "/api/auth/login", raw="{not json")
    check("invalid JSON -> 400, not 5xx", s == 400, str(s))
    s, _, _ = c.call("POST", "/api/auth/login", raw="[1,2,3]")
    check("JSON that is not an object -> clean 4xx", 400 <= s < 500, str(s))
    s, _, _ = c.call("POST", "/api/auth/login", {"email": 5, "password": ["x"]})
    check("wrong JSON types -> generic 401", s == 401, str(s))
    big = "x" * 900_000
    start = time.perf_counter()
    s, _, ms = c.call("POST", "/api/auth/login", {"email": "emp1@gmail.com", "password": big})
    check("900 KB password -> 401 in under 3 s", s == 401 and ms < 3000, f"{s} in {ms:.0f} ms")
    s, _, _ = c.call("POST", "/api/auth/login", raw=json.dumps({"email": "a@b.c", "password": "x" * 3_000_000}))
    check("3 MB body is refused by the proxy (413), the backend never sees it", s in (413, 0), str(s))
    s, _, _ = c.call("GET", "/api/admin/admins/../../etc/passwd")
    check("path traversal -> 404, not 5xx", s in (400, 404), str(s))
    s, _, _ = c.call("GET", "/api/admin/admins", token="a." * 5000)
    check("a 10 KB garbage token -> refused (401 from the backend, or 400/431 from the proxy), never 5xx", s in (400, 401, 431), str(s))
    s, js, _ = c.call("POST", "/api/auth/login", {"email": "' or 1=1 --", "password": "x"})
    check("SQL-looking email -> generic 401", s == 401, str(s))
    s, js, _ = c.call("POST", "/api/auth/login", {"email": "emp1@gmail.com", "password": "wrong"})
    check("a failed sign-in never says why (same generic message)", js and js.get("error") == "Incorrect email or password.", str(js))
    s, _, _ = c.call("DELETE", "/api/admin/admins/not-a-uuid", token=login(c, ARGS.admin_email, ARGS.admin_password)[1])
    check("a made-up admin id -> clean 409, not 5xx", s == 409, str(s))


def limits_session_rules():
    print("\n== LIMITS: the cookie session and the CSRF rules")
    EVIL = "https://evil.example"
    c = Client()
    s, tok, _ = login(c, ARGS.admin_email, ARGS.admin_password)
    check("sign-in succeeds and sets the lr_session cookie", s == 200 and bool(tok), f"status {s}")
    set_cookie = next((x for x in c.last_set_cookies if x.startswith("lr_session=")), "")
    for attr in ("HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=604800"):
        check(f"the cookie has {attr}", attr in set_cookie, set_cookie[:60])
    want_secure = ARGS.cookie_secure == "true"
    check(f"the cookie is {'' if want_secure else 'not '}Secure, as COOKIE_SECURE says", ("Secure" in set_cookie) == want_secure, set_cookie[-40:])

    c2 = Client()
    s, js, _ = c2.call("POST", "/api/auth/login", {"email": ARGS.admin_email, "password": ARGS.admin_password})
    check("the response body carries the user and no token", s == 200 and "token" not in (js or {}) and "user" in (js or {}), str(js)[:80])

    s, _, _ = Client().call("GET", "/api/auth/me", headers={"Authorization": "Bearer " + tok})
    check("the token as a Bearer header no longer signs anyone in (401)", s == 401, str(s))
    check("the same token as the cookie does", Client().call("GET", "/api/auth/me", token=tok)[0] == 200)

    cx = Client()
    s, _, _ = cx.call("POST", "/api/auth/login", {"email": ARGS.admin_email, "password": ARGS.admin_password}, headers={"Origin": EVIL})
    check("sign-in from a foreign Origin -> 403 and no cookie", s == 403 and not cx.last_set_cookies, f"{s} {cx.last_set_cookies}")
    victim = f"csrf{int(time.time())}@race.example"
    s, _, _ = Client().call("POST", "/api/admin/admins", {"email": victim, "password": "race-pass-1"}, token=tok, headers={"Origin": EVIL})
    check("adding an admin from a foreign Origin, with a valid cookie -> 403", s == 403, str(s))
    listed = Client().call("GET", "/api/admin/admins", token=tok)[1]["admins"]
    check("...and nothing was created", not any(a["email"] == victim for a in listed))
    s, _, _ = Client().call("POST", "/api/admin/admins", {"email": victim, "password": "race-pass-1"}, token=tok, headers={"Origin": "null"})
    check("Origin: null -> 403", s == 403, str(s))
    s, _, _ = Client().call("POST", "/api/auth/login", raw=json.dumps({"email": "a@b.c", "password": "x"}), headers={"Content-Type": "text/plain"})
    check("a text/plain POST (what a cross-site form can send) -> 415", s == 415, str(s))
    s, _, _ = Client().call("POST", "/api/auth/login", raw="email=a&password=b", headers={"Content-Type": "application/x-www-form-urlencoded"})
    check("a form-encoded POST -> 415", s == 415, str(s))
    s, _, _ = Client().call("DELETE", "/api/admin/admins/00000000-0000-4000-8000-000000000001", token=tok, headers={"Content-Type": ""})
    check("a DELETE with no JSON content type -> 415, not executed", s == 415, str(s))

    cc = Client()
    s, _, _ = cc.call("POST", "/api/auth/login", {"email": "x@y.z", "password": "x"}, headers={"Origin": EVIL})
    check("no Access-Control-* header is ever sent", not [h for h in cc.last_headers if h.startswith("access-control-")], str(cc.last_headers))
    s, _, _ = Client().call("OPTIONS", "/api/auth/login", headers={"Origin": EVIL, "Access-Control-Request-Method": "POST"})
    check("a CORS preflight is not granted", s != 200 and s < 500, str(s))

    cl = Client()
    s, _, _ = cl.call("POST", "/api/auth/logout", token=tok)
    cleared = next((x for x in cl.last_set_cookies if x.startswith("lr_session=")), "")
    check("logout -> 204 and expires the cookie", s == 204 and "Max-Age=0" in cleared and cleared.startswith("lr_session=;"), f"{s} {cleared[:60]}")


def limits_burst_and_recovery(n=300):
    print(f"\n== LIMITS: {n} sign-ins in the same instant, then recovery")
    emp = [f"emp{random.randint(1, ARGS.employees)}@gmail.com" for _ in range(n)]
    barrier = threading.Barrier(n)
    res = []

    def go(i):
        c = Client()
        barrier.wait()
        s, _, ms = c.call("POST", "/api/auth/login", {"email": emp[i], "password": ARGS.employee_password})
        res.append((s, ms))

    ts = [threading.Thread(target=go, args=(i,)) for i in range(n)]
    start = time.perf_counter()
    [t.start() for t in ts]
    [t.join() for t in ts]
    el = time.perf_counter() - start
    summarize(f"{n}-way burst", res, el, expect={200})
    ok = sum(1 for s, _ in res if s == 200)
    check(f"all {n} burst sign-ins eventually succeed (slow is fine, failing is not)", ok == n, f"{ok}/{n}")
    s, _, ms = Client().call("GET", "/api/health")
    check("health answers right after the burst", s == 200 and ms < 1000, f"{s} {ms:.0f} ms")
    s, tok, ms = login(Client(), ARGS.admin_email, ARGS.admin_password)
    check("a normal sign-in is back to normal speed after the burst", s == 200 and ms < 1500, f"{s} {ms:.0f} ms")


def failed_login_flood(seconds=5, threads=16):
    print(f"\n== FINDING: failed sign-ins are not rate limited ({threads} threads, {seconds}s of wrong passwords)")

    def worker(i, stop, out):
        c = Client()
        while time.monotonic() < stop:
            s, _, ms = c.call("POST", "/api/auth/login", {"email": f"emp{random.randint(1, ARGS.employees)}@gmail.com", "password": "definitely-wrong"})
            out.append((s, ms))

    samples, el = run_threads(threads, worker, seconds)
    rps, p95, bad = summarize("wrong-password flood", samples, el, expect={401})
    print(f"  -> {len(samples)} guesses in {el:.0f}s ({rps:.0f}/s) and none were throttled or locked out (same as the Node app).")


def soak(seconds, clients):
    print(f"\n== SOAK: {clients} clients, mixed traffic for {seconds}s (20% sign-in, 70% /me, 10% admin list)")
    c0 = Client()
    _, admin_tok, _ = login(c0, ARGS.admin_email, ARGS.admin_password)
    _, emp_tok, _ = login(c0, "emp2@gmail.com", ARGS.employee_password)

    def worker(i, stop, out):
        c = Client()
        while time.monotonic() < stop:
            r = random.random()
            if r < 0.2:
                s, _, ms = c.call("POST", "/api/auth/login", {"email": f"emp{random.randint(1, ARGS.employees)}@gmail.com", "password": ARGS.employee_password})
            elif r < 0.9:
                s, _, ms = c.call("GET", "/api/auth/me", token=random.choice([admin_tok, emp_tok]))
            else:
                s, _, ms = c.call("GET", "/api/admin/admins", token=admin_tok)
            out.append((s, ms))

    samples, el = run_threads(clients, worker, seconds)
    rps, p95, bad = summarize("soak", samples, el, expect={200})
    check("soak: zero errors", bad == 0, f"{bad} bad of {len(samples)}")
    # a second window to see whether latency drifted
    return rps, p95


def main():
    global ARGS
    p = argparse.ArgumentParser()
    p.add_argument("--base", default="http://localhost:8088")
    p.add_argument("--admin-email", required=True)
    p.add_argument("--admin-password", required=True)
    p.add_argument("--employee-password", required=True)
    p.add_argument("--employees", type=int, default=200, help="employees emp1@gmail.com .. empN@gmail.com share the password")
    p.add_argument("--origin", default=None, help="the Origin sent on state-changing requests; default: --base. Must be in ALLOWED_ORIGINS")
    p.add_argument("--cookie-secure", choices=["true", "false"], default="true", help="what the backend's COOKIE_SECURE is set to")
    p.add_argument("--timeout", type=float, default=60)
    p.add_argument("--seconds", type=float, default=8, help="seconds per load level")
    p.add_argument("--soak", type=float, default=60)
    p.add_argument("--levels", default="1,4,8,16,32,64,128", help="concurrency levels for the sign-in ladder")
    p.add_argument("--only", default="", help="comma list of: login,reads,races,limits,soak")
    ARGS = p.parse_args()
    ARGS.origin = (ARGS.origin or ARGS.base).rstrip("/")
    want = set(filter(None, ARGS.only.split(","))) or {"login", "reads", "races", "limits", "soak"}
    t0 = time.time()
    print(f"target {ARGS.base}; {ARGS.employees} employees; admin {ARGS.admin_email}")
    s, js, _ = Client().call("GET", "/api/health")
    if s != 200:
        sys.exit(f"health check failed: {s}")
    ensure_keeper()

    if "login" in want:
        load_login([int(x) for x in ARGS.levels.split(",")], ARGS.seconds)
    if "reads" in want:
        load_reads([10, 50, 100, 200], ARGS.seconds)
    def guarded(fn, *a):
        """A crash in one scenario is a failure, not the end of the run."""
        try:
            fn(*a)
        except Exception as e:  # noqa: BLE001
            import traceback
            traceback.print_exc()
            check(f"{fn.__name__} ran to the end", False, repr(e)[:200])

    if "races" in want:
        for fn in (race_same_email_admin, race_add_remove_many, race_password_change, race_session_dies_under_load, race_last_admin):
            guarded(fn)
    if "limits" in want:
        for fn in (limits_hostile_input, limits_session_rules, limits_burst_and_recovery, failed_login_flood):
            guarded(fn)
    if "soak" in want:
        guarded(soak, ARGS.soak, 40)

    print("\n== SUMMARY")
    print(f"  correctness checks failed: {len(FAILURES)}")
    for name, detail in FAILURES:
        print(f"    - {name}: {detail}")
    print(f"  5xx / transport errors seen: {len(SERVER_ERRORS)}")
    for e in SERVER_ERRORS[:10]:
        print(f"    - {e}")
    print(f"  total time {time.time()-t0:.0f}s")
    sys.exit(1 if FAILURES or SERVER_ERRORS else 0)


if __name__ == "__main__":
    main()
