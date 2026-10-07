import { calculateTargets, defaultMealType, isValidTimeZone, localHourIn, type BodyProfile } from "@form/domain";
import type { DatabaseSync } from "node:sqlite";

/**
 * Schema migrations, applied in order inside a transaction each. Never edit a migration
 * that has shipped — add a new one.
 */
export interface Migration {
  version: number;
  name: string;
  up: string | ((db: DatabaseSync) => void);
}

const V1_INITIAL = `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE profiles (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    sex TEXT NOT NULL,
    age_years INTEGER NOT NULL,
    height_cm REAL NOT NULL,
    weight_kg REAL NOT NULL,
    activity TEXT NOT NULL,
    goal TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE workouts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_workout_id TEXT NOT NULL,
    local_date TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL,
    pain_level TEXT NOT NULL,
    xp_awarded INTEGER NOT NULL,
    xp_flags TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (user_id, client_workout_id)
  );
  CREATE INDEX workouts_user_date ON workouts(user_id, local_date);

  CREATE TABLE workout_sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workout_id TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    exercise_id TEXT NOT NULL,
    reps INTEGER NOT NULL,
    verified_reps INTEGER NOT NULL,
    verification_status TEXT NOT NULL,
    rom_percent INTEGER,
    load_kg REAL NOT NULL
  );

  CREATE TABLE personal_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    exercise_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    value REAL NOT NULL,
    status TEXT NOT NULL,
    workout_id TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
  );
  CREATE INDEX pr_user_exercise ON personal_records(user_id, exercise_id);

  CREATE TABLE food_entries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    local_date TEXT NOT NULL,
    name TEXT NOT NULL,
    grams REAL,
    source TEXT NOT NULL,
    kcal REAL NOT NULL,
    protein_g REAL NOT NULL,
    carbs_g REAL NOT NULL,
    fat_g REAL NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX food_user_date ON food_entries(user_id, local_date);

  CREATE TABLE subscriptions (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    source TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  `;

const V2_FOUNDATION = `
  -- Token revocation: bumping token_version invalidates every issued session token.
  ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;

  ALTER TABLE profiles ADD COLUMN display_name TEXT;
  ALTER TABLE profiles ADD COLUMN onboarding_completed_at TEXT;
  UPDATE profiles SET onboarding_completed_at = updated_at;

  CREATE TABLE user_settings (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    units TEXT NOT NULL DEFAULT 'metric' CHECK (units IN ('metric', 'imperial')),
    personalized_ads_consent INTEGER NOT NULL DEFAULT 0 CHECK (personalized_ads_consent IN (0, 1)),
    analytics_consent INTEGER NOT NULL DEFAULT 0 CHECK (analytics_consent IN (0, 1)),
    reminders_enabled INTEGER NOT NULL DEFAULT 0 CHECK (reminders_enabled IN (0, 1)),
    updated_at TEXT NOT NULL
  );

  -- NutritionTarget snapshots: past days are judged against the targets in force that day.
  CREATE TABLE nutrition_targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    effective_from TEXT NOT NULL,
    bmr_kcal INTEGER NOT NULL,
    tdee_kcal INTEGER NOT NULL,
    target_kcal INTEGER NOT NULL,
    safe_floor_kcal INTEGER NOT NULL,
    protein_g INTEGER NOT NULL,
    carbs_g INTEGER NOT NULL,
    fat_g INTEGER NOT NULL,
    applied_goal TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (user_id, effective_from)
  );

  ALTER TABLE food_entries RENAME TO food_logs;

  ALTER TABLE workout_sets ADD COLUMN set_index INTEGER NOT NULL DEFAULT 0;

  CREATE TABLE verified_reps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    set_id INTEGER NOT NULL REFERENCES workout_sets(id) ON DELETE CASCADE,
    rep_index INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    min_angle_deg REAL NOT NULL,
    rom_percent INTEGER NOT NULL,
    UNIQUE (set_id, rep_index)
  );

  -- XPEvent ledger: the only source of a user's XP total.
  CREATE TABLE xp_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (source IN ('workout', 'nutrition_day', 'quest', 'achievement')),
    source_key TEXT NOT NULL,
    xp INTEGER NOT NULL CHECK (xp >= 0),
    detail TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, source, source_key)
  );
  INSERT INTO xp_events (user_id, source, source_key, xp, detail, created_at, updated_at)
    SELECT user_id, 'workout', id, xp_awarded, json_object('flags', json(xp_flags)), created_at, created_at FROM workouts;
  ALTER TABLE workouts DROP COLUMN xp_awarded;

  CREATE TABLE user_quests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    quest_id TEXT NOT NULL,
    period_key TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    target INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'expired')),
    completed_at TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (user_id, quest_id, period_key)
  );

  CREATE TABLE user_achievements (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    achievement_id TEXT NOT NULL,
    unlocked_at TEXT NOT NULL,
    PRIMARY KEY (user_id, achievement_id)
  );

  CREATE TABLE body_quests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    goal TEXT NOT NULL CHECK (goal IN ('lose_fat', 'build_muscle', 'recomposition', 'maintain')),
    status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'abandoned')),
    start_date TEXT NOT NULL,
    target_date TEXT NOT NULL,
    start_weight_kg REAL NOT NULL,
    target_weight_kg REAL NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX body_quests_one_active ON body_quests(user_id) WHERE status = 'active';

  CREATE TABLE body_measurements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    local_date TEXT NOT NULL,
    weight_kg REAL,
    waist_cm REAL,
    created_at TEXT NOT NULL,
    UNIQUE (user_id, local_date)
  );
`;

