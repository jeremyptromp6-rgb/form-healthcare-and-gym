# FORM — release readiness (Stage Q)

Audit date: 2026-10-02. Scope: API (`apps/api`), domain (`packages/domain`), app (`apps/mobile`, web build
verified in a browser; iOS/Android not run on devices).

**Status: NOT READY FOR RELEASE** — every code-level P0/P1 found is fixed; the remaining blockers
need the operator (store, legal, providers, infrastructure) or new native work. See "Release blockers".

## Findings register

| ID | Sev | Area | Finding | Status |
|---|---|---|---|---|
| Q-01 | P0 | Security / deps | `@fastify/jwt` ≤ 9.1 pulled in `fast-jwt` ≤ 6.2.3 with 2 critical advisories (incl. auth bypass with an empty HMAC secret, claim cache confusion). | **Fixed**: `@fastify/jwt` 10.2.2 with `fast-jwt` 6.3.4 (the moderate ≤ 6.3.3 advisory is fixed too); `npm audit --omit=dev` at the repo root reports 0 vulnerabilities. Forged / unsigned / wrong-secret / wrong-algorithm / tampered / expired tokens tested. |
| Q-02 | P0 | Release | iOS/Android builds have no native pose module: camera-verified reps — the core Train promise — work only in the web app. Phones log sets honestly as unverified. | **Open** (native work: development build with an on-device pose model). |
| Q-03 | P0 | Release / legal | Store submission needs a published privacy policy (and terms). `LEGAL_PRIVACY_URL` / `LEGAL_TERMS_URL` are unset; FORM ships no legal text. | **Open** (operator). |
| Q-04 | P0 | Release | No store build pipeline: no EAS project, signing credentials or store listings. A GitHub Actions workflow (`android-apk.yml`) does build a **test** APK after green CI: `expo prebuild` + Gradle, signed with the generated development key, versionCode = the workflow run number, published as the "android-latest" GitHub Release (pre-release). It is not a store build: the Play Store needs an upload/app-signing key and a listing. | **Open** (operator): store signing, listings; the test APK is only for trying FORM on a phone. |
| Q-05 | P1 | Cost abuse | AI coach and meal-recognition caps were per user only; mass sign-ups could run up unbounded provider spend. | **Fixed**: service-wide daily ceilings (`COACH_GLOBAL_DAILY_AI_CALLS`, `FOOD_SCANS_GLOBAL_PER_DAY`) counted in `provider_usage` (no personal data; survives account deletion). Over the ceiling: labelled rules coaching / honest "scanning at capacity". |
| Q-06 | P1 | Honesty | Settings advertised Pro benefits that weren't enforced. | **Fixed** (Q); superseded by Stage R: every listed Pro feature is now enforced server-side and comes from the registry. |
| Q-07 | P1 | Privacy / bug | Phone export wrote the full health-data export into app documents and kept it forever; it was shared with `Share.share({ url })`, which Android ignores (the file never left the phone). | **Fixed**: temp file in the cache → `expo-sharing` share sheet → deleted in `finally`; leftovers purged at sign-out. |
| Q-08 | P1 | Operations | No crash reporting. | **Fixed**: first-party `POST /client-errors` from the root error boundary; scrubbed (emails, tokens, long numbers, ids in routes), size-capped, rate-limited, logged — no third-party SDK. |
| Q-09 | P1 | Operations | No backup procedure for the single SQLite database. | **Fixed**: `dist/backup.js` (`VACUUM INTO` online snapshot, integrity-checked, rotated). Scheduling and off-machine copies are the operator's (Q-21). |
| Q-10 | P2 | Security | Login throttling was per IP only; guessing one account's password from many IPs was unlimited. | **Fixed**: 10 failures / 15 min per email (also for unknown emails — no enumeration), in memory per process. |
| Q-11 | P2 | Security | Two simultaneous sign-ups with one email: the loser got a 500. | **Fixed**: 409 `email_taken`. |
| Q-12 | P2 | AI security | System prompt didn't state that user text is data; an instruction-echo ("print your rules") could reach the user. | **Fixed**: data-not-instructions clause; answers containing instruction markers are rejected (→ labelled rules). Injection tests: leaked rules, fasting, links. |
| Q-13 | P2 | Nutrition | Manual entries / custom foods accepted calories far below their macros (a typo corrupts day totals and XP). | **Fixed**: rejected when 4·P + 4·C + 9·F > 1.25 × kcal + 25 (more kcal than macros — alcohol, fibre — is allowed). |
| Q-14 | P2 | Accessibility | Web: React Native Web removes focus outlines — keyboard users couldn't see focus. | **Fixed**: `:focus-visible` ring (2 px emerald). |
| Q-15 | P2 | Security / deps | `npm audit` in `apps/mobile` (2026-10, 67 findings: 0 critical, 50 high, 17 moderate). **Fixed without a major change**: `shell-quote` (was critical, command injection in a build tool), `source-map-js` (was high, DoS) — both dev/build-time. **Build-time or test-only, not shipped in the app**: `node-forge` (high, via `@expo/code-signing-certificates`), `@expo/cli` / Metro / config plugins, `uuid` / `xcode`, and the Jest toolchain (`braces`/`micromatch`, `sprintf-js`, `js-yaml`). **Reaches the shipped app**: `decode-uri-component` via expo-router's `query-string` (moderate; client-side DoS on a malformed link). npm's suggested "fixes" for the rest are downgrades or major jumps (Expo 44, Jest 30, React Native 0.72), so they are not applied. | **Accepted** for the remaining build-time/test-only findings; the non-major fixes are applied; track Expo patch releases. |
| Q-16 | P2 | Anti-cheat | Pose runs on the device; the server re-verifies the uploaded angle trace (ROM, tempo, confidence, gates) but a modified client can fabricate a plausible trace. Impact is limited to the cheater's own XP (daily training-XP cap, bonus caps; no leaderboards or social). | **Accepted** while there is no social/competitive surface. |
| Q-17 | P2 | Privacy | Request logs include the client IP (abuse investigation, rate limiting). | **Decision for the operator**: keep with a log-retention limit, or drop `remoteAddress` from the request serializer. |
| Q-18 | P2 | Release | Push notifications aren't integrated (preferences are stored; the app says so). | **Open**, not a blocker for a release without reminders. |
| Q-19 | P2 | Web hosting | The web app's CSP and security headers depend on the static host (the API sends strict headers itself). | **Operator**: serve `dist/` with CSP, `nosniff`, `frame-ancestors 'none'`. |
| Q-20 | P3 | Performance | Web entry bundle 2.0 MB (≈565 KB gzip), one chunk; MediaPipe (23 MB) loads only when the camera opens. | Accepted; route-level splitting later. |
| Q-21 | P3 | Operations | Single-process SQLite: dedupe, login throttle and rate limits are per process. | Run one API process (or move these to shared storage before scaling out). |
| Q-22 | P3 | Gamification | The hard reset is ">5 days without training" — except a 1-day-a-week plan, where it's ">6", so a normal weekly rhythm never resets (Stage K design). | Verified, documented. |
| Q-23 | P3 | Security | Registration reveals that an email is taken (409). | Accepted (standard UX); login doesn't reveal it. |
| Q-24 | P3 | Repo hygiene | `apps/api/seed.example.json` holds local dev test-account passwords. | Don't commit it, or blank the passwords before committing. |

