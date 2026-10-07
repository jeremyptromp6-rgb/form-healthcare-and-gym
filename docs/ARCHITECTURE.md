# FORM architecture

Read with [MASTER_ENGINEERING_DIRECTIVE.md](MASTER_ENGINEERING_DIRECTIVE.md).

## Layers

```
apps/mobile  (Expo SDK 57, React Native, iOS/Android/web)
   │  typed HTTP client + React Query cache. Displays; never decides.
   ▼
apps/api     (Fastify 5, node:sqlite)
   │  auth, authorization, persistence, orchestration. One module per boundary.
   ▼
packages/domain  (pure TypeScript, no I/O)
      every business rule: XP, verification, nutrition, safety, entitlements…
```

Rules:

- Business logic lives in `packages/domain` only. The API calls it; the app never re-implements it
  (client-side range checks exist only for instant form feedback — the server validates again).
- Every authenticated query is scoped to `req.user.sub`. Another user's row is indistinguishable
  from a missing one (404), never a 403 that leaks existence.
- Clients never submit XP, verified reps, PRs, entitlements or targets. Strict request schemas
  reject unknown fields.

## Domain boundaries

| Boundary | Domain module | API module | Status |
| --- | --- | --- | --- |
| auth | — | `modules/auth` (scrypt, JWT + token_version revocation) | live |
| profile / settings / onboarding | `users/users.ts`, `users/profileOptions.ts` (catalog) | `modules/users` | live |
| personalization | `personalization/personalization.ts` | `GET /me/personalization` | live |
| food assessment | `food/foodAssessment.ts` (allergy = exclude, dislike = deprioritise) | — | live (consumed by later stages) |
| exercises | `workouts/exercises.ts` (library: muscles, equipment alternatives, pattern, instructions, rep range, safety, camera setup) | `GET /exercises`, `GET /exercises/:id` | live |
| workout generation | `workouts/generator.ts` (`WorkoutGenerator` interface, rule-based v1) | `modules/workouts/plans.ts` (`GET /workouts/today`) | live |
| live sessions | `workouts/session.ts` (timing) | `modules/workouts/sessions.ts` (`/workouts/sessions/*`) | live |
| workouts | `workouts/workoutEngine.ts` (Workout Engine) | `modules/workouts` | live |
| camera / pose | `camera/pose.ts` (PoseProvider, canonical landmarks, MediaPipe mapping), `camera/framing.ts` (framing checks + tracker), `camera/livePose.ts` (LivePoseSession + set trace), `camera/liveCoach.ts` (LiveRepVerifier, phase labels, feedback throttle), `camera/analysis.ts` (ExerciseAnalyzer, RepVerifier, ROMAnalyzer, FormAnalyzer) | — (on-device only) | live on web (MediaPipe); native needs a dev build |
| analysis | `analysis/repVerification.ts` (MovementStateMachine, verification, ROM), `analysis/features.ts` (per-frame form features), `analysis/formAnalysis.ts` (form rules + score), `analysis/setAnalysis.ts` (set quality), `analysis/events.ts` (domain events) | via Workout Engine; `domain_events` outbox | live |
| nutrition | `nutrition/nutritionCalculator.ts` (targets), `nutrition/units.ts` (exact unit definitions), `nutrition/calculation.ts` (**NutritionCalculator** — the only food-math engine), `nutrition/foodLog.ts` (sources, estimated/measured, precedence, day summary), `nutrition/nutritionContext.ts` (coach context), `nutrition/models.ts` | `modules/nutrition` (`service.ts` is the only writer; `/nutrition/logs`, `/nutrition/meals`) | live |
| food | `food/catalog.ts` (verified database), `food/search.ts`, `food/userFoods.ts`, `food/food.ts` (FoodItem, `recommendableFoods`), `food/scan.ts` (FoodRecognitionProvider, review, estimates, selections, development fallback), `food/scale.ts` (ScaleProvider + stable-reading state machine) | `/foods/*`, `modules/scan` (`/nutrition/scans`) | database, search, user foods, scanning (needs a configured provider) and measured logging live; no real scale integration yet (manual weight entry; simulated scale in dev only) |
| meals | `recipes/library.ts` (FORM recipe library as structured data, `RecipeSource`), `meals/meals.ts` (plan types), `meals/planner.ts` (MealPlanGenerator, `eligibleRecipes`, `mealAlternatives`), `grocery/grocery.ts` (aggregation, amounts, custom items) | `modules/meals` (`/recipes`, `/meal-plans`, `/grocery`) | live |
| meals / recipes / grocery | `meals/`, `recipes/`, `grocery/` | — | models (+ recipe macro math) |
| progression / XP | `progression/progressionEngine.ts`, `progression/xpEvents.ts` | `modules/progression` | live |
| streaks | `streaks/streakEngine.ts` (workout, nutrition, quest, weekly consistency; milestones) | `modules/recognition` (`GET /streaks`) | live (derived) |
| PRs | `records/personalRecords.ts` (PR_METRICS registry, direction-aware comparison) | `modules/records` (in the workout transaction), `GET /records` | live |
| quests | `quests/quests.ts` (catalog, safety validator, engine) | `modules/quests` (`GET /quests`) | live |
| home | `home/todayPlan.ts` (rule-based "what to do today") | `modules/home` (`GET /home`) | live |
| water | `nutrition/water.ts` (target + safety limits) | `modules/water` | live |
| achievements | `achievements/achievements.ts` (catalog + AchievementEngine) | `modules/recognition` (`GET /achievements`) | live |
| Body Quest | `bodyQuest/bodyQuestEngine.ts` (BodyQuestEngine; `bodyQuest.ts` keeps weight-goal plan safety rules, unused by stages) | `modules/recognition` (`GET /body-quest`) | live |
| celebrations | — | `modules/recognition` (`GET /celebrations`, `POST /celebrations/seen`) | live |
| progress analytics | `progressAnalytics/progressAnalytics.ts` (ranges, buckets, trend engine, chart models, units, goal focus) | `modules/analytics` (ProgressAnalyticsService, `GET /analytics/progress`) | live |
| AI Coach | `coach/coach.ts` (CoachContextBuilder, provider contract), `coach/response.ts` (CoachResponse, actions, validator), `coach/deterministicCoach.ts` (rules fallback) | `modules/coach` (`/coach/status`, `/coach/insight`, `/coach/messages`), `providers/aiCoach.ts` (Claude) | live: rules by default; Claude when configured |
| analytics | `analytics/analytics.ts` (allowlist + privacy filter) | — | boundary only |
| notifications | `notifications/notifications.ts` | — | boundary only |
| subscriptions | `subscriptions/entitlements.ts`, `billing.ts` | `modules/subscriptions` | entitlements live; billing unconfigured |
| ads | `ads/adService.ts`, `adProvider.ts` | `modules/ads` | live decision; provider unconfigured |
| feature availability | `providers/features.ts` | `modules/system` (`GET /system/features`) | live |

`GET /system/features` tells the app which features are real right now (engine built **and**
provider configured). The app never offers a feature that cannot work.

## Data model (SQLite, `apps/api/src/db/migrations.ts`)