/** Existing users keep their targets for all past days, so their history is unchanged by the ledger switch. */
function backfillNutritionTargets(db: DatabaseSync): void {
  const profiles = db.prepare("SELECT user_id, sex, age_years, height_cm, weight_kg, activity, goal FROM profiles").all() as {
    user_id: string;
    sex: BodyProfile["sex"];
    age_years: number;
    height_cm: number;
    weight_kg: number;
    activity: BodyProfile["activity"];
    goal: BodyProfile["goal"];
  }[];
  const insert = db.prepare(
    `INSERT INTO nutrition_targets (user_id, effective_from, bmr_kcal, tdee_kcal, target_kcal, safe_floor_kcal, protein_g, carbs_g, fat_g, applied_goal, created_at)
     VALUES (?, '1970-01-01', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const now = new Date().toISOString();
  for (const p of profiles) {
    const t = calculateTargets({ sex: p.sex, ageYears: p.age_years, heightCm: p.height_cm, weightKg: p.weight_kg, activity: p.activity, goal: p.goal });
    insert.run(p.user_id, t.bmrKcal, t.tdeeKcal, t.targetKcal, t.safeFloorKcal, t.proteinG, t.carbsG, t.fatG, t.appliedGoal, now);
  }
}

/**
 * Stage B — onboarding & personalization. SQLite can't relax NOT NULL in place, so profiles is
 * rebuilt with nullable onboarding fields. Legacy goals map to the primary goal with the same
 * energy strategy, so existing targets are unchanged.
 */
const V4_PERSONALIZATION = `
  CREATE TABLE profiles_v4 (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    display_name TEXT,
    primary_goal TEXT CHECK (primary_goal IN ('build_muscle', 'get_stronger', 'lose_fat', 'get_lean', 'improve_fitness', 'improve_health')),
    sex TEXT CHECK (sex IN ('male', 'female', 'unspecified')),
    age_years INTEGER CHECK (age_years BETWEEN 13 AND 100),
    height_cm REAL CHECK (height_cm BETWEEN 120 AND 240),
    weight_kg REAL CHECK (weight_kg BETWEEN 30 AND 300),
    experience TEXT CHECK (experience IN ('beginner', 'intermediate', 'advanced')),
    training_days_per_week INTEGER CHECK (training_days_per_week BETWEEN 1 AND 7),
    training_location TEXT CHECK (training_location IN ('home', 'gym', 'both')),
    equipment TEXT CHECK (equipment IS NULL OR json_valid(equipment)),
    activity TEXT,
    goal TEXT,
    onboarding_completed_at TEXT,
    updated_at TEXT NOT NULL
  );
  INSERT INTO profiles_v4 (user_id, display_name, primary_goal, sex, age_years, height_cm, weight_kg, activity, goal, onboarding_completed_at, updated_at)
    SELECT user_id, display_name,
           CASE goal WHEN 'lose' THEN 'lose_fat' WHEN 'gain' THEN 'build_muscle' ELSE 'improve_health' END,
           sex, age_years, height_cm, weight_kg, activity, goal, onboarding_completed_at, updated_at
    FROM profiles;
  DROP TABLE profiles;
  ALTER TABLE profiles_v4 RENAME TO profiles;

  -- Goal history: the goal in force on each day. New goals shape the future; history is kept.
  CREATE TABLE goal_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    primary_goal TEXT NOT NULL,
    effective_from TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (user_id, effective_from)
  );
  INSERT INTO goal_history (user_id, primary_goal, effective_from, created_at)
    SELECT user_id, primary_goal, '1970-01-01', updated_at FROM profiles WHERE primary_goal IS NOT NULL;

  -- Allergies (hard constraints) and dislikes (soft preferences) are separate columns by design.
  CREATE TABLE nutrition_preferences (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    dietary_preferences TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(dietary_preferences)),
    allergens TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(allergens)),
    custom_allergies TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(custom_allergies)),
    disliked_foods TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(disliked_foods)),
    cooking_time TEXT CHECK (cooking_time IN ('under_15', '15_30', '30_60', 'over_60')),
    food_budget TEXT CHECK (food_budget IN ('low', 'medium', 'high')),
    updated_at TEXT NOT NULL
  );

  -- Profile photos: private, metadata-stripped, served only to their owner.
  CREATE TABLE profile_photos (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png')),
    data BLOB NOT NULL,
    byte_size INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

/** Weight history starts with the weight users already had on their profile (dated when it was last saved). */
const V5_BACKFILL_WEIGHT_HISTORY = `
  INSERT INTO body_measurements (user_id, local_date, weight_kg, created_at)
    SELECT p.user_id, substr(p.updated_at, 1, 10), p.weight_kg, p.updated_at FROM profiles p
    WHERE p.weight_kg IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM body_measurements m WHERE m.user_id = p.user_id AND m.weight_kg IS NOT NULL);
`;

/** Stage C — authoritative user time zone and water logging. */
const V6_HOME = `
  ALTER TABLE user_settings ADD COLUMN timezone TEXT;

  CREATE TABLE water_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_log_id TEXT NOT NULL,
    local_date TEXT NOT NULL,
    ml INTEGER NOT NULL CHECK (ml BETWEEN 50 AND 2000),
    created_at TEXT NOT NULL,
    UNIQUE (user_id, client_log_id)
  );
  CREATE INDEX water_logs_user_date ON water_logs(user_id, local_date);
`;

/** Stage D — generated plans, live workout sessions and per-set records. */
const V7_TRAIN = `
  ALTER TABLE workout_sets ADD COLUMN target_reps INTEGER;
  ALTER TABLE workout_sets ADD COLUMN form_score INTEGER;

  -- Today's workout: generated once per user per local day, so it doesn't change under the user.
  CREATE TABLE workout_plans (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    local_date TEXT NOT NULL,
    generator_id TEXT NOT NULL,
    generator_version INTEGER NOT NULL,
    plan TEXT NOT NULL CHECK (json_valid(plan)),
    created_at TEXT NOT NULL,
    UNIQUE (user_id, local_date)
  );

  -- A live workout. Its state lives on the server, so closing the app never loses a session.
  CREATE TABLE workout_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_session_id TEXT NOT NULL,
    plan_id TEXT REFERENCES workout_plans(id) ON DELETE SET NULL,
    local_date TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'completed', 'discarded')),
    exercises TEXT NOT NULL CHECK (json_valid(exercises)),
    started_at TEXT NOT NULL,
    paused_at TEXT,
    paused_ms INTEGER NOT NULL DEFAULT 0,
    rest_ends_at TEXT,
    rest_seconds INTEGER,
    completed_at TEXT,
    workout_id TEXT REFERENCES workouts(id) ON DELETE SET NULL,
    pain_level TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, client_session_id)
  );
  CREATE UNIQUE INDEX workout_sessions_one_open ON workout_sessions(user_id) WHERE status IN ('active', 'paused');

  CREATE TABLE session_sets (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
    client_set_id TEXT NOT NULL,
    exercise_id TEXT NOT NULL,
    set_index INTEGER NOT NULL,
    target_reps INTEGER,
    target_load_kg REAL,
    reps INTEGER NOT NULL CHECK (reps BETWEEN 0 AND 200),
    load_kg REAL NOT NULL CHECK (load_kg BETWEEN 0 AND 1000),
    verified_reps INTEGER NOT NULL CHECK (verified_reps >= 0 AND verified_reps <= reps),
    verification_status TEXT NOT NULL,
    rom_percent INTEGER,
    form_score INTEGER,
    verified_rep_details TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(verified_rep_details)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (session_id, client_set_id)
  );
  CREATE INDEX session_sets_session ON session_sets(session_id, created_at);
`;

/**
 * Stage F — rep verification + form analysis. Audit metadata per set (attempts, rejections, gates,
 * quality, analyzer version) and per verified rep (timing, peak, form score, issues). No video or
 * landmarks are stored. domain_events is an append-only outbox for later progression stages.
 */
const V8_REP_FORM = `
  ALTER TABLE session_sets ADD COLUMN analysis TEXT CHECK (analysis IS NULL OR json_valid(analysis));
  ALTER TABLE workout_sets ADD COLUMN analysis TEXT CHECK (analysis IS NULL OR json_valid(analysis));
  ALTER TABLE verified_reps ADD COLUMN start_ms INTEGER;
  ALTER TABLE verified_reps ADD COLUMN end_ms INTEGER;
  ALTER TABLE verified_reps ADD COLUMN peak_angle_deg REAL;
  ALTER TABLE verified_reps ADD COLUMN form_score INTEGER CHECK (form_score IS NULL OR form_score BETWEEN 0 AND 100);
  ALTER TABLE verified_reps ADD COLUMN issues TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(issues));

  CREATE TABLE domain_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    key TEXT NOT NULL,
    payload TEXT NOT NULL CHECK (json_valid(payload)),
    created_at TEXT NOT NULL,
    UNIQUE (user_id, type, key)
  );
  CREATE INDEX domain_events_user_type ON domain_events(user_id, type, id);
`;

/**
 * Stage G — nutrition. food_logs is rebuilt with the full FoodLog model: where the numbers came
 * from (source), how the amount was obtained (amount method), meal, portion and a per-100
 * snapshot, plus a per-user idempotency key. Legacy rows map conservatively: only "scale" was a
 * measurement, a camera entry stays an estimate, and the meal comes from the local hour in the
 * user's stored time zone (snack when unknown). User-created foods get their own table, and
 * target snapshots record the diet styles that shaped them.
 */
function v9Nutrition(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE food_logs_v9 (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_log_id TEXT,
      local_date TEXT NOT NULL,
      meal_type TEXT NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
      logged_at TEXT NOT NULL,
      name TEXT NOT NULL,
      brand TEXT,
      food_id TEXT,
      source TEXT NOT NULL CHECK (source IN ('verified_database', 'user_food', 'scan_estimate', 'recipe', 'manual')),
      amount_method TEXT NOT NULL CHECK (amount_method IN ('measured', 'label', 'estimated')),
      quantity REAL,
      unit TEXT CHECK (unit IS NULL OR unit IN ('g', 'oz', 'ml', 'fl_oz', 'serving')),
      serving_id TEXT,
      serving_label TEXT,
      amount REAL,
      amount_unit TEXT CHECK (amount_unit IS NULL OR amount_unit IN ('g', 'ml')),
      per100_kcal REAL,
      per100_protein_g REAL,
      per100_carbs_g REAL,
      per100_fat_g REAL,
      kcal REAL NOT NULL CHECK (kcal >= 0),
      protein_g REAL NOT NULL CHECK (protein_g >= 0),
      carbs_g REAL NOT NULL CHECK (carbs_g >= 0),
      fat_g REAL NOT NULL CHECK (fat_g >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      -- A scan is never a measurement; a measurement always has an amount.
      CHECK (source <> 'scan_estimate' OR amount_method = 'estimated'),
      CHECK (amount_method <> 'measured' OR amount IS NOT NULL)
    );
  `);
  const rows = db
    .prepare(`SELECT f.*, s.timezone FROM food_logs f LEFT JOIN user_settings s ON s.user_id = f.user_id`)
    .all() as { id: string; user_id: string; local_date: string; name: string; grams: number | null; source: string; kcal: number; protein_g: number; carbs_g: number; fat_g: number; created_at: string; timezone: string | null }[];
  const insert = db.prepare(
    `INSERT INTO food_logs_v9 (id, user_id, client_log_id, local_date, meal_type, logged_at, name, source, amount_method, quantity, unit, amount, amount_unit,
       kcal, protein_g, carbs_g, fat_g, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of rows) {
    const meal = r.timezone && isValidTimeZone(r.timezone) ? defaultMealType(localHourIn(r.timezone, new Date(r.created_at))) : "snack";
    const source = r.source === "camera_estimate" ? "scan_estimate" : "manual";
    let method = r.source === "scale" ? "measured" : r.source === "label" ? "label" : "estimated";
    if (method === "measured" && r.grams === null) method = "estimated";
    const grams = r.grams;
    insert.run(r.id, r.user_id, r.local_date, meal, r.created_at, r.name, source, method, grams, grams === null ? null : "g", grams, grams === null ? null : "g",
      r.kcal, r.protein_g, r.carbs_g, r.fat_g, r.created_at, r.created_at);
  }
  db.exec(`
    DROP TABLE food_logs;
    ALTER TABLE food_logs_v9 RENAME TO food_logs;
    CREATE INDEX food_user_date ON food_logs(user_id, local_date);
    CREATE UNIQUE INDEX food_logs_client ON food_logs(user_id, client_log_id) WHERE client_log_id IS NOT NULL;
    CREATE INDEX food_user_recent ON food_logs(user_id, logged_at);

    CREATE TABLE user_foods (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_food_id TEXT NOT NULL,
      name TEXT NOT NULL,
      brand TEXT,
      basis TEXT NOT NULL CHECK (basis IN ('g', 'ml')),
      kcal REAL NOT NULL,
      protein_g REAL NOT NULL,
      carbs_g REAL NOT NULL,
      fat_g REAL NOT NULL,
      serving_label TEXT NOT NULL,
      serving_amount REAL NOT NULL CHECK (serving_amount > 0),
      created_at TEXT NOT NULL,
      deleted_at TEXT,
      UNIQUE (user_id, client_food_id)
    );
    CREATE INDEX user_foods_user ON user_foods(user_id) WHERE deleted_at IS NULL;

    ALTER TABLE nutrition_targets ADD COLUMN diet_styles TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(diet_styles));
  `);
}

/**
 * Stage H — food scanner. A scan keeps only the reviewed recognition result (labels, estimates,
 * options) for up to 24 h so the confirmation can be verified server-side and replayed
 * idempotently — never the photo. Logs created from a scan point back to it, and a log can record
 * which scan estimate it replaced (e.g. once the food is weighed).
 */
const V10_FOOD_SCANS = `
  CREATE TABLE food_scans (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_scan_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ok', 'no_food', 'poor_image', 'unknown_food')),
    provider TEXT NOT NULL,
    development INTEGER NOT NULL CHECK (development IN (0, 1)),
    review TEXT NOT NULL CHECK (json_valid(review)),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    confirmed_at TEXT,
    confirm_key TEXT,
    UNIQUE (user_id, client_scan_id)
  );
  CREATE INDEX food_scans_user_created ON food_scans(user_id, created_at);

  ALTER TABLE food_logs ADD COLUMN scan_id TEXT;
  ALTER TABLE food_logs ADD COLUMN meal_name TEXT;
  ALTER TABLE food_logs ADD COLUMN replaced_log_id TEXT;
  CREATE INDEX food_logs_scan ON food_logs(scan_id) WHERE scan_id IS NOT NULL;
`;

/**
 * Stage I — measured food. food_logs is rebuilt to accept every portion unit (kg, lb, L, cups,
 * spoons, pieces, items) and to keep the full provenance of each number: how the amount was
 * normalised (by weight, by volume, through a density, by count), the gram-first weight when
 * known, the density used, the calculator version, whether a measured weight was typed or read
 * from a scale, the meal it belongs to, and a snapshot of any scan estimate it superseded.
 * Legacy rows keep their values; their calc_version stays NULL (pre-engine, stored rounded).
 */
const V11_MEASURED_FOOD = `
  CREATE TABLE food_logs_v11 (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_log_id TEXT,
    local_date TEXT NOT NULL,
    meal_type TEXT NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
    logged_at TEXT NOT NULL,
    name TEXT NOT NULL,
    brand TEXT,
    food_id TEXT,
    source TEXT NOT NULL CHECK (source IN ('verified_database', 'user_food', 'scan_estimate', 'recipe', 'manual')),
    amount_method TEXT NOT NULL CHECK (amount_method IN ('measured', 'label', 'estimated')),
    quantity REAL,
    unit TEXT CHECK (unit IS NULL OR unit IN ('g', 'kg', 'oz', 'lb', 'ml', 'l', 'fl_oz', 'cup', 'tbsp', 'tsp', 'serving', 'piece', 'item')),
    serving_id TEXT,
    serving_label TEXT,
    amount REAL,
    amount_unit TEXT CHECK (amount_unit IS NULL OR amount_unit IN ('g', 'ml')),
    amount_via TEXT CHECK (amount_via IS NULL OR amount_via IN ('mass', 'volume', 'density', 'count')),
    grams REAL,
    density_g_per_ml REAL,
    per100_kcal REAL,
    per100_protein_g REAL,
    per100_carbs_g REAL,
    per100_fat_g REAL,
    kcal REAL NOT NULL CHECK (kcal >= 0),
    protein_g REAL NOT NULL CHECK (protein_g >= 0),
    carbs_g REAL NOT NULL CHECK (carbs_g >= 0),
    fat_g REAL NOT NULL CHECK (fat_g >= 0),
    calc_version INTEGER,
    weight_source TEXT CHECK (weight_source IS NULL OR weight_source IN ('typed', 'scale')),
    scan_id TEXT,
    meal_id TEXT,
    meal_name TEXT,
    replaced_log_id TEXT,
    replaced_estimate TEXT CHECK (replaced_estimate IS NULL OR json_valid(replaced_estimate)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    -- A scan is never a measurement.
    CHECK (source <> 'scan_estimate' OR amount_method = 'estimated'),
    -- A measurement has an amount read directly by weight or volume: not a count, not a density conversion.
    CHECK (amount_method <> 'measured' OR (amount IS NOT NULL AND (amount_via IS NULL OR amount_via IN ('mass', 'volume')))),
    -- Only a measurement says where its weight came from.
    CHECK (weight_source IS NULL OR amount_method = 'measured')
  );
  INSERT INTO food_logs_v11 (id, user_id, client_log_id, local_date, meal_type, logged_at, name, brand, food_id, source, amount_method, quantity, unit,
    serving_id, serving_label, amount, amount_unit, amount_via, grams, density_g_per_ml, per100_kcal, per100_protein_g, per100_carbs_g, per100_fat_g,
    kcal, protein_g, carbs_g, fat_g, calc_version, weight_source, scan_id, meal_id, meal_name, replaced_log_id, replaced_estimate, created_at, updated_at)
  SELECT id, user_id, client_log_id, local_date, meal_type, logged_at, name, brand, food_id, source, amount_method, quantity, unit,
    serving_id, serving_label, amount, amount_unit,
    CASE WHEN unit IN ('g', 'oz') THEN 'mass' WHEN unit IN ('ml', 'fl_oz') THEN 'volume' WHEN unit = 'serving' THEN 'count' ELSE NULL END,
    CASE WHEN amount_unit = 'g' THEN amount ELSE NULL END,
    NULL, per100_kcal, per100_protein_g, per100_carbs_g, per100_fat_g,
    kcal, protein_g, carbs_g, fat_g, NULL,
    CASE WHEN amount_method = 'measured' THEN 'typed' ELSE NULL END,
    scan_id, scan_id, meal_name, replaced_log_id, NULL, created_at, updated_at
  FROM food_logs;
  DROP TABLE food_logs;
  ALTER TABLE food_logs_v11 RENAME TO food_logs;
  CREATE INDEX food_user_date ON food_logs(user_id, local_date);
  CREATE UNIQUE INDEX food_logs_client ON food_logs(user_id, client_log_id) WHERE client_log_id IS NOT NULL;
  CREATE INDEX food_user_recent ON food_logs(user_id, logged_at);
  CREATE INDEX food_logs_scan ON food_logs(scan_id) WHERE scan_id IS NOT NULL;
  CREATE INDEX food_logs_meal ON food_logs(user_id, meal_id) WHERE meal_id IS NOT NULL;
  -- One active replacement per superseded estimate.
  CREATE UNIQUE INDEX food_logs_replaced ON food_logs(user_id, replaced_log_id) WHERE replaced_log_id IS NOT NULL;
`;

/**
 * Stage J — meal planning. A plan covers one day or a week; planned meals point at library recipes
 * with a portion size. A planned meal is "eaten" only when the user marks it (which writes a food
 * log, linked here) — the plan itself never counts as food. Saved recipes are bookmarks. Grocery
 * items come from a plan (regenerated when it changes), from a recipe, or are typed in.
 */
const V12_MEAL_PLANS = `
  CREATE TABLE meal_plans (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_plan_id TEXT NOT NULL,
    start_date TEXT NOT NULL,
    days INTEGER NOT NULL CHECK (days IN (1, 7)),
    status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
    targets TEXT NOT NULL CHECK (json_valid(targets)),
    warnings TEXT NOT NULL CHECK (json_valid(warnings)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, client_plan_id)
  );
  CREATE INDEX meal_plans_user ON meal_plans(user_id, status, start_date);

  CREATE TABLE planned_meals (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL REFERENCES meal_plans(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    local_date TEXT NOT NULL,
    slot TEXT NOT NULL CHECK (slot IN ('breakfast', 'lunch', 'dinner', 'snack')),
    recipe_id TEXT NOT NULL,
    servings REAL NOT NULL CHECK (servings >= 0.5 AND servings <= 2.5),
    position INTEGER NOT NULL,
    food_log_id TEXT,
    eaten_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX planned_meals_plan ON planned_meals(plan_id, local_date, position);
  CREATE UNIQUE INDEX planned_meals_log ON planned_meals(food_log_id) WHERE food_log_id IS NOT NULL;

  CREATE TABLE saved_recipes (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipe_id TEXT NOT NULL,
    saved_at TEXT NOT NULL,
    PRIMARY KEY (user_id, recipe_id)
  );

  CREATE TABLE grocery_items (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_item_id TEXT,
    source TEXT NOT NULL CHECK (source IN ('plan', 'recipe', 'custom')),
    plan_id TEXT,
    food_id TEXT,
    name TEXT NOT NULL,
    amount REAL,
    amount_unit TEXT CHECK (amount_unit IS NULL OR amount_unit IN ('g', 'ml')),
    quantity_text TEXT,
    aisle TEXT NOT NULL CHECK (aisle IN ('protein', 'carbohydrates', 'produce', 'other')),
    checked INTEGER NOT NULL DEFAULT 0 CHECK (checked IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (source = 'custom' OR (food_id IS NOT NULL AND amount IS NOT NULL AND amount_unit IS NOT NULL))
  );
  CREATE INDEX grocery_items_user ON grocery_items(user_id, source);
  CREATE UNIQUE INDEX grocery_items_client ON grocery_items(user_id, client_item_id) WHERE client_item_id IS NOT NULL;
`;

/**
 * Stage K — the authoritative progression ledger. xp_events becomes append-only: every change is
 * a new signed entry (award, settlement adjustment, decay, reset, correction) with a per-user
 * idempotency key, an optional link to the domain event behind it, and its local date. Triggers
 * refuse UPDATE and DELETE (except when the whole account is deleted). Existing entries are kept
 * as awards with keys "<source>:<reference>". progression_state records how far the daily
 * consistency rules (decay, reset) have been applied, so each day is evaluated exactly once.
 */
const V13_PROGRESSION_LEDGER = `
  CREATE TABLE xp_events_v13 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (source IN ('workout', 'nutrition_day', 'quest', 'achievement', 'decay', 'reset', 'correction')),
    source_key TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('award', 'adjustment', 'decay', 'reset', 'correction')),
    xp INTEGER NOT NULL,
    idempotency_key TEXT NOT NULL,
    domain_event_id INTEGER REFERENCES domain_events(id),
    local_date TEXT,
    detail TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail)),
    created_at TEXT NOT NULL,
    UNIQUE (user_id, idempotency_key),
    CHECK (kind <> 'award' OR xp >= 0),
    CHECK (kind <> 'decay' OR xp <= 0),
    CHECK (kind <> 'reset' OR xp = 0)
  );
  INSERT INTO xp_events_v13 (id, user_id, source, source_key, kind, xp, idempotency_key, domain_event_id, local_date, detail, created_at)
  SELECT e.id, e.user_id, e.source, e.source_key, 'award', e.xp, e.source || ':' || e.source_key, NULL,
    CASE e.source
      WHEN 'workout' THEN (SELECT w.local_date FROM workouts w WHERE w.id = e.source_key)
      WHEN 'nutrition_day' THEN e.source_key
      WHEN 'quest' THEN substr(e.source_key, instr(e.source_key, ':') + 1)
      ELSE substr(e.created_at, 1, 10)
    END,
    CASE WHEN json_valid(e.detail) THEN e.detail ELSE '{}' END, e.created_at
  FROM xp_events e ORDER BY e.id;
  DROP TABLE xp_events;
  ALTER TABLE xp_events_v13 RENAME TO xp_events;
  CREATE INDEX xp_events_user ON xp_events(user_id, id);
  CREATE INDEX xp_events_reference ON xp_events(user_id, source, source_key);

  CREATE TRIGGER xp_events_append_only_update BEFORE UPDATE ON xp_events
  BEGIN SELECT RAISE(ABORT, 'xp_events is append-only: add a compensating entry instead'); END;
  CREATE TRIGGER xp_events_append_only_delete BEFORE DELETE ON xp_events
  WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id)
  BEGIN SELECT RAISE(ABORT, 'xp_events is append-only: add a compensating entry instead'); END;

  CREATE TABLE progression_state (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    evaluated_through TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

/**
 * Stage L — recognition. Personal records gain the value they beat and their local date, and become
 * append-only (a record, once set, is history). Achievement unlocks record their reward and the
 * domain event behind them, and are immutable. Body Quest stores one immutable weekly snapshot per
 * finished week. celebration_seen remembers which celebrations (domain events) a user has seen.
 */
const V14_RECOGNITION = `
  ALTER TABLE personal_records ADD COLUMN previous REAL;
  ALTER TABLE personal_records ADD COLUMN local_date TEXT;
  UPDATE personal_records SET local_date = (SELECT w.local_date FROM workouts w WHERE w.id = personal_records.workout_id);
  CREATE INDEX pr_user_kind ON personal_records(user_id, kind, exercise_id);
  CREATE TRIGGER personal_records_append_only_update BEFORE UPDATE ON personal_records
  BEGIN SELECT RAISE(ABORT, 'personal_records is append-only'); END;
  CREATE TRIGGER personal_records_append_only_delete BEFORE DELETE ON personal_records
  WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id) AND EXISTS (SELECT 1 FROM workouts WHERE id = OLD.workout_id)
  BEGIN SELECT RAISE(ABORT, 'personal_records is append-only'); END;

  ALTER TABLE user_achievements ADD COLUMN xp_reward INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE user_achievements ADD COLUMN metric_value INTEGER;
  ALTER TABLE user_achievements ADD COLUMN domain_event_id INTEGER REFERENCES domain_events(id);
  CREATE TRIGGER user_achievements_immutable_update BEFORE UPDATE ON user_achievements
  BEGIN SELECT RAISE(ABORT, 'achievement unlocks are permanent'); END;
  CREATE TRIGGER user_achievements_immutable_delete BEFORE DELETE ON user_achievements
  WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id)
  BEGIN SELECT RAISE(ABORT, 'achievement unlocks are permanent'); END;

  CREATE TABLE body_quest_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    week_start TEXT NOT NULL,
    as_of TEXT NOT NULL,
    stage TEXT NOT NULL CHECK (stage IN ('starter', 'foundation', 'builder', 'athlete', 'elite')),
    overall INTEGER CHECK (overall IS NULL OR overall BETWEEN 0 AND 100),
    stats TEXT NOT NULL CHECK (json_valid(stats)),
    engine_version INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (user_id, week_start)
  );
  CREATE TRIGGER body_quest_snapshots_immutable_update BEFORE UPDATE ON body_quest_snapshots
  BEGIN SELECT RAISE(ABORT, 'body quest snapshots are history'); END;
  CREATE TRIGGER body_quest_snapshots_immutable_delete BEFORE DELETE ON body_quest_snapshots
  WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id)
  BEGIN SELECT RAISE(ABORT, 'body quest snapshots are history'); END;

  CREATE TABLE celebration_seen (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id INTEGER NOT NULL REFERENCES domain_events(id) ON DELETE CASCADE,
    seen_at TEXT NOT NULL,
    PRIMARY KEY (user_id, event_id)
  );