## Stage R additions

| ID | Sev | Area | Finding | Status |
|---|---|---|---|---|
| R-01 | P0 | Billing | No App Store / Google Play provider or store client: Pro can't be purchased in production. The development store works end to end and is refused in production. | **Open** (store accounts, products, server credentials, a native purchase client). |
| R-02 | P2 | Accessibility | React Native Web ignores `accessibilityState`: checked, selected, disabled and busy states weren't exposed to web screen readers anywhere. | **Fixed**: mirrored as aria-* props; a source check keeps them in step. |
| R-03 | P2 | Honesty | The weekly report's coach note (last 7 days) could contradict an older report week. | **Fixed**: only within two days of the week's end, and dated. |
| R-04 | P2 | Billing | Two lifecycle events with the same timestamp: the second was treated as stale. | **Fixed**: only strictly older events are stale; duplicates are caught by event id. |

## Verified, no finding

- **Authorization / IDOR / isolation:** every id-addressed route swept as another user (Stage P e2e); per-user scoping in every query.
- **Mass assignment / client trust:** strict schemas; XP, verified reps, records, entitlements, onboarding and consents can't be set by clients.
- **Injection / XSS:** all SQL is parameterised (interpolations are constants or schema names); injection-looking input is stored and returned verbatim and rendered as text; no HTML sinks in the app.
- **Storage:** native token in the Keychain/Keystore (SecureStore); web token in `sessionStorage`; query cache in memory only, cleared on sign-out.
- **AI:** minimal context (no identity, credentials, body measurements, food names, photos); per-user and global caps; timeouts with hard deadlines; every answer validated (grounded numbers, safety and allergen lexicons, catalogued actions); labelled fallback on any failure.
- **Camera:** permission states, multiple people, low light, occlusion, partial body, too fast, partial ROM, jitter, duplicate frames, interruption, stalled streams, trace size cap, 640×480 ≤ 30 fps with frame skipping when slow, stops when hidden.
- **Scanner:** consent first; EXIF stripped; type/size checks; confidence bands, uncertainty ranges, estimates labelled; failures honest and retryable; duplicate submissions → one provider call.
- **Nutrition:** canonical metric storage, central conversions, full-precision storage with display rounding, measured overrides estimate, allergies hard, user-time-zone days.
- **Gamification:** XP ledger, decay, reset, quests, achievements, PRs, streaks, Body Quest, analytics — all covered by domain + API tests and the reconciliation audit.