| Model | Table | Notes |
| --- | --- | --- |
| User | `users` | `token_version` revokes all sessions |
| UserProfile | `profiles` | nullable while onboarding; `activity`/`goal` (energy) are server-derived |
| Goal history | `goal_history` | primary goal by `effective_from`; a change shapes the future only |
| NutritionPreferences | `nutrition_preferences` | allergies (hard) and dislikes (soft) in separate columns |
| Weight history | `body_measurements` | one entry per day; the newest sets the current weight and targets |
| Profile photo | `profile_photos` | owner-only, JPEG/PNG, EXIF/text metadata stripped, ≤ 1 MB |
| UserSettings | `user_settings` | units (display only — storage is metric), IANA `timezone`, consents default **off** |
| Water | `water_logs` | per-user `client_log_id` idempotency key; 50–2000 ml per entry, 8 L/day cap |
| Workout | `workouts` | idempotency key `(user_id, client_workout_id)` |
| WorkoutSet | `workout_sets` | `set_index`, verification status, ROM % |
| VerifiedRep | `verified_reps` | per rep: duration, min angle, ROM % |
| Exercise | code catalog (`EXERCISES`) | validated on every submission |
| FoodLog | `food_logs` | `source` (verified_database / user_food / scan_estimate / recipe / manual) × `amount_method` (measured / label / estimated), meal, portion (quantity + any of 13 units), normalised amount in the basis unit, `amount_via` (mass / volume / density / count), gram-first `grams`, `density_g_per_ml`, per-100 snapshot, exact nutrition, `calc_version`, `weight_source` (typed / scale), `meal_id` + `meal_name`, `replaced_log_id` + `replaced_estimate` snapshot, `client_log_id` idempotency key; CHECKs: scan ⇒ estimated, measured ⇒ amount by mass/volume (never a count or density conversion), weight source ⇒ measured; unique `replaced_log_id` |
| MealPlan | `meal_plans`, `planned_meals` | a plan per 1 or 7 days (`client_plan_id` idempotency, targets snapshot, warnings, active/archived); planned meals = date, slot, library recipe, servings (0.5–2.5), and `food_log_id` once marked eaten |
| SavedRecipe | `saved_recipes` | per-user bookmarks |
| GroceryItem | `grocery_items` | source plan (regenerated on every plan change) / recipe (accumulates) / custom (the user's own); food + amount + unit, or free text; aisle; checked |
| FoodScan | `food_scans` | one recognition per `client_scan_id` (unique per user): status, provider name + `development` flag, the sanitised review (JSON), 24 h expiry, `confirm_key` once confirmed. **No image column** — photos are never stored |
| UserFood | `user_foods` | per-user foods from labels, stored per 100 g/ml; soft-deleted (logs keep their snapshot) |
| NutritionTarget | `nutrition_targets` | snapshot by `effective_from` (+ the diet styles that shaped it); history is never rewritten |
| XPEvent | `xp_events` | the append-only, signed XP ledger; unique `(user, idempotency_key)`; triggers block UPDATE/DELETE |
| ProgressionState | `progression_state` | per-user cursor: the last day consistency (decay/reset) was evaluated through |
| PersonalRecord | `personal_records` | append-only; `awarded` or `needs_review`, with the value it beat (`previous`) and local date; `*` = across all training |
| Streak | derived | computed from authoritative dates by StreakEngine; not stored |
| Quest | `QUESTS` catalog + `user_quests` | |
| Achievement | `ACHIEVEMENTS` catalog + `user_achievements` | unlocks are immutable (triggers), one per (user, achievement), with reward and domain event |
| BodyQuest | `body_quest_snapshots` (+ live evaluation) | one immutable snapshot per finished week, with engine version |
| Celebration | `domain_events` + `celebration_seen` | what a user has already seen |
| Body goal | `body_quests`, `body_measurements` | weight-goal plans (not part of Body Quest stages) |

### XP ledger & progression (ProgressionEngine)

Pipeline: validated domain event → XP engine (`packages/domain`) → `xp_events` row → active XP →
level → rank → quests → Home / Progress. The server is the only writer; no endpoint accepts XP,
levels, ranks, quest completion or PRs.

- **Ledger.** Every row has `source` (workout, nutrition_day, quest, achievement, decay, reset,
  correction), `kind` (award ≥ 0, adjustment ±, decay ≤ 0, reset = 0, correction ±), signed `xp`, a
  unique `idempotency_key`, the `domain_event_id` that caused it, `local_date` and `detail` (e.g. the
  itemised workout breakdown). Inserts use `ON CONFLICT DO NOTHING`, so retries and concurrent
  requests write once. Rows are never edited or deleted (database triggers; account deletion still
  cascades). A changed outcome — a re-settled nutrition day, a withdrawn quest, a late workout
  cancelling a decay — is a **compensating adjustment**; manual fixes use `correctXp` (service-only).
- **Workout XP** is written in the workout's transaction from the `workout.completed` event:
  verified reps on diminishing tiers (2 → 1 → 0.5 XP, 0 beyond 300), recorded reps 0.5 (cap 40),
  good form (score ≥ 85) +0.5/rep (cap 50), full range (≥ 95 %) +0.25/rep (cap 25), +30 per exercise
  with a personal record that *beats* an earlier one (max 3; a first value is a baseline), +25 completion. A
  daily cap of 120 training minutes stops grinding; serious pain earns 0 so pushing through it is
  never rewarded.
- **Nutrition XP** is settled once the day has ended, against the `NutritionTarget` in force that
  day; today's is **provisional** (`provisionalXp`), shown but not yet in the ledger.
- **Level** comes from active XP on a configurable curve (`LEVEL_CURVE`: 100 × (L−1)^1.5, max 100),
  shown as "LEVEL 13 — 2,450 / 3,000 XP". **Ranks:** Rookie 1, Starter 5, Athlete 10, Iron 20,
  Elite 30, Master 45, Champion 60. Level changes emit `progression.level_up` (once per level per epoch).
- **Decay** (`progression/consistency.ts`): a day is *missed* only once the user's weekly plan
  (Mon–Sun) can no longer be met in the days left, so planned rest never decays. Each missed day
  costs 10 XP once (key `decay:<date>`), floored at 0. Up to 3 days after a workout with serious pain
  are recovery days: never missed, and they don't count toward a reset. A workout logged later for
  a decayed day cancels it with an adjustment.
- **Reset**: more than 5 consecutive days without a qualifying workout (the threshold widens for
  1-day-a-week plans: `max(5, ceil(7/N) − 1)`) appends a `reset` row and a `progression.reset`
  event (previous level, rank, XP and gap in the payload). Active XP restarts at 0 — Level 1, Rookie
  — while workouts, PRs, achievements, nutrition and the full ledger stay; lifetime XP is kept.
- **Settlement** (`settleProgression`) runs in one transaction on reads of `/progress`, `/home` and
  `/xp/events`, walking days from the `progression_state` cursor (at most 60 days back) in the
  user's own time zone. Each day's outcome is keyed, so concurrent reads apply it exactly once.
- `/xp/events` returns the ledger with human labels for the Progress screen's XP history.

### Training

- **Generation.** `WorkoutGenerator` is an interface; `ruleBasedGenerator` (v1) is the active one
  (`modules/workouts/plans.ts`). Inputs: goal in force today, experience, equipment, days/week,
  sessions this week, days since last workout, recent serious pain, last performance per exercise
  and its ROM. It is deterministic; the plan is generated once per local day and stored
  (`workout_plans`), with an explicit regenerate endpoint. It never adds load after pain, a 14+ day
  break or sub-80% ROM, and deloads always round down.
- **Sessions.** A live workout (`workout_sessions`, `session_sets`) lives entirely on the server:
  sets, pauses (`paused_ms`), rest deadline (`rest_ends_at`). One open session per user (partial
  unique index). Sets are idempotent on `client_set_id`; verified reps, ROM and form score come only
  from the Workout Engine (`evaluateSet`); form score stays null until a FormAnalyzer exists.
- **Completion.** `completeSession` runs in one transaction and creates exactly one `workouts` row
  (idempotency key = the session's client id), its XP event and PRs. Streaks and quests derive from
  `workouts`, so retries — sequential or concurrent — can't duplicate anything. Duration is computed
  from server timestamps minus pauses.
- **Camera pipeline.** PoseProvider → ExerciseAnalyzer (joint angle + form features) →
  MovementStateMachine (rep events) → RepVerifier (authoritative, server-side) → FormAnalyzer +
  ROMAnalyzer. See "Rep verification & form" below.

### Live camera (on-device)

```
getUserMedia / expo-camera → PoseProvider (on device) → PoseDetection { timestampMs, frame, people[], brightness }
  → LivePoseSession: FramingTracker (can this frame be analyzed?) → ExerciseAnalyzer (joint angle, pixel space)
    → LiveRepVerifier (reps, form, ROM, feedback) · set trace (→ server on "Log set")
```

- **Shared rules.** The app imports `@form/domain` directly (Metro `watchFolders` + tsconfig/jest
  path mapping) so framing and analysis on the phone are the exact code the API runs.
- **Providers.** Web: MediaPipe Pose Landmarker (BlazePose lite, `numPoses: 2`) in WebAssembly +
  WebGL, GPU with CPU fallback. Its runtime is copied from `node_modules` into `public/mediapipe`
  by `scripts/copy-pose-assets.mjs` and loaded as a native ES module only when the camera starts
  (Metro can't bundle its computed `import()`, and it stays out of the app bundle). The model file
  (~5.5 MB) comes from `EXPO_PUBLIC_POSE_MODEL_URL` (defaults to Google's hosted file; self-host
  for production). Native: `expo-camera` preview + permissions, but the provider reports
  `unconfigured` — real native tracking needs a frame-processor module in a development build.
- **Framing.** `assessFraming` works only from reported landmarks: no person, left frame, multiple
  people (a second person with ≥ 8 visible landmarks), low light (mean frame luminance), too far
  (body extent), too close / partial body (required landmarks predicted outside the frame, with
  direction), occlusion (in frame but low confidence), insufficient landmarks. Each exercise
  declares the landmark chain it needs (`CAMERA_REQUIREMENTS`); upper-body moves don't need legs.
  `FramingTracker` debounces messages (400 ms) while per-frame `trackable` gates analysis exactly.
- **Angles** are measured in pixel space (`toPixelSpace`) — normalized coordinates on a 16:9
  frame distort every angle.
- **Privacy & performance.** Frames are never stored or sent; the only copy is a 32×24 brightness
  sample. 640×480 ≤ 30 fps capture; inference skips alternate frames when slow; the skeleton is
  drawn on a canvas outside React; React gets a ~5 Hz readout. The camera stream stops on pause,
  end and unmount; a watchdog on its own timer reports hidden pages, stalled streams and streams
  that never deliver a frame as "interrupted" and resets movement state. The camera opens only
  after the user taps "Turn on camera".
- **UI contract.** Verified reps, form and ROM come only from the rep engine; nothing is shown
  before it's measured. In a workout, camera pause = workout pause (server-side).

### Rep verification & form

- **One trace, two readers.** `LivePoseSession` records every analyzed frame (≤ 20 fps) as an
  `AngleSample` — joint angle + form features, or a confidence-0 sample with the framing `gate`
  reason (`multiple_people`, `partial_body`, `interrupted`…). The live `LiveRepVerifier` sees exactly
  those samples; "Log set" sends the same trace, and the server's `analyzeSet` re-derives verified
  reps, form and ROM from it. Same code, same samples → same result; the server's is authoritative
  and the client can never submit verified reps, form or ROM (strict schemas).
- **Rep states.** One parameterised `MovementStateMachine`, exercise-specific thresholds and names
  (`PHASE_LABELS`): squat Standing → Descending → Required depth → Ascending → Standing; push-up
  Top → …; curl Extended → Curling → Required contraction → Returning → Extended; lunge (front leg)
  Standing → … . A rep counts only after reaching the required depth *and* full extension, within
  a plausible duration.
- **Temporal validation.** Starts in `unknown` (no rep until the joint is seen extended — tracking
  that starts mid-movement can't count); duplicate/out-of-order frames ignored; single-frame angle
  jumps faster than 1000°/s are glitches; hysteresis (20° attempt threshold, 10° reversal) stops
  jitter double-counting; a second person aborts the rep in progress at once, other framing gates
  after 200 ms, an explicit interruption immediately, and low-confidence gaps after 600 ms.
- **Counts.** *Attempted* (every movement that started), *recorded* (what the user logs) and
  *verified* (engine-confirmed, ≤ recorded). Only verified reps feed progression.
- **ROM.** Amplitude against an exercise reference range (e.g. squat knee 170° → 90°), capped at
  100% — a verified but shallow rep scores < 100%. 2D side-view joint angles, not clinical ROM.
- **Form.** `FORM_RULES` per exercise (depth/contraction, extension, tempo, torso lean, knee travel,
  heel lift, body line, forearm stacking, elbow drift, torso swing) with explicit thresholds and
  capped penalties → 0–100 per verified rep. A rule whose landmarks weren't visible for ≥ 60% of the
  rep is skipped and not listed as assessed. Form never un-verifies a rep. *Perfect* = verified, no
  issues, ROM ≥ 95%.
- **Feedback.** Framing problems first, then the latest rep cue ("CORRECT FORM", "FIX YOUR FORM" +
  the single highest-penalty correction, "REP NOT VERIFIED" + why), then the movement phase. Cues
  hold ≥ 1.2 s and expire after 4 s.
- **Audit.** `session_sets.analysis` / `workout_sets.analysis` store the analyzer version, status,
  rejections (reason + timing), gated-frame counts, quality summary and trace size; `verified_reps`
  stores each rep's timing, depth, peak, ROM, form score and issues. No video, landmarks or raw
  trace are stored.
- **Events.** Completing a workout writes one `exercise.set_verified` event per camera-analyzed set
  to `domain_events` (same transaction, unique per user/type/key). Progression stages consume them;
  this layer has no XP, PR or quest rules. `camera_verification` needs no server provider (pose is
  on-device); the camera quest is offered only to users with camera-verified reps in the last 28
  days.

### The user's "today"

`userClock` (API `shared/userClock.ts`) is the only place a user's local date is decided. Once
the user's IANA time zone is stored (the app syncs it from the device on launch and after travel),
the server computes the date itself and ignores client-supplied dates. Before that, a client date is
accepted only if plausible (±1 day of UTC). Weeks run Monday–Sunday in the user's zone.

### Nutrition

- **Targets** come from one function, `targetsForUser(profile, preferences)`: Mifflin–St Jeor BMR ×
  activity (from training days) ± goal adjustment (deficit capped at 750 kcal, never below the
  safe floor, no deficit for minors). Diet styles shape only the macro split (high protein:
  +0.4 g/kg up to 2.4; lower carb: 40% fat) with a 50 g carbohydrate floor; restrictions (vegan,
  halal…) never change targets. Protein uses an adjusted weight above BMI 30. A change to any
  input snapshots new targets from that day.
- **Two facts per entry.** `source` says where the numbers came from; `amountMethod` says how the
  amount was known. A scan is always `estimated`; `measured` needs a weight or volume read directly
  (never "1 serving", never a cup of rice converted through a density). Enforced in the domain
  (`resolveAmountMethod`), the API and the database (CHECKs). Estimated entries are shown with ≈,
  measured ones as MEASURED, and day totals report both shares (Eat and Home).
- **NutritionCalculator** (`nutrition/calculation.ts`) is the one engine for food math — server
  logging, app previews, recipes, scans and user-food labels all call it. Units (`nutrition/units.ts`):
  g, kg, oz, lb; ml, L, fl oz, cup, tbsp, tsp (exact international/US definitions); serving, piece,
  item (the food's own servings). Normalisation is gram-first: the amount in the food's basis
  (per 100 g or ml) plus the weight in grams whenever it is known. Weight↔volume crosses only through
  a known density (from the reference's own household measures, e.g. 1 cup rice = 158 g); weighing a
  drink is still a measurement, a converted cup is not. Values are stored at full precision; only
  presentation rounds (whole kcal, 0.1 g), so a day or meal total is the rounded sum of exact values.
  Each log records `calc_version`.
- **Server-computed macros.** For database and user foods the client sends only the food and the
  portion; the server computes everything with the NutritionCalculator. Each entry stores a per-100
  snapshot (and the density used), so edits recompute from what was logged and catalog changes never
  rewrite history. Only manual entries carry typed-in macros (kept as typed).
- **Measured supersedes estimated.** Precedence is measured > label > estimated. A scan estimate
  can be superseded (`replacesLogId`) only by the caller's own more reliable entry: in one
  transaction the estimate is deleted and the new entry keeps its day, meal and meal name plus a
  `replaced_estimate` snapshot. Replaying the same request is idempotent; a second replacement is 409;
  keeping both is the user's explicit choice (no `replacesLogId`).
- **Meals.** `POST /nutrition/meals` logs up to 20 weighed ingredients atomically and once per
  `clientMealId` (`meal:<id>:<n>` client ids), sharing a `meal_id`/name; ingredients may supersede
  scan estimates (weigh the scanned plate). The response carries the meal total.
- **Scale.** `ScaleProvider` reports raw events; `scaleReducer` owns the states (not connected,
  connecting, connected, reading, stable, error) and decides stability deterministically (window
  covered, enough samples, within ±max(1 g, 0.5%) — works for fast and slow scales). Only a stable
  reading can fill the weight; the log records `weight_source: scale`. No Bluetooth/smart-scale
  integration exists: the app uses `NO_SCALE_PROVIDER` (says so; typing the weight is always
  available). `EXPO_PUBLIC_SIMULATED_SCALE=1` enables a labelled simulated scale in development only.
- **Idempotent logging** on `client_log_id` (user foods on `client_food_id`); the app keeps the id
  across retries. Logs count toward the user's local day (`userClock`), today or up to 7 days back;
  the default meal comes from the local hour. Edits/deletes re-settle already-settled XP days.
- **One day view.** `nutritionDay` (logs, totals by meal, progress/remaining, targets, water, XP)
  serves Eat; Home uses the same summary code without water so its sections still fail
  independently. The coach gets `buildNutritionContext` — aggregates and safety notes only, no food
  names or raw logs.
- **Safety.** Allergies and diet restrictions are hard exclusions via `recommendableFoods` (user
  foods, with unknown allergens, come back as "caution"); meal plans must stay at or above the safe
  floor (`planRespectsSafeFloor`); nutrition XP never rewards eating below it.
- **Contract only (later stage):** `MealPlanner`.

### Meal planning, recipes, grocery

- **Recipes are real structured data.** `RECIPE_LIBRARY` holds simple everyday recipes written on top
  of the verified food database (catalog foods + grams/ml, prep/cook time, servings, steps). Nutrition
  per serving is computed with the NutritionCalculator; allergens are the union of ingredient
  allergens; diet suitability is the intersection. Seasonings without meaningful energy are "pantry"
  items (shown, checked against custom allergies, not counted). No prices: a relative cost tier per
  ingredient (1–3) lets plans respect a budget without inventing numbers. A licensed recipe provider
  would implement `RecipeSource`.
- **Generation** (`generateMealPlan`, deterministic): hard rules first — anything an allergy, custom
  allergy or diet restriction excludes (or can't be confirmed safe) is never planned. Each slot aims
  at its share of the day's energy (25/30/35/10 %) and protein with portion steps of 0.5–2.5
  servings; dislikes, cooking time, budget, diet styles and variety only change the ranking. Every
  day is then adjusted to reach at least the safe floor (grow portions, then add a snack) and trimmed
  if it overshoots the target by more than 10 %. No targets (no body profile) → no plan.
- **Planned ≠ eaten.** A planned meal becomes food only when the user marks it eaten: a `recipe`
  log (portion by count, estimated) linked to the meal. It's eaten only while that log exists —
  deleting the entry from Eat makes the meal planned again; unmarking deletes the log. Future meals
  can't be marked eaten; eaten meals can't be changed until unmarked.
- **Editing:** swap (`mealAlternatives`: same slot, still safe, close in energy — protein shortfalls
  count fully, extra protein only a little — then time, budget, dislikes), change servings, add,
  remove, repeat a day onto other days. A new plan archives the one it overlaps.
- **Grocery:** planned-not-eaten meals from today on → ingredients scaled to portions, aggregated
  only for the same food in the same unit, grouped protein / carbohydrates / produce / other, shown
  as practical amounts ("about 22 (1.1 kg)" for foods bought by the piece). Plan items regenerate on
  every plan change and keep a tick unless more is now needed; recipe items accumulate; custom items
  are never touched. Amounts are recipe weights (cooked for rice, pasta, meat) — the list says so.

### Food scanner

Photo → recognise → review → confirm → log. Nothing is logged until the user confirms.

- **Capture (app).** `lib/scanCapture.ts` asks for camera/library permission (denied vs blocked →
  Settings), re-encodes to JPEG at ≤1280 px without EXIF and sends base64. The API re-validates
  (`sanitizePhoto`: magic bytes, 5 MB cap, EXIF/GPS stripped) before anything reaches a provider.
- **Recognition.** `FoodRecognitionProvider.recognize(image, {signal})` returns foods with
  confidence, alternatives, a serving estimate with a low–high range, per-100 g nutrition, hidden
  ingredients and a composite flag. `sanitizeRecognition` clamps everything the model says.
  Providers: `anthropic` (Claude vision with a zod structured-output schema, `apps/api/src/providers/foodRecognition.ts`),
  `development` (a fixed, clearly-labelled sample; refused in production) or none (feature
  unavailable, 503). Per-user hourly limit and a server timeout (aborts the provider call).
- **Review.** `buildScanReview` maps each item to catalog options (`matchCatalogFood`; composites
  never match) so verified nutrition replaces the model's guess where possible. Confidence
  (is it this food?) and nutrition accuracy (reference / approximate / rough — hidden oil and
  composites are always rough) are separate. Low-confidence items need an explicit choice.
  Statuses: ok / no_food / unknown_food / poor_image.
- **Confirm.** `resolveScanSelections` validates every item decision; logs are written in one
  transaction as `scan_estimate` + `estimated` with client ids `scan:<confirmKey>:<itemId>`. The
  same key replays; a different key after confirmation is 409; expired scans are 410.
- **Replace later.** A scan estimate is superseded by a weighed (or label) entry — see "Measured
  supersedes estimated" above; the app's "I weighed it" flow lets the user pick the right food first.

### Home

`GET /home` returns one view model (`modules/home/service.ts`) so the app never stitches together
dozens of queries. Each section (progression, today, nutrition, water, quests, activity, recognition) is computed
independently; a failing section is listed in `errors` and returned as `null` while the rest of Home
still loads. The app renders it through a pure `HomeView`, keeps the last good copy when a refresh
fails (with a banner), and refetches on focus, foreground, midnight rollover and every 5 minutes.

### Quests

Progress is always computed from logged activity (`questMetrics`). A completed quest writes one XP
event keyed `questId:periodKey`, so repeated or concurrent evaluation never awards twice; while a
period is open the award follows real progress (deleting the logs that completed it withdraws the
XP). Quests needing something the user can't do yet (nutrition targets, camera verification) are not
offered. The weekly training target follows the user's plan, capped at 6 to keep a rest day.
Completion and withdrawal emit `quest.completed` / `quest.withdrawn` domain events. Weekly quests
include Consistency (train on plan), Protein Target (4 days), Form Master (30 reps scoring ≥ 85, not
from a serious-pain workout) and Personal Best (a PR that beats an earlier record).

### Recognition: PRs, streaks, achievements, Body Quest, celebrations

All derived from authoritative server records, all idempotent; `syncRecognition` brings them up to
date on reads (`/progress`, `/home`, `/achievements`, `/streaks`, `/body-quest`, `/celebrations`)
and after a workout completes.

- **Personal records** are detected inside the workout's transaction, only from camera-verified
  sets (and the server's workout history). Each metric in `PR_METRICS` declares its direction,
  unit, minimum step and whether it is jump-checked: heaviest weight, estimated 1RM, most verified
  reps (bodyweight), best form score and best range of motion (3+ verified reps), most verified reps
  in a workout, and longest training streak. The first value is a baseline; beating it is a record
  (a `personal_record.set` event); a jump of more than 25% is held for review. The workout's PR
  bonus (+30, max 3) counts improved *exercises*, not metrics, and never the streak record.
- **Streaks** use the user's time zone. The workout streak allows the rest the plan schedules
  (`plannedRestDays`: 3 days a week → 2 in a row, once a week → 6); a serious-pain workout never
  extends it and it plus 3 recovery days never break it. Nutrition (finished days on target — never
  under the safe minimum), quest (days with a daily quest done) and weekly consistency (weeks that
  met the plan, capped at 6 days) streaks complete the set. Current and longest are derived; each
  milestone emits one `streak.milestone` event per run.
- **Achievements** (`ACHIEVEMENTS`): First Rep, First Workout, Form Master, Consistent, PR Breaker,
  Nutrition On Track, Hundred Club — locked → in progress → unlocked from lifetime metrics that
  exclude serious-pain sessions. An unlock is one immutable row (primary key), one
  `achievement.unlocked` event and one ledger award (`achievement:<id>`), linked to each other.
- **Body Quest** (`BodyQuestEngine`): Starter → Foundation → Builder → Athlete → Elite from six
  0–100 stats — Strength (own verified improvement, +50% = 100), Muscle (weekly sets per muscle
  group, 10 = full; protein adds 20% with targets and 7+ logged days), Endurance (minutes/week vs
  150), Mobility (average ROM), Form (average form score), Consistency (planned days trained,
  recovery excused; today is pending). No stat uses body weight or appearance; each reports
  `insufficient_data` with what it needs. A stage needs an overall score, stats with data and weeks
  of history (e.g. Builder: 40, 4 stats, 4 weeks). Every finished week gets an immutable snapshot
  (evaluated as of its Sunday, 26 weeks kept); each stage first reached emits one event.
- **Celebrations** are those domain events from the last 7 days not yet seen. Several milestones of
  one streak run, several stages at once, or several records of one exercise in one workout collapse
  into one; dismissing it marks the group seen. The app shows them in an overlay over the tabs; a
  workout's own records are celebrated on its summary and marked seen there.
- **AI Coach** context gets aggregates only: stage, stats measured, streaks, achievements unlocked,
  next achievement — plus a rule never to suggest skipping rest, training hurt or under-eating for a
  streak or achievement.

### Progress analytics

- **Ranges:** 7, 30 or 90 whole local days ending on the user's today (their stored time zone);
  every record is read by its local date. 7 and 30 days plot daily, 90 days weekly; the current
  bucket, and a week cut by the range start, are marked partial.
- **ProgressAnalyticsService** (`progressAnalytics`) reads workouts, verified sets (form, ROM,
  load — never from serious-pain sessions), food logs (same totals as the Eat tab, with estimated vs
  weighed shares), weight entries, the XP ledger, records, completed quests, Body Quest snapshots,
  achievements and streaks, and returns sections (each with availability, goal focus and a plain
  interpretation), chart models and daily/weekly/monthly summaries. Strength can be filtered to one
  exercise (estimated 1RM for loaded lifts, verified reps for bodyweight moves).
- **Trend engine** (`computeTrend`): least-squares fit over the real points; IMPROVING / STABLE /
  DECLINING judged in each metric's direction (`METRICS`: higher, lower, or steady), with a
  stability band, a minimum point count and a minimum span — otherwise INSUFFICIENT_DATA with the
  reason. Weight is judged only against the user's own energy goal (lose → lower, gain → higher,
  maintain/recomp → steady). Consistency counts only from the user's start (first workout or
  account), so earlier weeks aren't "missed". No percentiles, comparisons or body-composition output.
- **Chart models:** points per bucket (null = no data), estimated and partial flags, an optional
  target line, the trend, `trendUnit` when the trend is in a different unit (calories plotted, % from
  target trended), and a state: `ok`, `partial`, `insufficient_data`, `no_data`. `chartForUnits`
  converts kg to lb for imperial users after the trend is computed.
- **Performance:** one pass per table per request using local-date indexes (v16 adds xp_events,
  personal_records and user_quests indexes); results are cached in memory per user, range, exercise,
  day and time zone, keyed by a data fingerprint (counts and latest timestamps of every table read,
  goal and settings), so any new or edited record invalidates the entry on the next read. A 90-day
  range over dense data computes well under a second; repeats are served from cache.
- **Goal awareness:** `GOAL_FOCUS_SECTIONS` orders sections and marks the ones that speak most
  directly to the goal; interpretations describe the data only.
- **AI Coach:** gets 30-day trend words and counts (`analytics.30d.*` facts), never raw series.

### AI Coach

- **Providers:** `REAL_AI_PROVIDER` (Claude via `@anthropic-ai/sdk`, structured output, refusal
  fallback, stable system prompt cached, per-user facts in a separate block), `DETERMINISTIC_FALLBACK`
  (rules over the same facts) and `UNAVAILABLE`. `COACH_PROVIDER` selects; `anthropic` without
  credentials degrades to rules. Every response carries `provider` and, for a fallback, `degraded`
  (unconfigured, timeout, rate_limited, provider_error, invalid_output, daily_limit); the app labels
  rules as rules — never as AI.
- **CoachContextBuilder** sends keyed *facts* (`training.workoutsLast7Days`, `form.averageScore`,
  `nutrition.today.proteinRemainingG`, `bodyQuest.stage`, `records.0.value`, `streaks.workout.current`,
  quests, goal, experience, plan, equipment, local date/time…) plus hard food constraints and safety
  notes. No name, email, credentials, body measurements, photos, camera data or food names.
- **CoachResponse:** message, category, priority, evidence (fact, claim, value), actions (catalogued,
  each with a real route), confidence, generatedAt, provider, degraded.
- **Validation** (`validateCoachOutput`), for AI *and* rules: facts are written as `{{fact.key}}`
  placeholders the server renders; a literal number must equal a fact of the matching kind (kcal to
  kcal, sessions to training counts…), or be a bounded prescription outside claim sentences (sets
  1–6, reps 1–30, rest 5–300 s, ≤ 5 kg / 10% increases…); evidence must cite real facts; PR, streak,
  today's-workout and food claims need data; named exercises must be done recently or possible with
  the user's equipment. Safety lexicons reject starvation/restriction, dehydration, dangerous
  progression, diagnosis, mental-state inference, links, weight-loss advice for minors, training while
  recovering or a second workout today; allergen and diet terms (broad stems) are rejected. Unsuitable
  actions are dropped. Any failure → the labelled rules answer.
- **Rules coach:** recovery first after serious pain; rest days stay rest; nutrition never names foods
  and never goes below the safe minimum; progression only on clean reps; goal-specific wording.
- **Reliability & cost:** provider timeout + a hard deadline even if the provider ignores its signal;
  typed failures map to `degraded`; insights are cached per topic, day and context fingerprint (an
  unchanged day costs one call); real AI calls per user per day (`COACH_DAILY_AI_CALLS`) and chat
  messages per hour (`COACH_CHAT_PER_HOUR`) are capped; chat is idempotent per client message id.
- **Privacy & retention:** chat history (user text + validated response) is kept 30 days and can be
  cleared (`DELETE /coach/messages`); cached insights 7 days; `coach_calls` holds only outcome and
  provider type for limits. Rejected AI answers log reason codes only, never content.
- **Surfaces:** Home "Today's tip" (`topic=home`), the workout summary's note on the session
  (`topic=workout`), and Coach chat with quick questions (workout, form, nutrition, consistency, PRs,
  Body Quest, progression).

### Personalization

`buildPersonalization(profile, preferences, goalHistory, asOf)` is the single interpretation every
future workout, nutrition and AI system consumes. It separates **hard** constraints (allergens,
custom allergies, diet restrictions) from **soft** preferences (dislikes, diet styles, cooking time,
budget), resolves the goal in force on `asOf`, and lists unanswered onboarding steps (`missing`) so
consumers fall back to defaults instead of guessing. The AI coach receives hard food constraints via
`CoachContextBuilder`; dislikes are never sent.

Profile edits are applied by `applyProfilePatch` (API `modules/users/service.ts`): strict schemas
allow only user-editable fields (no mass assignment), derived fields are recomputed server-side, a
goal change is recorded in goal history, a weight change is recorded in weight history, and any
change to calculator inputs snapshots new targets from the user's local date.

### Onboarding

Steps: goal → body → training → nutrition → habits → review. Each step saves on Continue, so a
returning user resumes at `onboarding.nextStep`. Completion requires every step answered; afterwards
required answers can be edited but never cleared. Pre-Stage-B users keep access and see which
sections are still missing.

### Profile, settings & privacy

- **Profile** is a private control centre of real data only: photo, goal, level/XP/rank, streaks,
  records, Body Quest, achievements, a 30-day training and 7-day food summary (`GET /me/summary`, the
  same numbers Progress shows), recent workouts, weight and the plan. Edits go through
  `applyProfilePatch` (see Personalization): a goal change is recorded in goal history and affects
  targets, plans and coaching from the user's today onwards — past workouts, logs, XP and targets keep
  the values they were made with.
- **Units:** storage is canonical metric everywhere. `shared/measurement.ts` holds every conversion
  constant (kg/lb, cm/in, g/oz, ml/fl oz) and `toDisplay` / `fromDisplay` / `cmToFtIn` /
  `formatMeasure`; nutrition units, analytics and the app's `lib/units.ts` all use it, so a value
  round-trips without drift.
- **Settings** (`user_settings`): units, date format, time zone (synced from the device only while
  `timezoneAuto` is on; otherwise a validated IANA zone the user picks), ads/analytics opt-ins, and
  privacy switches. Consents default **off**: `aiCoachConsent` (send coaching facts to the AI
  provider), `foodScanConsent` (send meal photos to the recognition provider); `aiCoachEnabled` and
  `coachKeepHistory` default on. The server enforces them — without AI consent the coach answers with
  the labelled rules (`degraded: no_consent`); with coaching off `/coach/*` returns 403
  `coach_disabled`; with history off chat is neither stored nor sent as context, and switching it off
  deletes stored chat; scans without consent return 403 `scan_consent_required` (the app asks inline,
  then retries). Settings patches are strict (unknown keys → 400).
- **Notifications** (`notification_preferences`, `GET/PATCH /me/notifications`): what FORM *may*
  notify about (workout reminders and time, meals, weekly summary, achievements, streaks, coach tips)
  and quiet hours (`inQuietHours`), all off by default. This is separate from the OS permission; the
  app shows the device state honestly (this build has no push integration, so it says so and keeps
  the choices for later).
- **Account & security:** `POST /auth/password` re-checks the current password, refuses an unchanged
  one and bumps `token_version`, so every other session ends; the caller gets a fresh token.
  Sessions are stateless JWTs, so there is no per-device list — "sign out of this device" clears the
  token store and query cache, "sign out everywhere" (`/auth/logout-all`) revokes every token.
- **Privacy center** (`/me/data-summary`, `POST /me/export`, `DELETE /me`), reachable from Settings
  and, before onboarding is finished, from onboarding (root `/privacy` route guarded only by sign-in):
  - The **data map** is built by schema introspection: every table with a `user_id` column, child
    tables reached through their parent (`CHILD_TABLES`) and declared system tables. A test fails if
    any table is unaccounted for, so a new table can't silently escape export or deletion.
  - **Export** requires the password, is rate-limited (3/hour), returns a versioned
    `form-data-export` JSON of every row (binary fields base64, `password_hash` and `token_version`
    withheld) with `content-disposition: attachment` and `cache-control: no-store`. Web downloads it;
    native writes it to app documents and opens the share sheet.
  - **Deletion** requires the password and typing `DELETE` (rate-limited 5 per 15 min). An active
    store-verified subscription returns 409 `subscription_active` until the user acknowledges that
    FORM can't cancel store billing. Everything is deleted in one transaction; the data map is then
    re-checked and any remaining row rolls the whole deletion back (500 `deletion_incomplete`). Any
    failure reports "nothing was deleted" — success is only shown after the server confirms, and then
    the app signs out. Requests already sent to outside providers (AI coach, meal recognition) are
    governed by their retention terms; FORM never stored them.
- **Media:** profile photos are served only to their owner (no public URLs); scan photos are never
  stored. On the device, picked, resized and captured temp files are deleted after upload
  (`privateFiles.discardTemp`).
- **Legal:** `GET /legal` returns only the configured `LEGAL_TERMS_URL` / `LEGAL_PRIVACY_URL` (https);
  the app shows the links only when they exist. FORM ships no legal text of its own.
- **Security audit (tested, `privacyO.test.ts`):** strict schemas on every user write, so client-set
  `userId`, `xp`, `tier`, `tokenVersion`, `energyGoal` or onboarding fields are rejected (400); every
  id-addressed route is scoped to the caller (a second user probing live sessions and sets, food and
  water logs, meal plans and planned meals, and grocery items is denied, and the owner's data is
  intact); there are no client routes that write XP, records, achievements or entitlements, and a
  forged store receipt leaves the tier free; photos are `no-store`, `nosniff`, owner-only and must be
  real PNG/JPEG; switching accounts clears every cached query.

### Integration (Stage P)

- **One clock.** Once a user's time zone is stored, the server's "today" is the only today:
  entry dates sent by the client (workouts, weights, water) are checked against it
  (`assertEntryDate`: never in the future, back-dating only where allowed, plus one day so a
  request queued before midnight still lands after it); profile changes take effect from it. The
  app derives its own "today" from the same stored zone (`setUserTimeZone` in `lib/dates.ts`), so a
  manually chosen zone or a phone that has travelled never shows a different day from the server.
- **Idempotency first.** A retried request is answered before anything else is checked —
  `POST /workouts` looks up the client id before the date check, so a workout saved before
  midnight and retried after it is the same workout, not a refused one.
- **Single flight for providers.** Requests that wait on an outside provider (coach chat and
  insights, meal recognition) run once per key (`shared/singleFlight.ts`): a retry that arrives
  while the first is in flight shares its result — one call, one cost, one answer.
- **Workouts left open.** A running session untouched for more than 90 minutes
  (`SESSION_LIMITS.idleMinutes`) was left open. The idle gap is absorbed as paused time on the next
  action or on completion, so it never counts as training, XP or the daily training cap. The session
  says `leftOpen` and `idleSince`; the app stops the clock, labels it "Left open" and offers to
  carry on, finish with what was logged, or discard.
- **Reconciliation** (`modules/integrity`, `npm run reconcile -w @form/api [-- --repair] [--user id]`,
  built as `dist/reconcile.js`): audits every user's derived state against its source records —
  workout awards and events, settled nutrition days, quest and achievement rewards, the personal
  record chain, superseded estimates, engine-calculated food values, planned meals, sessions,
  profile weight, goal history and targets — plus SQLite's `quick_check` and every foreign key.
  Findings are `error` (inconsistent), `warning` (suspicious) or `info` (expected for now, e.g. a
  day waiting for the user's next visit to settle). `--repair` applies only append-only or
  cache-recomputing fixes (a compensating ledger entry, a missing idempotent award, recomputing the
  profile weight); history is never rewritten, and everything else is reported for a person. Exit
  code 1 while errors remain, for scheduled checks. The end-to-end suite runs it after every journey.
- **Observability.** Structured JSON logs (pino) with a request id on every line and in an
  `x-request-id` response header; a 500 returns only `{ code: "internal", details: { requestId } }`.
  Redacted wherever they appear: auth headers, passwords, tokens, emails; bodies are never logged.
  Provider failures log the error class and code, never messages or content. Every domain event is
  logged by type and key when first written (`domain event`), never with its payload. `/health`
  checks the database and reports the schema version (503 if it can't). `LOG_LEVEL` and
  `RATE_LIMIT_PER_MINUTE` are configurable. The app sends no telemetry: `analyticsConsent` is stored,
  and no analytics provider exists.
- **Fallback register.** Every fallback is labelled where the user sees it and in
  `/system/providers` / `/system/features`:

  | Fallback | When | How it's identified |
  |---|---|---|
  | Rules coach | no AI configured, no consent, AI fails / times out / invalid / daily cap | `provider.type = deterministic_fallback`, `degraded` reason; "Rule-based tip" in the app |
  | Development meal recogniser | `FOOD_RECOGNITION_PROVIDER=development` (refused in production) | `provider.development = true`; "DEVELOPMENT SAMPLE — this isn’t real food recognition" banner |
  | Simulated kitchen scale | `EXPO_PUBLIC_SIMULATED_SCALE=1` in development builds only | "Simulated scale (development)" device name |
  | No scanner / AI / store / ads | provider unconfigured | feature `available: false` with a reason; the app hides or explains it |
  | Native pose tracking | no native pose module in this build | "Camera coaching isn't available in this version of FORM on phones yet"; sets are logged unverified |
  | Push notifications | not integrated | Notifications screen says the build can't send them yet |
  | Editorial photography | not licensed yet | calm gradient instead of an image — never a generated person |

- **Performance.** The end-to-end suite captures every SQL statement the journeys run and fails on
  any full scan of a table (migration v18 added the indexes it found: sets by workout, reps by set,
  records by workout, planned meals and Body Quest goals by user, expired scans). A user with 270
  days of history loads every main screen in well under a second in the suite (Home ~50 ms, 90-day
  analytics ~200 ms, export ~250 ms, the audit ~80 ms). In the app, returning to a screen refreshes
  it at most once per 30 s (the query stale time); Home is one aggregated request.
- **Accessibility.** `apps/mobile/test/a11yAudit.ts` runs after every component test: every
  control has a role and an accessible name, text fields have labels (not just placeholders), and
  icon-only controls have a 44 × 44 target. Stack headers use a shared 44 pt Back button that says
  where it goes ("Back to Profile").
- **Social (not built).** Nothing is shared between users. Future-compatible by construction:
  opaque user ids, per-user scoping everywhere (tested by an id-route sweep), domain events that a
  feed could consume, and consents that default off — a social layer would add its own visibility
  settings rather than expose existing data.

### FORM Pro (Stage R)

**Your AI coach, always adapting.** Free stays genuinely useful (onboarding, workouts and tracking,
camera-verified reps, form and ROM per set, food logging and weighing, a few meal scans a day,
one-day meal plans, 7/30-day progress, XP, levels, ranks, quests, Body Quest, achievements, records,
streaks). Pro adds a coaching layer built only from the user's own data.

- **Entitlements, one place.** `subscriptions/entitlements.ts` (domain) holds the premium feature
  registry (`PREMIUM_FEATURES`: id, title, what Pro adds, what Free keeps), the Free allowances and
  the subscription state machine: provider status + renewal + time → `FREE`, `PRO_TRIAL`,
  `PRO_ACTIVE`, `PRO_CANCELLED` (renewal off: Pro until the period ends), `PRO_GRACE_PERIOD` (payment
  failed: Pro until grace ends), `PRO_BILLING_ISSUE` (no access while the store retries),
  `PRO_EXPIRED` (period over, refunded or revoked). The API's EntitlementService
  (`modules/billing/entitlements.ts`: `entitlementsFor`, `can`, `requireFeature`) is the only server
  check; Pro work refused for Free returns **402 `pro_required`** with the feature id, title and what
  Free keeps. The app reads the server's answer (`lib/pro.ts`) to choose what to show — it never
  decides access, and nothing it sends can change the answer.
- **Billing provider abstraction** (`subscriptions/billing.ts`): products (prices and trials are the
  provider's — never hard-coded), `verifyPurchase`, `restore`, `parseWebhook` (signature + freshness),
  `manageUrl`. Subscription state changes only from a provider-verified transaction or a verified
  event. A store subscription belongs to the first FORM account that verified it
  (`original_transaction_id` is unique): restoring it into another account is refused.
- **Development store** (`providers/devBilling.ts`, `BILLING_PROVIDER=development`, refused in
  production): a sandbox store with products (configured display prices, default $9.99/month and
  $59.99/year), HMAC-signed receipts, restore per device "store account", and signed lifecycle
  notifications (renew, cancel, resume, payment failure → grace → billing retry, recovery, expiry,
  refund) delivered through the real webhook endpoint. Everything it touches is labelled
  `environment: development`. No App Store / Google Play adapter is included (not configured).
- **Webhooks** (`POST /billing/webhooks/:provider`, public, rate-limited): the raw body is verified
  before parsing (HMAC over `timestamp.body`, constant-time compare, ±5-minute window against
  replays); each event id is processed once (`billing_events`); an event older than the last one
  applied to that subscription is recorded as stale and ignored; events for an unlinked subscription
  are recorded and skipped (the purchase's own verification reads current state).
- **Pro features** (all server-gated, all from stored records):
  - *Advanced AI Coach / deeper personalization*: the configured daily AI budget and unlimited chat
    (Free: `FREE_AI_CALLS_PER_DAY` real AI answers, then labelled rules; `FREE_COACH_CHAT_PER_DAY`
    messages); the coach also gets 90-day trends and the Body Quest focus stat.
  - *Adaptive training* (`workouts/adaptive.ts`): starts from the rule-based plan and its safety rules,
    progresses only when reps hit the top of the range with form ≥ 80 and ROM ≥ 90 (when measured),
    holds the load when performance rose but form fell ≥ 8, steps back after two short sessions at one
    load, trims a set when fewer than half the planned days were trained; every decision explains its
    numbers, and without camera data it says so. Today's plan switches generator on upgrade or expiry
    unless today's workout has begun.
  - *Form intelligence* (`analysis/formIntelligence.ts`, `GET /exercises/:id/form-intelligence`):
    per-session form, ROM and rep-to-rep spread, trends, technique issues earlier vs recently, form by
    load — from stored verified reps; no biomechanics the camera can't see.
  - *Meal scans*: Free `FREE_SCANS_PER_DAY` per local day (402 with weighing/search/labels always
    available); Pro within the hourly and service-wide limits.
  - *Advanced meal planning*: week plans, saved recipes preferred, `GET /meal-plans/rest-of-today`
    (meals sized to what's left of today's targets, never below the safe floor; suggestions only).
  - *Advanced progress*: 90-day range; form and ROM sections are emptied server-side for Free
    (`lockForTier`) — the data never leaves the server.
  - *Weekly report* (`reports/weeklyReport.ts`, `/reports/weekly`): the last finished week from
    workouts, verified reps, form, ROM, records, protein days, XP and Body Quest snapshots, highlights
    and one rule-based focus; a coach note only when generated within two days of the week's end (the
    coach reads the last 7 days), dated. Stored once per week; reports stay viewable after Pro ends.
  - *Body Quest insights* (`bodyQuest/insights.ts`): weekly history and 4-week change per stat, the
    lowest stat, and what moves each stat in the engine's own terms.
  - *No ads*.
- **History is never touched by billing.** Expiry, refunds and cancellations change only what
  happens next; workouts, food, records, Body Quest snapshots and generated reports stay.
- **App**: `/pro` paywall (`PaywallView`: value list with what Free keeps, the provider's plans and
  prices, savings computed from them, trial only if offered, purchase, restore, manage, legal links
  when configured, sandbox lifecycle controls in development), `ProUpsell` / `ProUpsellFor` where a
  locked feature would be, Settings card with the real state, weekly report screen, form history on
  exercise pages, rest-of-today on the meal plan, Body Quest insights, an "Adaptive · Pro" badge. The
  development store's purchase runs checkout → `/billing/verify`; a real store client isn't part of
  this build, so the paywall says purchases aren't connected rather than pretending.


The production-readiness audit, its findings register (P0–P3), the privacy inventory and the
operations runbook (environment, backups and restore, reconciliation, logs) are in
[RELEASE.md](RELEASE.md). Code added: service-wide provider budgets (`shared/providerBudget.ts`),
a per-account login throttle, prompt-injection hardening (data-not-instructions clause and an
instruction-leak check on AI answers), a calorie/macro consistency rule for typed entries,
first-party crash reports (`POST /client-errors`, scrubbed, logged only), a verified backup CLI
(`dist/backup.js`), a share-sheet export that leaves no copy on the phone, and a web focus ring.

### Migrations

Append-only. Each runs in a transaction; `schema_migrations` records the version. v2/v3 upgraded
existing databases in place (XP moved into the ledger; existing users' targets back-filled). v4
rebuilt `profiles` with nullable onboarding fields (legacy goals mapped to primary goals with the
same energy strategy); v5 seeded weight history from existing profile weights; v6 added the stored
time zone and water logs; v8 added rep/set analysis audit columns and the domain_events outbox; v9 rebuilt food_logs for the full FoodLog model (legacy rows mapped conservatively: only scale = measured, camera = scan estimate, meal from the local hour) and added user_foods; v10 added food_scans and `scan_id` / `meal_name` / `replaced_log_id` on food_logs; v11 rebuilt food_logs for every portion unit and full measurement provenance (legacy rows keep their values: via from the unit, grams from gram amounts, measured ⇒ typed, `calc_version` NULL); v12 added meal_plans, planned_meals, saved_recipes and grocery_items; v13 rebuilt xp_events as the signed, append-only progression ledger (kind, idempotency key, domain event, local date; existing rows kept as awards) and added progression_state; v16 added analytics indexes (xp_events and personal_records by local date, user_quests by status); v15 added coach_messages, coach_insights and coach_calls; v14 made personal_records append-only (with `previous` and `local_date`, back-filled), made achievement unlocks immutable (reward, value, domain event), and added body_quest_snapshots and celebration_seen; v7 added workout plans, live sessions and session sets, plus target reps
and form score on workout sets; v17 added the privacy settings (time zone mode, date format, AI coach and
food-scan consents, coach history) and notification_preferences, moving any `reminders_enabled` opt-in
into workout reminders before dropping that column; v18 added the indexes found by the Stage P
query-plan audit (sets by workout, reps by set, records by workout, planned meals and Body Quest goals by
user, unconfirmed scans by expiry); v19 added provider_usage (service-wide daily provider call counts, no personal data); v20 rebuilt subscriptions for provider-verified state and added billing_events, dev_store_transactions and weekly_reports.

## App architecture

- **Routing:** Expo Router. Root gate: signed out → `sign-in`; profile incomplete → `onboarding`;
  otherwise the five tabs. Offline `/me` failures never trap users in onboarding. The privacy center
  (`/privacy`) is open to any signed-in user, so export and deletion never depend on onboarding.
- **State:** React Query for all server state (`lib/queries.ts`). Mutations invalidate exactly what
  they change. The cache is cleared on sign-in/out so no user's data survives on a shared device.
- **Session:** token in the OS keychain/keystore (native) or `sessionStorage` (web). Any 401 signs out.
- **Design system (human-first):** technology powers the experience; it is not the visual identity.
  - Tokens (`theme/tokens.ts`, contrast-tested against WCAG AA): deep charcoal surfaces, off-white
    type, one emerald (`primary`) for action and progress, amber (`accent`) for rewards and streaks,
    blue only for water. No neon, glow or gradient buttons; gradients only as quiet surface lifts
    and image scrims.
  - Type: Inter (loaded in the root layout, system fallback), an editorial scale — `display`,
    `title`, `heading`, `body`, sentence-case `label`, and a rare uppercase `overline` eyebrow.
  - Components (`components/ui`): `Screen` (quiet eyebrow + title, or a custom `hero`), `Card`
    (default / raised / plain for open layouts), `HeroMedia`, solid pill `Button` (optional trailing
    arrow), `Stat` (label, number, thin progress), animated `ProgressBar` (reduced-motion aware),
    `ListRow`, `Divider`, `Badge` (sentence case), `StateView` / `ErrorState` / `InlineMessage`.
  - Imagery: `theme/imagery.ts` holds editorial photo slots (home, train, nutrition, progress,
    onboarding, record). All are null until licensed photography is added; `HeroMedia` shows a calm
    gradient instead. Never generated images presented as real people or as the user's own data.
  - Language: coach, not machine. "Full body detected", "8 verified reps", "Great form", "You're 42 g
    short on protein today" — no confidence scores, joint angles, frame rates or movement states in
    the user experience (they stay in the engines and dev tooling).
- **States:** every screen renders loading / success / empty / error (with retry) / unavailable.
- **Responsive:** bottom tabs on phones, side rail ≥ 900 dp; content max width 640.
- **Accessibility:** roles and labels on all controls, header roles, radio-group semantics for
  segmented choices, 44 dp touch targets for icon buttons, capped font scaling for large numerals
  only, reduced-motion respected.

## Build & validation

`npm run validate` = typecheck (domain, API, app) → lint (app) → tests (domain, API, app, including
the end-to-end journeys in `apps/api/test/e2e.test.ts` and the accessibility audit after every app
component test) → build (API server and reconcile CLI via esbuild, app web export) → production smoke
test: the built API runs a short real journey, its logs are checked for leaks, and the built
reconcile CLI must find that journey consistent.
CI runs the same command (`.github/workflows/ci.yml`).