`;

/**
 * Stage M — AI Coach. coach_messages keeps chat history (the user's text and the validated coach
 * response) for at most 30 days and can be cleared by the user. coach_insights caches a validated
 * insight per topic, day and context fingerprint (so an unchanged day never pays for a second
 * call). coach_calls is a content-free usage record for rate limits and cost control.
 */
const V15_COACH = `
  CREATE TABLE coach_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_message_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'coach')),
    text TEXT NOT NULL,
    response TEXT CHECK (response IS NULL OR json_valid(response)),
    created_at TEXT NOT NULL,
    UNIQUE (user_id, client_message_id, role)
  );
  CREATE INDEX coach_messages_user ON coach_messages(user_id, id);

  CREATE TABLE coach_insights (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    topic TEXT NOT NULL,
    local_date TEXT NOT NULL,
    context_hash TEXT NOT NULL,
    response TEXT NOT NULL CHECK (json_valid(response)),
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, topic, local_date, context_hash)
  );

  CREATE TABLE coach_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    local_date TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('insight', 'chat')),
    provider_type TEXT NOT NULL,
    outcome TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX coach_calls_user ON coach_calls(user_id, created_at);
`;

/** Stage N — indexes for range queries over the ledger and records (analytics reads by local date). */
const V16_ANALYTICS_INDEXES = `
  CREATE INDEX xp_events_user_date ON xp_events(user_id, local_date);
  CREATE INDEX pr_user_date ON personal_records(user_id, local_date);
  CREATE INDEX user_quests_user_status ON user_quests(user_id, status, period_key);
