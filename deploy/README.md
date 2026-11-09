# Deploying the rebuild (React + Helidon)

Two images, one compose file.

| Image | What it is | Size |
|---|---|---|
| `lumiether-web` | nginx serving the React (Vite) build, and proxying `/api` to the backend. **The only thing the outside world talks to.** | not built yet (see below) |
| `lumiether-backend` | The Helidon server (Java 21, non-root). Applies `db/migrations` on start when `RUN_MIGRATIONS=1`. | ~237 MB |

Postgres is not in an image: use your Neon database (or any Postgres). The PDF service (`lumiether-pdf`, from `pdf-service/Dockerfile`) is in the compose file on an internal network, pinned by `PDF_IMAGE_TAG`;
the backend has no payslip code until the payslip phase, so nothing calls it yet.

## What this contains, and what it does not

**The backend, Phase 1 only:** sign-in, sign-out, change password, add and remove admins (a JSON API). There is
**no** employee management, leave, comp-off, permissions or payslips in it yet (Phases 2 to 4).

**There is no web UI at the moment.** The React frontend (a Vite project in `frontend/`) has not been built, so the
`lumiether-web` image cannot be built and `docker compose up` will stop at the web service. The backend image builds
and runs on its own. Do not point real users at any of this as a replacement for the current app.

## Build

```bash
./deploy/build.sh          # backend jar + image; also the frontend and the web image once frontend/ exists
```

It tags the images with the git short sha (plus `-dirty` if the tree has uncommitted changes) and `latest`. The
frontend is built with the API on the **same origin** (nginx proxies `/api`), so no API address is baked in. Any
`lumiether-web` image you already have was built from a previous frontend and is out of date.

## Run

```bash
cp deploy/.env.example deploy/.env      # fill in DATABASE_URL, SESSION_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD_HASH
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d
# or with a throwaway local Postgres:
docker compose -f deploy/docker-compose.yml --env-file deploy/.env --profile local-db up -d
```

Open `http://<host>:8088`. `GET /api/health` answers `{"status":"ok"}` (GET and HEAD).

* `LR_COOKIE_SECRET`: 32+ random characters (`openssl rand -base64 48`) that sign the `lr_session` cookie. Without it
  nobody can sign in. It must be a different value from the current app's `SESSION_SECRET`, which is **retired for the
  rebuild**: the backend does not read it and compose does not pass it (it stays in `.env.example`, marked retired).
  Because the cookie's name and secret differ from the current app's, everyone signs in again at cutover.
* `ALLOWED_ORIGINS`: the public address(es) of the web container, comma separated (for example
  `https://leave.example.com`). POST, PUT, PATCH and DELETE requests from any other origin are refused with 403, and
  they must be JSON (415 otherwise). Compose has no default, so a missing value stops `docker compose up`. With
  `COOKIE_SECURE=true` the backend refuses to start if the list holds `localhost`, `127.0.0.1` or `[::1]`. For a local
  run on plain http set `COOKIE_SECURE=false` and `ALLOWED_ORIGINS=http://localhost:8088`.
* `COOKIE_SECURE` (default true): adds `Secure` to the cookie. Leave it on behind TLS.
* `ADMIN_EMAIL` / `ADMIN_PASSWORD_HASH`: bootstrap only. While the database has **no admins**, that account can sign
  in once and is saved as an ordinary admin. Make the hash with `printf '%s' 'password' | node scripts/hash-password.mjs`.
  The existing hashes in your Neon database work unchanged (same scrypt format).
* Migrations are the same files and the same `schema_migrations` table the Node app uses, so running either
  tool first is fine and nothing is applied twice.

## Running it in the cloud

1. **Push the images** to a registry the VM can pull from (nothing here pushes for you):
   ```bash
   docker tag lumiether-backend:latest  <registry>/lumiether-backend:<tag>
   docker tag lumiether-web:latest      <registry>/lumiether-web:<tag>
   docker push <registry>/lumiether-backend:<tag>
   docker push <registry>/lumiether-web:<tag>
   ```
   Or build on the VM itself (`./deploy/build.sh` needs Java 21, Maven and, for the web image, Node there), or copy with
   `docker save | ssh vm docker load`.
