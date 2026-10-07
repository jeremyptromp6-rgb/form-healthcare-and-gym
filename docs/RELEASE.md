# FORM — release readiness (Stage Q)

Audit date: 2026-10-02. Scope: API (`apps/api`), domain (`packages/domain`), app (`apps/mobile`, web build
verified in a browser; iOS/Android not run on devices).

**Status: NOT READY FOR RELEASE** — every code-level P0/P1 found is fixed; the remaining blockers
need the operator (store, legal, providers, infrastructure) or new native work. See "Release blockers".

## Findings register

| ID | Sev | Area | Finding | Status |
|---|---|---|---|---|
| Q-01 | P0 | Security / deps | `@fastify/jwt` ≤ 9.1 pulled in `fast-jwt` ≤ 6.2.3 with 2 critical advisories (incl. auth bypass with an empty HMAC secret, claim cache confusion). | **Fixed**: `@fastify/jwt` 10.2.2; `npm audit --omit=dev` on the API: 0 vulnerabilities. Forged / unsigned / wrong-secret / wrong-algorithm / tampered / expired tokens tested. |
| Q-02 | P0 | Release | iOS/Android builds have no native pose module: camera-verified reps — the core Train promise — work only in the web app. Phones log sets honestly as unverified. | **Open** (native work: development build with an on-device pose model). |
| Q-03 | P0 | Release / legal | Store submission needs a published privacy policy (and terms). `LEGAL_PRIVACY_URL` / `LEGAL_TERMS_URL` are unset; FORM ships no legal text. | **Open** (operator). |
| Q-04 | P0 | Release | No store build pipeline: no EAS project, signing credentials, build numbers or store listings. | **Open** (operator). |
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
| Q-15 | P2 | Security / deps | App toolchain advisories (`@expo/cli`, config plugins, `node-forge`, `xcode`/`uuid`: build-time, not shipped) and `decode-uri-component` via expo-router's `query-string` (client-side DoS on a malformed URL). npm's only "fix" is a downgrade to Expo 44. | **Accepted**, track Expo patch releases. |
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
| Exports | JSON file handed to the user's chosen destination | User's | User |

## Operations runbook

**Environment** (validated at boot; production refuses unsafe values): `NODE_ENV=production`,
`JWT_SECRET` (≥ 32 chars), `CORS_ORIGINS` (explicit), `DATABASE_PATH`, `PORT`, `TOKEN_TTL`, `LOG_LEVEL`,
`RATE_LIMIT_PER_MINUTE`; providers: `COACH_PROVIDER` / `ANTHROPIC_API_KEY` / `COACH_MODEL` /
`COACH_DAILY_AI_CALLS` / `COACH_CHAT_PER_HOUR` / `COACH_GLOBAL_DAILY_AI_CALLS`,
`FOOD_RECOGNITION_PROVIDER` / `FOOD_SCANS_PER_HOUR` / `FOOD_SCANS_GLOBAL_PER_DAY`; legal:
`LEGAL_TERMS_URL`, `LEGAL_PRIVACY_URL`. App: `EXPO_PUBLIC_API_URL` (HTTPS).

**Run:** `npm run build -w @form/api` → `node --enable-source-maps dist/server.js` (one process, behind
TLS). Migrations run at boot, each in a transaction.

**Health:** `GET /health` → `{ ok, schemaVersion }`, 503 if the database can't answer.

**Backups:** schedule `node dist/backup.js --dir $BACKUP_DIR --keep 14` (e.g. hourly) and copy
`BACKUP_DIR` off the machine. Exit 1 = no verified backup — alert on it.
**Restore:** stop the API → copy a backup over `DATABASE_PATH` → delete `DATABASE_PATH-wal` and `-shm`
→ start the API (migrations bring an older backup forward) → run `node dist/reconcile.js`.

**Integrity:** schedule `node dist/reconcile.js` daily; exit 1 = errors (alert). `--repair` applies only
append-only fixes.

**Logs:** JSON lines on stdout. Useful messages: `request completed`, `domain event`,
`unhandled error` (with stack, keyed by the `requestId` the user sees), `client error` (app crash),
`global daily AI budget reached`, `global daily recognition budget reached`,
`coach answer rejected by validation`, `account deletion failed and was rolled back`.

## Release blockers (to reach READY)

1. **Q-02** Native pose: a development build with an on-device pose model (iOS/Android) wired to the
   existing `LivePoseSession`, verified on devices — or a product decision to ship phones without
   camera verification (the app already says it isn't available there).
2. **Q-03** Publish a privacy policy and terms; set `LEGAL_PRIVACY_URL` and `LEGAL_TERMS_URL`.
3. **Q-04** EAS project, signing, build numbers, store listings (including the camera/photo
   permission texts already in `app.json` and the data-safety / privacy-nutrition answers from the
   inventory above).
4. Production infrastructure: TLS, a persistent disk for the database, scheduled backups copied
   off-machine, scheduled reconciliation, log retention, alerting on `/health`, backup and reconcile
   exit codes.
5. Device QA on real iOS and Android hardware (not possible in this environment).