`;

/**
 * Stage O — privacy controls. Settings gain time-zone mode, date format and explicit consents (an
 * external AI coach and the food-photo provider are opt-in; the coach can be switched off; chat
 * history can be turned off). Notification preferences get their own table — they are FORM's
 * preferences, separate from the device's notification permission. The old single
 * reminders flag moves into it (as workout reminders) and its column is dropped.
 */
const V17_PRIVACY = `
  ALTER TABLE user_settings ADD COLUMN timezone_auto INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE user_settings ADD COLUMN date_format TEXT NOT NULL DEFAULT 'system' CHECK (date_format IN ('system', 'day_month', 'month_day', 'iso'));
  ALTER TABLE user_settings ADD COLUMN ai_coach_enabled INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE user_settings ADD COLUMN ai_coach_consent INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE user_settings ADD COLUMN coach_keep_history INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE user_settings ADD COLUMN food_scan_consent INTEGER NOT NULL DEFAULT 0;

  CREATE TABLE notification_preferences (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    workout_reminders INTEGER NOT NULL DEFAULT 0,
    workout_reminder_time TEXT NOT NULL DEFAULT '18:00',
    meal_reminders INTEGER NOT NULL DEFAULT 0,
    weekly_summary INTEGER NOT NULL DEFAULT 0,
    achievement_alerts INTEGER NOT NULL DEFAULT 0,
    streak_alerts INTEGER NOT NULL DEFAULT 0,
    coach_tips INTEGER NOT NULL DEFAULT 0,
    quiet_start TEXT,
    quiet_end TEXT,
    updated_at TEXT NOT NULL
  );
  INSERT INTO notification_preferences (user_id, workout_reminders, quiet_start, quiet_end, updated_at)
    SELECT user_id, 1, '22:00', '07:00', updated_at FROM user_settings WHERE reminders_enabled = 1;
  ALTER TABLE user_settings DROP COLUMN reminders_enabled;