## Privacy inventory

| Where | What | Kept | Removed by |
|---|---|---|---|
| Database (`DATABASE_PATH`) | Account (email, scrypt hash), profile, goals, preferences/allergies, weight, workouts, sets, rep analyses (angles, no images), food logs, meal plans, groceries, XP ledger, records, achievements, quests, Body Quest, settings, notification prefs, coach chat (30 days), coach insights (7 days), scans (review only, 24 h unless confirmed), profile photo | Until deleted | Account deletion (verified complete, transactional) |
| `provider_usage` | Daily call counts per provider | Indefinitely | Not personal |
| Backups (`BACKUP_DIR`) | Full database copies | Newest `BACKUP_KEEP` | Rotation; deleted accounts persist in older backups until rotated out — say so in the privacy policy |
| Server logs (stdout) | Request method/path/status/timing, request id, user id (opaque UUID) in domain-event lines, client IP, error class/code, scrubbed crash reports | Host's log retention | Host |
| Device — native | Session token (SecureStore); query cache (memory); temp photo files (deleted after upload); export temp file (deleted after sharing) | Session | Sign-out |
| Device — web | Session token (`sessionStorage`, tab lifetime); query cache (memory) | Tab | Sign-out / closing the tab |
| Analytics | None sent (`analyticsConsent` stored; no provider) | — | — |
| AI provider | Coaching facts + chat text, only with `aiCoachConsent` | Provider's retention terms | — |
| Meal recognition | Meal photo (EXIF stripped), only with `foodScanConsent` | Provider's retention terms | — |
| Camera | Nothing leaves the device but joint angles of verified sets | — | — |
| Ads | None. The build contains no ads SDK and no advertising identifier; nothing is sent to an ad network, and there is no ad consent form. (If ads return, add the network here and answer the store privacy forms again.) | — | — |
| Exports | JSON file handed to the user's chosen destination | User's | User |

## Operations runbook

