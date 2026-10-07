# FORM — Train. Eat. Level Up.

AI-assisted fitness and nutrition. Monorepo:

```
packages/domain   Pure TypeScript domain engines (every business rule). No I/O.
apps/api          Fastify + SQLite (node:sqlite). Auth, authorization, persistence, orchestration.
apps/mobile       Expo SDK 57 / React Native app (iOS, Android, web). Displays; never decides.
docs/             MASTER_ENGINEERING_DIRECTIVE.md, ARCHITECTURE.md (boundaries, data model)
```

## Run it

Requires Node 22.13+ (tested on 24.19).

```bash
npm install                      # domain + api (npm workspaces)
npm install --prefix apps/mobile # mobile has its own lockfile (Expo-pinned versions)
npm run dev:api                  # http://localhost:4000
npm run dev:web                  # http://localhost:8081
```

`apps/api/.env` (gitignored) holds local settings; copy `.env.example`. Without `JWT_SECRET` the API
uses an ephemeral dev secret (sessions reset on restart). In production it refuses to start without a
32+ character `JWT_SECRET` and explicit `CORS_ORIGINS`. Android emulators and physical devices need
`EXPO_PUBLIC_API_URL` pointing at your machine's LAN IP; non-local API URLs must use HTTPS.

Live camera tracking runs on the device. On web it uses MediaPipe, whose runtime is copied into
`apps/mobile/public/mediapipe` on install (`scripts/copy-pose-assets.mjs`); the model file is fetched
from `EXPO_PUBLIC_POSE_MODEL_URL` (defaults to Google's hosted lite model — self-host it in
production). Browsers only open the camera on `localhost` or HTTPS. Native iOS/Android show the
camera preview, but pose tracking needs a development build with a native pose module.

Food scanning needs a recognition provider. Set `FOOD_RECOGNITION_PROVIDER=anthropic` and
`ANTHROPIC_API_KEY` to use Claude vision (photos are sent to Anthropic; FORM strips EXIF and never
stores them). For local UI work, `FOOD_RECOGNITION_PROVIDER=development` returns a fixed sample that
the app labels as not real recognition; production refuses it. With neither, scanning shows as
unavailable.

The AI Coach defaults to rule-based tips from the user's own data (`COACH_PROVIDER=rules`), always
labelled as rules, never as AI. Set `COACH_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` to use Claude
(`COACH_MODEL`, default `claude-opus-5-5`); every AI answer is validated against FORM's records and
replaced by the labelled rules answer if it fails, times out or errors. `COACH_DAILY_AI_CALLS` and
`COACH_CHAT_PER_HOUR` cap cost per user; `COACH_PROVIDER=none` switches the coach off.

Consents default off. Even with `COACH_PROVIDER=anthropic`, a user gets the rules coach until they
allow AI coaching in Settings; meal photos are sent for recognition only after the user allows it
(the scanner asks). Users can also switch coaching off or stop keeping chat history.

Legal links: set `LEGAL_TERMS_URL` and `LEGAL_PRIVACY_URL` (https) to show Terms and Privacy Policy
links in Settings. FORM ships no legal text; without them, no links are shown.

Weighing: there is no Bluetooth/smart-scale integration yet — weigh on any kitchen scale and type
the weight. For local UI work, `EXPO_PUBLIC_SIMULATED_SCALE=1` in `apps/mobile/.env.local` enables a
clearly labelled simulated scale (development builds only).

## Validate

```bash
npm run validate   # typecheck → lint → tests → build → production smoke test (same as CI)
```

Individual steps: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run smoke`.

Reconciliation (operations): `npm run reconcile -w @form/api` audits every user's derived state
against its records and exits 1 if anything is inconsistent; add `-- --repair` to apply the safe,
append-only repairs (`node dist/reconcile.js` in production). Logs are JSON lines on stdout
(`LOG_LEVEL`, default `info`); `RATE_LIMIT_PER_MINUTE` sets the per-client ceiling (default 300).

FORM Pro: `BILLING_PROVIDER=development` enables the labelled sandbox store for local work (refused in
production; set `BILLING_DEV_SECRET` so sandbox receipts survive restarts). Product ids:
`BILLING_PRODUCT_MONTHLY` / `BILLING_PRODUCT_ANNUAL`; `BILLING_TRIAL_DAYS` (0 = no trial offered);
sandbox display prices `BILLING_DEV_PRICE_MONTHLY` / `BILLING_DEV_PRICE_ANNUAL`. Free allowances:
`FREE_SCANS_PER_DAY`, `FREE_COACH_CHAT_PER_DAY`, `FREE_AI_CALLS_PER_DAY`. No App Store / Google Play
billing is configured — Pro can't be bought in production yet.

Backups: `npm run backup -w @form/api -- --dir <dir> --keep 14` (`node dist/backup.js` in production)
writes a verified snapshot while the API runs; restore steps are in [docs/RELEASE.md](docs/RELEASE.md).
Paid providers have service-wide daily ceilings: `COACH_GLOBAL_DAILY_AI_CALLS` (default 10000) and
`FOOD_SCANS_GLOBAL_PER_DAY` (default 5000). Release status, findings and the privacy inventory:
[docs/RELEASE.md](docs/RELEASE.md).

Production API: `npm run build -w @form/api` then `npm start -w @form/api`.

## Principles (enforced in code)

- **Source of truth:** XP from the ProgressionEngine via the XP ledger; verified reps from the Rep
  Verification Engine via the Workout Engine; targets from the NutritionCalculator; Pro from the
  EntitlementService; coach context from the CoachContextBuilder. The API rejects any client-supplied
  `xp`, `verifiedReps` or entitlement field.
- **Safety:** no XP for serious pain or beyond 120 training min/day; no nutrition XP for a finished
  day below the safe floor; targets never below `max(sex floor, BMR)`; no deficits for under-18s;
  implausible PR jumps held for review; streaks tolerate rest days; quests and Body Quest plans are
  validated against safe limits.
- **Honesty:** all seven external providers ship unconfigured and say so. `GET /system/features`
  tells the app which features are real; nothing fakes a rep, food match, purchase or ad.
- **Privacy:** data is private per user; consents default off; sign-out clears the app cache;
  "sign out everywhere" and account deletion revoke every session.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full boundary map and data model.