`;

/**
 * Stage P — indexes found by the end-to-end query-plan audit. Child rows were reached through
 * their parent's id with no index on that id, so every lookup of a workout's sets (and a set's
 * reps, a workout's records) read the whole table — every user's rows. Also: planned meals and
 * Body Quest goals by user, and the expired-scan cleanup.
 */
const V18_INTEGRATION_INDEXES = `
  CREATE INDEX IF NOT EXISTS workout_sets_workout ON workout_sets(workout_id, set_index);
  CREATE INDEX IF NOT EXISTS verified_reps_set ON verified_reps(set_id, rep_index);
  CREATE INDEX IF NOT EXISTS personal_records_workout ON personal_records(workout_id);
  CREATE INDEX IF NOT EXISTS planned_meals_user ON planned_meals(user_id, local_date);
  CREATE INDEX IF NOT EXISTS body_quests_user ON body_quests(user_id);
  CREATE INDEX IF NOT EXISTS food_scans_unconfirmed_expiry ON food_scans(expires_at) WHERE confirmed_at IS NULL;
`;

/**
 * Stage Q — service-wide daily usage of paid outside providers (no user ids: a count per UTC day),
 * behind the global cost ceilings. Survives account deletion, so it can't be reset that way.
 */
const V19_PROVIDER_USAGE = `
  CREATE TABLE provider_usage (
    day TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('ai_coach', 'food_recognition')),
    calls INTEGER NOT NULL CHECK (calls >= 0),
    PRIMARY KEY (day, provider)
  );