**Environment** (validated at boot; production refuses unsafe values): `NODE_ENV=production`,
`JWT_SECRET` (≥ 32 chars), `CORS_ORIGINS` (explicit), `DATABASE_PATH`, `PORT`, `TOKEN_TTL`, `LOG_LEVEL`,
`RATE_LIMIT_PER_MINUTE`, `APP_STAGE` (`live` by default; `testing` only on a throwaway test server);
providers: `COACH_PROVIDER` / `ANTHROPIC_API_KEY` / `COACH_MODEL` / `COACH_DAILY_AI_CALLS` /
`COACH_CHAT_PER_HOUR` / `COACH_GLOBAL_DAILY_AI_CALLS`, `FOOD_RECOGNITION_PROVIDER` /
`GEMINI_API_KEY` / `FOOD_SCANS_PER_HOUR` / `FOOD_SCANS_GLOBAL_PER_DAY`; billing: `BILLING_PROVIDER`,
`BILLING_PRODUCT_MONTHLY` / `BILLING_PRODUCT_ANNUAL`, `BILLING_TRIAL_DAYS`, `BILLING_GRACE_DAYS`, and for
the sandbox store only `BILLING_DEV_PRICE_MONTHLY` / `BILLING_DEV_PRICE_ANNUAL` /
`BILLING_DEV_CURRENCY` / `BILLING_DEV_SECRET`; legal: `LEGAL_TERMS_URL`, `LEGAL_PRIVACY_URL`. The full
list with defaults is `apps/api/.env.example`. App (build time): `EXPO_PUBLIC_API_URL` (HTTPS);
ads: `EXPO_PUBLIC_ADS_MODE` (`test` | `production` | off), `EXPO_PUBLIC_ADMOB_INTERSTITIAL_ANDROID` /
`EXPO_PUBLIC_ADMOB_INTERSTITIAL_IOS` (production unit ids) and `ADMOB_ANDROID_APP_ID` /
`ADMOB_IOS_APP_ID` (production AdMob app ids; without them the build carries Google's sample ids).

**Run:** `npm run build -w @form/api` → `node --enable-source-maps dist/server.js` (one process, behind
TLS). Migrations run at boot, each in a transaction.

**Health:** `GET /health` → `{ ok, schemaVersion }`, 503 if the database can't answer.

**Backups:** on the free plan see “Backups (Litestream + Cloudflare R2)” below. Elsewhere, schedule `node dist/backup.js --dir $BACKUP_DIR --keep 14` (e.g. hourly) and copy
`BACKUP_DIR` off the machine. Exit 1 = no verified backup — alert on it.
**Restore:** stop the API → copy a backup over `DATABASE_PATH` → delete `DATABASE_PATH-wal` and `-shm`
→ start the API (migrations bring an older backup forward) → run `node dist/reconcile.js`.

**Integrity:** schedule `node dist/reconcile.js` daily; exit 1 = errors (alert). `--repair` applies only
append-only fixes.

**Logs:** JSON lines on stdout. Useful messages: `request completed`, `domain event`,
`unhandled error` (with stack, keyed by the `requestId` the user sees), `client error` (app crash),
`global daily AI budget reached`, `global daily recognition budget reached`,
`coach answer rejected by validation`, `account deletion failed and was rolled back`.

## Backups (Litestream + Cloudflare R2)

The free Render plan has no disk: the database is wiped on every sleep, restart and deploy. Litestream
fixes that: it streams every database change to a **private Cloudflare R2 bucket**, and on each start
`apps/api/scripts/start.mjs` restores the database from it before the server runs. Data survives sleeps,
restarts and deploys; up to ~1 second of the latest writes can be lost in a crash. No laptop is involved.

**One-time setup (free; R2's free tier covers this by a wide margin):**
1. Create a free Cloudflare account → **R2 Object Storage** (a payment method may be requested; the free
   tier is not charged).
2. **Create bucket**, e.g. `form-backups`. Leave public access **off** (no public bucket URL, no custom domain).
3. R2 → **Manage R2 API Tokens** → create a token with **Object Read & Write**, scoped to **that one bucket
   only** (not "all buckets", not Admin). Copy the **Account ID** (R2 overview page), **Access Key ID** and
   **Secret Access Key** (shown once).
4. Render → `form-api` → **Environment** → set `R2_ACCOUNT_ID`, `LITESTREAM_BUCKET` (the bucket name),
   `LITESTREAM_ACCESS_KEY_ID`, `LITESTREAM_SECRET_ACCESS_KEY` → save (the service redeploys). Never paste
   these into chat, git or screenshots. If one leaks, delete the token in Cloudflare and make a new one.

All four must be set. With only some set the server refuses to start (a clear message in the Render log);
with none set it runs without backups.

**Verify:** `GET /status` shows `"backup": "on"`; the R2 bucket shows a `form/` folder with files within
seconds of any activity. Then redeploy once and confirm your account and data are still there.

**Restore drill** (do it once before launch): the server restores automatically on every start, so the
drill is "Render → Manual Deploy → Clear build cache & deploy" (or Restart) and check data persists. To
restore to a laptop or an earlier moment (needs the `litestream` v0.5.17 binary and the four values in your
shell, not in git): `litestream restore -config apps/api/litestream.yml -o restored.db -timestamp <RFC3339 time> <DATABASE_PATH>`.
If the restore fails the server exits and keeps the previous deploy running (Render shows the deploy
failed); it never starts with an empty database.

**Retention and privacy (Play Store data-safety form):** data is encrypted in transit (TLS) and R2
encrypts objects at rest. Backups are kept 7 days (`snapshot.retention: 168h` in `apps/api/litestream.yml`),
so a deleted account disappears from backups within 7 days; say so in the privacy policy. Deletion
requests are honoured in the live database immediately and in backups within 7 days.

**Deploys overlap (free plan limit):** Render starts the new instance (it restores from R2 and passes its
health check), switches traffic to it, and only about 60 seconds later sends SIGTERM to the old one
(https://render.com/docs/deploys, "Zero-downtime deploys"; only a service with a persistent disk skips
this). Litestream v0.5.17 has no lock or lease for the `replicate` command (its `s3/leaser.go` is a library
interface, not wired to the CLI or config), and its docs warn that two processes replicating to the same path
can leave a replica that cannot be restored. In practice the old instance is idle during its last minute, so
the replica is written by the new one; the exposure is writes the old instance accepts in the few seconds
between the new instance's restore and the traffic switch. Those writes are not in the new database and are
lost, and in a rare collision the next start could refuse to restore (the server then never starts empty;
recover with `litestream restore` as in the Litestream docs, "Multiple applications replicating into
location can corrupt"). A wait before restoring cannot help, because the old instance is stopped only after
the new one is healthy. So: **deploy at quiet times** (not while people are logging workouts).
`maxShutdownDelaySeconds: 60` in `render.yaml` lets the old instance finish its final sync. **For the Play
Store launch, move to Render Starter with a persistent disk** (`DATABASE_PATH=/var/data/form.db`, see
`render.yaml`): no overlap, the database lives on the disk, and Litestream stays as the off-machine backup (it
restores only when the database file is missing).

Other limits: backups protect against restarts and deploys, not against losing the Cloudflare account. To
upgrade Litestream, edit `VERSION`/`SHA256` in `apps/api/scripts/install-litestream.sh` (checksum from the
release's `checksums.txt`).

**Keeping the server awake:** `.github/workflows/keep-awake.yml` calls `/health` every ~10 minutes so the
free server doesn't sleep. It runs only from the default branch (`main`), GitHub pauses scheduled
workflows after 60 days without repository activity (re-enable in the Actions tab), and an always-awake
service uses ~744 of Render's 750 free hours a month, so only this one service can stay awake. Check it in
Actions → "Keep API awake" (Run workflow to test).

## Release blockers (to reach READY)

1. **Q-02** Native pose: a development build with an on-device pose model (iOS/Android) wired to the
   existing `LivePoseSession`, verified on devices — or a product decision to ship phones without
   camera verification (the app already says it isn't available there).
2. **Q-03** Publish a privacy policy and terms; set `LEGAL_PRIVACY_URL` and `LEGAL_TERMS_URL`.
3. **Q-04** EAS project (or equivalent), store signing, store listings (including the camera/photo
   permission texts already in `app.json` and the data-safety / privacy-nutrition answers from the
   inventory above; there is no ads SDK or advertising ID). The GitHub test APK is development-key signed and is
   not a store build.
4. Production infrastructure: TLS, a persistent disk for the database, scheduled backups copied
   off-machine, scheduled reconciliation, log retention, alerting on `/health`, backup and reconcile
   exit codes.
5. Device QA on real iOS and Android hardware (not possible in this environment).
6. Remove `APP_STAGE=testing` and the sandbox store (`BILLING_PROVIDER=development`) before real users.
   Set `BILLING_PROVIDER` to `none` or a real store and drop `APP_STAGE` (see `render.yaml`); the server
   then refuses the sandbox store, and the hosted test API's throwaway data and free Pro go away.