2. **Copy `docker-compose.yml` and `.env` to the VM**, change the two `image:` lines to the registry names (and
   drop the `build:` lines), then `docker compose up -d`.
3. **Behind Traefik:** replace the web service's `ports:` with the commented `labels:` block in the compose file
   and use the VM's entrypoint, network and cert-resolver names. Only `web` needs to be reachable.
4. **HTTPS is required.** Sign-in sends the password, and the session is a signed token in an `httpOnly`, `Secure`
   cookie (`lr_session`). Terminate TLS at Traefik / the load balancer, and put the public https address in
   `ALLOWED_ORIGINS`.
5. **Database:** use Neon's *pooled* connection string. The backend keeps at most 5 connections.
6. **Cron** (the monthly payslip job) arrives with the payslip phase; its endpoint and secret check are not in
   the backend yet.

## Sizing (measured, see the results below)

* **Memory:** the backend peaked at about **210 MiB** under the heaviest load. A 512 MB limit survived cold-start
  sign-in bursts in testing; **768 MB to 1 GB is comfortable** and is what compose defaults to (`BACKEND_MEMORY`,
  default `1g`). **Set the limit when the container is created** (compose does), never afterwards with
  `docker update`: the JVM sizes its heap from the limit it sees at start, and a limit added later lets it grow
  past the container and get killed. (That is exactly how the first stress runs killed the backend.)
* **CPU:** signing in hashes the password with scrypt, which is deliberately expensive: **about 14 sign-ins per
  second per CPU core** measured (28 per second on 2 cores). Concurrent hashes are capped at the core count (2 to
  4), like Node's thread pool, so a burst queues instead of using unbounded memory. Everything else (signed-in
  requests) is cheap: about **3,400 requests per second** on the same 2 cores. A 5-person internal tool needs a
  tiny fraction of this.
* **Scaling out:** the backend keeps no state in memory (sessions are signed tokens re-checked against the
  database on each request), so several replicas behind the same web container would work if ever needed.
* **Failed sign-ins are not rate limited** (same as the Node app): about 30 wrong guesses per second were accepted
  per 2 cores with no lockout. Put a limit at the proxy / load balancer if the app is reachable from the internet.

## Stress test

`deploy/stress/stress.py` (standard library only) drives the whole path through nginx. Seed 200 employees that
share one password with SQL (there is no add-employee endpoint until Phase 2), then:

```bash
python3 deploy/stress/stress.py --base http://localhost:8088 \
  --admin-email boss@example.com --admin-password '...' --employee-password '...' --employees 200
```

It runs sign-in load ladders, signed-in traffic, concurrency races, hostile input, a 300-way burst and a soak,
and exits non-zero on any failed check or any 5xx. It changes data (it adds and removes admins and changes one
employee's password, restoring it), so point it at a test database.

### Results (backend limited to 2 CPUs and 768 MiB, set at container creation; 200 employees; via nginx)

Measured through the nginx proxy in front of an earlier frontend build; the numbers are for the API and are unaffected
by which frontend is served.

| Check | Result |
|---|---|
| Sign-in ladder, 1 to 128 concurrent | all succeed; throughput flat at about 28/s (CPU-bound); p50 58 ms alone, 3.2 s at 128 concurrent |
| Signed-in traffic, 10 to 200 concurrent | 1,900 to 3,500 req/s; p95 under 135 ms; employees always got 403 on admin routes |
| Same admin email added by 60 at once | exactly one 201, 59 clean 422s |
| 40 admins added at once, then removed at once | all succeed, back to the original list |
| 12 concurrent password changes | no 5xx; exactly one new password works; old password and old session dead |
| Removed admin hammered by 20 clients | no request that started after the removal was accepted |
| Two admins remove each other, 15 rounds | every round exactly one winner (200) and one 409; never zero admins |
| Hostile input (bad JSON, 900 KB password, 3 MB body, garbage tokens, SQL-looking email, made-up ids) | all clean 4xx; none 5xx |
| 300 sign-ins in the same instant | all 300 succeed (queued, up to 10 s); health and normal sign-in fine right after |
| 60 s soak, 40 clients mixed traffic | 8,980 requests, zero errors |
| Whole run | 0 failed checks, 0 5xx, 0 restarts, backend peak 209 MiB, web 18 MiB, Postgres 40 MiB |