`;

/**
 * Stage R — FORM Pro. Subscriptions are rebuilt to hold the provider-verified state (status,
 * renewal, period and grace ends, environment) and the store's original transaction id, which ties
 * one store subscription to one FORM account. billing_events records every provider event once
 * (idempotency, replay protection, audit). dev_store_transactions is the development store's own
 * ledger (store-side data: no FORM user ids). weekly_reports keeps generated Pro reports.
 */
const V20_PRO = `
  CREATE TABLE subscriptions_v20 (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('trial', 'active', 'grace_period', 'billing_retry', 'expired', 'revoked')),
    auto_renew INTEGER NOT NULL CHECK (auto_renew IN (0, 1)),
    period_end TEXT NOT NULL,
    grace_end TEXT,
    source TEXT NOT NULL CHECK (source IN ('store', 'development', 'admin_grant')),
    environment TEXT NOT NULL CHECK (environment IN ('production', 'sandbox', 'development')),
    original_transaction_id TEXT UNIQUE,
    last_event_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  INSERT INTO subscriptions_v20 (user_id, product_id, status, auto_renew, period_end, grace_end, source, environment, original_transaction_id, last_event_at, created_at, updated_at)
    SELECT user_id, 'legacy',
      CASE status WHEN 'grace_period' THEN 'grace_period' WHEN 'expired' THEN 'expired' WHEN 'revoked' THEN 'revoked' ELSE 'active' END,
      0, expires_at, CASE status WHEN 'grace_period' THEN expires_at END,
      CASE source WHEN 'admin_grant' THEN 'admin_grant' ELSE 'store' END,
      'production', NULL, NULL, updated_at, updated_at
    FROM subscriptions;
  DROP TABLE subscriptions;
  ALTER TABLE subscriptions_v20 RENAME TO subscriptions;

  CREATE TABLE billing_events (
    event_id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    type TEXT NOT NULL,
    original_transaction_id TEXT NOT NULL,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    occurred_at TEXT NOT NULL,
    received_at TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('applied', 'stale', 'unknown_subscription'))
  );
  CREATE INDEX billing_events_user ON billing_events(user_id, received_at);

  CREATE TABLE dev_store_transactions (
    original_transaction_id TEXT PRIMARY KEY,
    store_account TEXT NOT NULL,
    product_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('trial', 'active', 'grace_period', 'billing_retry', 'expired', 'revoked')),
    auto_renew INTEGER NOT NULL CHECK (auto_renew IN (0, 1)),
    period_end TEXT NOT NULL,
    grace_end TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX dev_store_transactions_account ON dev_store_transactions(store_account);

  CREATE TABLE weekly_reports (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    week_start TEXT NOT NULL,
    report TEXT NOT NULL CHECK (json_valid(report)),
    coach TEXT CHECK (coach IS NULL OR json_valid(coach)),
    generated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, week_start)
  );
`;

export const MIGRATIONS: Migration[] = [
  { version: 1, name: "initial", up: V1_INITIAL },
  { version: 2, name: "foundation", up: V2_FOUNDATION },
  { version: 3, name: "backfill_nutrition_targets", up: backfillNutritionTargets },
  { version: 4, name: "personalization", up: V4_PERSONALIZATION },
  { version: 5, name: "backfill_weight_history", up: V5_BACKFILL_WEIGHT_HISTORY },
  { version: 6, name: "home", up: V6_HOME },
  { version: 7, name: "train", up: V7_TRAIN },
  { version: 8, name: "rep_form", up: V8_REP_FORM },
  { version: 9, name: "nutrition", up: v9Nutrition },
  { version: 10, name: "food_scans", up: V10_FOOD_SCANS },
  { version: 11, name: "measured_food", up: V11_MEASURED_FOOD },
  { version: 12, name: "meal_plans", up: V12_MEAL_PLANS },
  { version: 13, name: "progression_ledger", up: V13_PROGRESSION_LEDGER },
  { version: 14, name: "recognition", up: V14_RECOGNITION },
  { version: 15, name: "coach", up: V15_COACH },
  { version: 16, name: "analytics_indexes", up: V16_ANALYTICS_INDEXES },
  { version: 17, name: "privacy", up: V17_PRIVACY },
  { version: 18, name: "integration_indexes", up: V18_INTEGRATION_INDEXES },
  { version: 19, name: "provider_usage", up: V19_PROVIDER_USAGE },
  { version: 20, name: "pro", up: V20_PRO },
];
