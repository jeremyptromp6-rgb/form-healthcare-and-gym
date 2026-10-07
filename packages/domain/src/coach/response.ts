import { ONBOARDING_STEPS } from "../users/users";
import { canPerform, EXERCISES, EXERCISE_BY_ID } from "../workouts/exercises";
import type { CoachContext, CoachProviderType, CoachTopic, FactValue, RawCoachOutput } from "./coach";

/**
 * CoachResponse and its validator.
 *
 * Every model output is untrusted input. Before anything is shown it must pass:
 * - shape: known category/priority/confidence, bounded lengths and counts;
 * - grounding: facts about the user are written as {{fact.key}} placeholders the server fills from
 *   the domain; any literal number must equal a known fact or be a bounded prescription (sets,
 *   reps, minutes…); evidence must cite real facts; PR/streak/workout/nutrition claims need data;
 * - safety: no starvation, extreme restriction, dehydration, dangerous progression, diagnosis,
 *   mental-state inference, links, or food that violates an allergy or diet restriction;
 * - actions: only catalogued actions, with valid parameters, that make sense today.
 * Failures are rejected (the caller falls back to deterministic coaching), never "fixed up".
 */

export const COACH_CATEGORIES = ["daily_insight", "workout", "form", "nutrition", "consistency", "pr", "body_quest", "progression", "recovery", "general"] as const;
export type CoachCategory = (typeof COACH_CATEGORIES)[number];
export const COACH_PRIORITIES = ["low", "normal", "high"] as const;
export const COACH_CONFIDENCE = ["low", "medium", "high"] as const;

/** Every action routes to a real screen. Training actions are withheld when they don't fit today. */
export const COACH_ACTIONS = {
  open_train: { route: "/train", training: true },
  view_exercise: { route: "/train/exercise/{exerciseId}", training: false },
  log_food: { route: "/eat/add", training: false },
  open_eat: { route: "/eat", training: false },
  open_meal_plan: { route: "/eat/plan", training: false },
  open_recipes: { route: "/eat/recipes", training: false },
  open_progress: { route: "/progress", training: false },
  open_body_quest: { route: "/progress/body-quest", training: false },
  open_achievements: { route: "/progress/achievements", training: false },
  edit_profile: { route: "/profile/edit/{section}", training: false },
  open_coach: { route: "/coach", training: false },
} as const;
export type CoachActionId = keyof typeof COACH_ACTIONS;
export const COACH_ACTION_IDS = Object.keys(COACH_ACTIONS) as CoachActionId[];

export type CoachDegradation = "unconfigured" | "no_consent" | "timeout" | "rate_limited" | "provider_error" | "invalid_output" | "daily_limit";

export interface CoachResponse {
  topic: CoachTopic;
  message: string;
  category: CoachCategory;
  priority: (typeof COACH_PRIORITIES)[number];
  evidence: { fact: string; claim: string; value: string }[];
  actions: { id: CoachActionId; label: string; route: string }[];
  confidence: (typeof COACH_CONFIDENCE)[number];
  generatedAt: string;
  provider: { type: CoachProviderType; name: string };
  /** Why a fallback answered instead of the AI (null when the provider answered). */
  degraded: CoachDegradation | null;
}

export const COACH_LIMITS = { messageChars: 600, evidence: 5, actions: 3, actionLabelChars: 40, claimChars: 140 } as const;

// ---- Facts ---------------------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function formatFact(v: FactValue): string {
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString("en-GB") : (Math.round(v * 10) / 10).toLocaleString("en-GB");
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (ISO_DATE.test(v)) return new Date(`${v}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  return v;
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

/** Fills {{fact.key}} placeholders from the domain. Unknown keys or yes/no facts in prose are errors. */
export function renderPlaceholders(text: string, facts: Record<string, FactValue>): { text: string; unknown: string[] } {
  const unknown: string[] = [];
  const out = text.replace(PLACEHOLDER, (_, key: string) => {
    const v = facts[key];
    if (v === undefined || typeof v === "boolean") {
      unknown.push(key);
      return "";
    }
    return formatFact(v);
  });
  return { text: out, unknown };
}

// ---- Numbers -----------------------------------------------------------------------------------

/** Bounds for numbers that are advice rather than claims (inclusive). Units not listed must be grounded. */
const PRESCRIPTION: Record<string, [number, number]> = {
  set: [1, 6],
  rep: [1, 30],
  minute: [1, 90],
  second: [5, 300],
  hour: [1, 10],
  day: [1, 7],
  week: [1, 12],
  time: [1, 7],
  meal: [1, 6],
  g: [10, 60],
  kg: [0.5, 5],
  ml: [100, 750],
  "%": [1, 10],
  "": [0, 10],
};
const UNIT_ALIASES: [RegExp, string][] = [
  [/^sets?$/, "set"],
  [/^reps?$/, "rep"],
  [/^(minutes?|mins?)$/, "minute"],
  [/^(seconds?|secs?)$/, "second"],
  [/^(hours?|hrs?)$/, "hour"],
  [/^days?$/, "day"],
  [/^weeks?$/, "week"],
  [/^(times?|x)$/, "time"],
  [/^meals?$/, "meal"],
  [/^(g|grams?)$/, "g"],
  [/^(kg|kilos?)$/, "kg"],
  [/^ml$/, "ml"],
  [/^%$/, "%"],
  [/^(kcal|calories|cals?)$/, "kcal"],
  [/^(workouts?|sessions?)$/, "workout"],
  [/^(xp|levels?)$/, "xp"],
];
const NUMBER_WITH_UNIT =
  /(?<![\w.])(\d+(?:\.\d+)?)(?:\s*(?:–|-|to)\s*(\d+(?:\.\d+)?))?(?:\s*(%|(?:kg|kilos?|grams?|g|kcal|calories|cals?|ml|sets?|reps?|minutes?|mins?|seconds?|secs?|hours?|hrs?|days?|weeks?|times?|x|meals?|workouts?|sessions?|xp|levels?)\b))?/gi;

function normalUnit(u: string | undefined): string {
  if (!u) return "";
  const l = u.toLowerCase();
  return UNIT_ALIASES.find(([re]) => re.test(l))?.[1] ?? l;
}

/** Which facts a number with this unit may be grounded in — a calorie claim must match a calorie fact, not any number. */
const UNIT_FACTS: Record<string, RegExp> = {
  kcal: /kcal/i,
  g: /G$/,
  kg: /Kg$|^records\.\d+\.(value|previous)$/,
  "%": /percent|overall|stats\.|score/i,
  day: /days|streaks\.(workout|nutrition|quest)|daysSince|plannedRestDays/i,
  week: /weeks|streaks\.weekly/i,
  time: /workouts|doneThisWeek|plannedThisWeek|remainingThisWeek|trainingDays/i,
  workout: /workouts|doneThisWeek|plannedThisWeek|remainingThisWeek|trainingDays/i,
  set: /\.sets$/,
  rep: /reps|Reps|progress|target/,
  minute: /Minutes$/,
  xp: /xp|level|Level/i,
  ml: /Ml$/,
  meal: /entries/,
  "": /./,
};

/**
 * A sentence that states something about the user ("you trained 3 times", "your streak is 4 days")
 * is a claim: its numbers must be facts. Elsewhere, numbers may also be bounded advice ("3 sets").
 */
const CLAIM_SENTENCE =
  /\b(you('ve| have| just)?\s+(already\s+)?(trained|worked out|did|done|completed|logged|hit|ate|eaten|had|lifted|scored|averaged|reached|managed|missed|beat|set|broke|earned|gained|lost|burned)|your\s+[a-z ]{0,30}\b(is|was|are|were|stands at|sits at|of)\b)/i;

function grounded(n: number, unit: string, facts: [string, number][]): boolean {
  const kind = UNIT_FACTS[unit] ?? UNIT_FACTS[""]!;
  return facts.some(([k, f]) => kind.test(k) && Math.abs(f - n) <= Math.max(0.5, Math.abs(f) * 0.02));
}

/** Every literal number must be a known fact (of the right kind) or a bounded prescription. Returns the offending tokens. */
export function ungroundedNumbers(text: string, facts: Record<string, FactValue>): string[] {
  // Numbers inside string facts ("60 kg") count as facts under the same key.
  const values: [string, number][] = Object.entries(facts).flatMap(([k, v]) =>
    typeof v === "number" ? [[k, v] as [string, number]] : typeof v === "string" && !ISO_DATE.test(v) ? [...v.matchAll(/\d+(?:\.\d+)?/g)].map((m) => [k, Number(m[0])] as [string, number]) : [],
  );
  const dates = new Set(Object.values(facts).filter((v): v is string => typeof v === "string" && ISO_DATE.test(v)));
  const bad: string[] = [];
  let t = text.replace(/(\d),(?=\d{3}\b)/g, "$1").replace(/\b\d{4}-\d{2}-\d{2}\b/g, (d) => {
    if (!dates.has(d)) bad.push(d);
    return " ";
  });
  t = t.replace(/\b\d{1,2}:\d{2}\b/g, " "); // times of day are not claims about the user's data
  // The context's own windows ("the last 7 days", "the last 4 weeks") describe the data, not the user.
  t = t.replace(/\b(last|past)\s+(7|28)\s+days\b|\b(last|past)\s+4\s+weeks\b/gi, " ");
  for (const sentence of t.split(/(?<=[.!?])\s+/)) {
    const claim = CLAIM_SENTENCE.test(sentence);
    for (const m of sentence.matchAll(NUMBER_WITH_UNIT)) {
      const nums = [Number(m[1]), ...(m[2] ? [Number(m[2])] : [])];
      const unit = normalUnit(m[3]);
      for (const n of nums) {
        if (grounded(n, unit, values)) continue;
        const range = PRESCRIPTION[unit];
        if (!claim && range && n >= range[0] && n <= range[1]) continue;
        bad.push(`${n}${unit ? ` ${unit}` : ""}`);
      }
    }
  }
  return bad;
}

// ---- Safety lexicons ---------------------------------------------------------------------------

const UNSAFE: { reason: string; re: RegExp }[] = [
  { reason: "unsafe_nutrition", re: /\b(starv\w*|fasting|water fast|fast for \d+|skip(ping)? (a |your |the )?(meals?|breakfast|lunch|dinner)|crash diet|detox|cleanse|very.low.calorie|eat (much )?less than|purg\w*|laxatives?|diuretics?|diet pills?|appetite suppress\w*|omad|one meal a day|cut (your )?calories (hard|drastically|way down))\b/i },
  { reason: "unsafe_hydration", re: /\b(dehydrat\w*|cut (your )?water|drink less( water)?|restrict (water|fluids?)|sweat (it|weight|the weight) (off|out)|sauna suit|water.?load\w*)\b/i },
  { reason: "dangerous_progression", re: /\b(every single day|7 days a week|seven days a week|no rest days?|skip (your |a |the )?rest( day)?|twice a day|two.a.days|(push|train|work|grind) through (the |your )?pain|ignore (the |your )?pain|max(ing)? out|test your (1rm|one.rep max|max)|to failure every|double (your )?(weight|load|volume))\b/i },
  { reason: "medical_diagnosis", re: /\b(diagnos\w*|you (may |might |probably |likely |could )?(have|'ve got|are suffering from) (an? |some )?[a-z ]{0,20}(injury|tear|tendinitis|tendonitis|strain|sprain|fracture|hernia|disorder|syndrome|deficiency|condition|disease)|take (ibuprofen|painkillers|medication)|prescri\w+)\b/i },
  { reason: "mental_state_inference", re: /\b(you (seem|sound|look|appear|must be|must feel|are|feel)( so| really| a bit| very)? (depressed|anxious|stressed|lazy|unmotivated|sad|burn(ed|t) ?out|overwhelmed|undisciplined|weak.willed|insecure)|lack (of )?(discipline|willpower)|your mental health|you'?re (lazy|depressed|anxious|weak))\b/i },
  { reason: "link_or_contact", re: /(https?:\/\/|www\.|\b\S+@\S+\.\w{2,}\b)/i },
];
const WEIGHT_LOSS = /\b(lose weight|weight loss|calorie deficit|deficit|cut calories|eat less|drop (some )?(kg|kilos|pounds|weight))\b/i;
const TRAIN_NOW = /\b(train|workout|work out|lift|hit the gym|get (a|your) (session|workout) in)\b[^.!?]{0,20}\b(today|tonight|now)\b/i;
const LOAD_JUMP = /\b(add|increase|go up|jump|bump)\b[^.!?]{0,30}?(\d+(?:\.\d+)?)\s*(kg|%)/gi;

/** Foods that contain each allergen (word stems). Kept deliberately broad: a false alarm costs a fallback, a miss could hurt someone. */
export const ALLERGEN_TERMS: Record<string, string[]> = {
  peanuts: ["peanut", "groundnut", "satay"],
  tree_nuts: ["almond", "walnut", "cashew", "pecan", "pistachio", "hazelnut", "macadamia", "brazil nut", "nut butter", "mixed nuts", "trail mix", "nutella", "praline", "marzipan"],
  milk: ["milk", "cheese", "yogurt", "yoghurt", "whey", "butter", "cream", "casein", "dairy", "kefir", "skyr", "quark", "paneer", "ghee", "latte"],
  eggs: ["egg", "omelette", "omelet", "frittata", "mayonnaise", "meringue"],
  fish: ["fish", "salmon", "tuna", "cod", "sardine", "mackerel", "anchov", "trout", "tilapia", "haddock", "herring"],
  crustaceans: ["shrimp", "prawn", "crab", "lobster", "crayfish", "langoustine"],
  molluscs: ["mussel", "oyster", "clam", "scallop", "squid", "calamari", "octopus"],
  soy: ["soy", "soya", "tofu", "tempeh", "edamame", "miso"],
  gluten: ["bread", "pasta", "wheat", "barley", "rye", "couscous", "seitan", "bagel", "toast", "wrap", "noodle", "cracker", "muesli", "granola"],
  sesame: ["sesame", "tahini", "hummus", "houmous"],
  mustard: ["mustard"],
  celery: ["celery", "celeriac"],
  lupin: ["lupin"],
  sulphites: ["sulphite", "sulfite", "wine"],
};
const MEAT = ["chicken", "beef", "pork", "turkey", "lamb", "bacon", "ham", "steak", "mince", "sausage", "jerky", "salami", "chorizo"];
export const DIET_TERMS: Record<string, string[]> = {
  vegetarian: [...MEAT, ...ALLERGEN_TERMS.fish!, ...ALLERGEN_TERMS.crustaceans!, ...ALLERGEN_TERMS.molluscs!, "gelatin"],
  vegan: [...MEAT, ...ALLERGEN_TERMS.fish!, ...ALLERGEN_TERMS.crustaceans!, ...ALLERGEN_TERMS.molluscs!, ...ALLERGEN_TERMS.milk!, ...ALLERGEN_TERMS.eggs!, "honey", "gelatin"],
  pescatarian: [...MEAT, "gelatin"],
  halal: ["pork", "bacon", "ham", "chorizo", "salami", "wine", "beer", "gelatin"],
  kosher: ["pork", "bacon", "ham", "chorizo", "shellfish", ...ALLERGEN_TERMS.crustaceans!, ...ALLERGEN_TERMS.molluscs!],
  dairy_free: ALLERGEN_TERMS.milk!,
  gluten_free: ALLERGEN_TERMS.gluten!,
};

/** Terms that would violate this user's hard food constraints, found in the text. */
export function foodViolations(text: string, food: CoachContext["food"]): string[] {
  const lower = ` ${text.toLowerCase()} `;
  const hits = new Set<string>();
  const check = (term: string) => {
    const t = term.toLowerCase().trim();
    if (t.length >= 3 && new RegExp(`(^|[^a-z])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(lower)) hits.add(t);
  };
  for (const a of food.allergens) for (const t of ALLERGEN_TERMS[a] ?? [a.replace(/_/g, " ")]) check(t);
  for (const c of food.customAllergies) check(c);
  for (const d of food.dietRestrictions) for (const t of DIET_TERMS[d] ?? []) check(t);
  return [...hits];
}

// ---- Validation --------------------------------------------------------------------------------

export type ValidationResult = { ok: true; response: CoachResponse; dropped: string[] } | { ok: false; reasons: string[] };

const oneOf = <T extends readonly string[]>(list: T, v: string): v is T[number] => (list as readonly string[]).includes(v);

export function validateCoachOutput(
  raw: RawCoachOutput,
  ctx: CoachContext,
  meta: { topic: CoachTopic; generatedAt: string; provider: CoachResponse["provider"]; degraded?: CoachDegradation | null },
): ValidationResult {
  const reasons: string[] = [];
  const dropped: string[] = [];
  const facts = ctx.facts;
  const num = (k: string) => (typeof facts[k] === "number" ? (facts[k] as number) : 0);

  if (typeof raw?.message !== "string" || !raw.message.trim()) return { ok: false, reasons: ["empty_message"] };
  if (!oneOf(COACH_CATEGORIES, raw.category)) reasons.push("unknown_category");
  if (!oneOf(COACH_PRIORITIES, raw.priority)) reasons.push("unknown_priority");
  if (!oneOf(COACH_CONFIDENCE, raw.confidence)) reasons.push("unknown_confidence");

  // Grounding: placeholders first, then whatever literal numbers remain.
  const { text: rendered, unknown } = renderPlaceholders(raw.message, facts);
  if (unknown.length) reasons.push(`unknown_fact:${unknown.join(",")}`);
  const message = rendered.replace(/\*\*|__|#+ /g, "").replace(/\s+/g, " ").trim();
  if (message.length > COACH_LIMITS.messageChars) reasons.push("message_too_long");
  const literal = raw.message.replace(PLACEHOLDER, " ");
  const badNumbers = ungroundedNumbers(literal, facts);
  if (badNumbers.length) reasons.push(`ungrounded_numbers:${badNumbers.join(",")}`);

  // Claims that need data behind them.
  if (/\b(you|you've|you have)\s+(just\s+)?(set|hit|beat|broke|smashed)\s+(a |an |your )?(new )?(PR|personal (record|best)|record)\b/i.test(message) || /\byour new (PR|record|personal (record|best))\b/i.test(message)) {
    if (num("records.recentCount") === 0) reasons.push("pr_claim_without_record");
  }
  if (/\byour (current |training |workout |weekly )?streak\b/i.test(message)) {
    const any = ["streaks.workout.current", "streaks.weekly.current", "streaks.nutrition.current", "streaks.quest.current"].some((k) => num(k) > 0);
    if (!any) reasons.push("streak_claim_without_streak");
  }
  if (/\b(you (trained|worked out|lifted|already trained)|you've (trained|worked out)) today\b/i.test(message) && facts["training.trainedToday"] !== true) reasons.push("workout_claim_not_today");
  if (/\byour (last|latest|most recent) (workout|session)\b/i.test(message) && facts["training.lastWorkoutDate"] === undefined) reasons.push("workout_claim_without_workout");
  if (/\byou('ve| have) (eaten|had|logged)\b/i.test(message) && num("nutrition.today.entries") === 0) reasons.push("nutrition_claim_without_logs");

  // Exercises named must be ones the user did or can do with their equipment.
  const lower = message.toLowerCase();
  for (const e of EXERCISES) {
    if (!lower.includes(e.name.toLowerCase())) continue;
    if (!ctx.recentExercises.some((r) => r.exerciseId === e.id) && !canPerform(e, ctx.equipment)) reasons.push(`exercise_not_available:${e.id}`);
  }

  // Safety.
  for (const u of UNSAFE) if (u.re.test(message)) reasons.push(u.reason);
  if ((ctx.safety.isMinor || ctx.safety.noWeightLossTargets) && WEIGHT_LOSS.test(message)) reasons.push("weight_loss_advice_not_allowed");
  if (ctx.safety.recovering && TRAIN_NOW.test(message)) reasons.push("training_while_recovering");
  else if (ctx.safety.trainedToday && TRAIN_NOW.test(message) && !/\b(already|done|did)\b/i.test(message)) reasons.push("second_workout_today");
  for (const m of message.matchAll(LOAD_JUMP)) {
    const n = Number(m[2]);
    if ((m[3]!.toLowerCase() === "kg" && n > 5) || (m[3] === "%" && n > 10)) reasons.push("dangerous_progression");
  }
  const food = foodViolations(message, ctx.food);
  if (food.length) reasons.push(`food_constraint:${food.join(",")}`);

  // Evidence must cite real facts.
  const evidence: CoachResponse["evidence"] = [];
  for (const e of (raw.evidence ?? []).slice(0, COACH_LIMITS.evidence)) {
    const v = facts[e?.fact];
    if (v === undefined) {
      reasons.push(`unknown_evidence:${e?.fact}`);
      continue;
    }
    const claim = renderPlaceholders(String(e.claim ?? ""), facts);
    if (claim.unknown.length || ungroundedNumbers(String(e.claim ?? "").replace(PLACEHOLDER, " "), facts).length) {
      reasons.push(`ungrounded_evidence:${e.fact}`);
      continue;
    }
    const claimText = claim.text.trim().slice(0, COACH_LIMITS.claimChars);
    if (foodViolations(claimText, ctx.food).length) reasons.push("food_constraint_in_evidence");
    evidence.push({ fact: e.fact, claim: claimText, value: formatFact(v) });
  }
  if (evidence.length === 0) reasons.push("no_evidence");

  // Actions: catalogued, valid, sensible today. Unsuitable ones are dropped, not fatal.
  const actions: CoachResponse["actions"] = [];
  for (const a of raw.actions ?? []) {
    if (actions.length >= COACH_LIMITS.actions) break;
    if (!oneOf(COACH_ACTION_IDS, a?.id)) {
      dropped.push(`unknown_action:${a?.id}`);
      continue;
    }
    const def = COACH_ACTIONS[a.id];
    if (def.training && ctx.safety.recovering) {
      dropped.push(`${a.id}:recovering`);
      continue;
    }
    let route: string = def.route;
    if (route.includes("{exerciseId}")) {
      const ex = a.exerciseId ? EXERCISE_BY_ID.get(a.exerciseId) : undefined;
      if (!ex || (!canPerform(ex, ctx.equipment) && !ctx.recentExercises.some((r) => r.exerciseId === ex.id))) {
        dropped.push(`${a.id}:bad_exercise`);
        continue;
      }
      route = route.replace("{exerciseId}", ex.id);
    }
    if (route.includes("{section}")) {
      if (!a.section || !oneOf(ONBOARDING_STEPS, a.section)) {
        dropped.push(`${a.id}:bad_section`);
        continue;
      }
      route = route.replace("{section}", a.section);
    }
    const label = String(a.label ?? "").replace(PLACEHOLDER, "").trim().slice(0, COACH_LIMITS.actionLabelChars);
    if (!label || ungroundedNumbers(label, facts).length || foodViolations(label, ctx.food).length) {
      dropped.push(`${a.id}:bad_label`);
      continue;
    }
    if (!actions.some((x) => x.route === route)) actions.push({ id: a.id, label, route });
  }

  if (reasons.length) return { ok: false, reasons };
  return {
    ok: true,
    dropped,
    response: {
      topic: meta.topic,
      message,
      category: raw.category as CoachCategory,
      priority: raw.priority as CoachResponse["priority"],
      evidence,
      actions,
      confidence: raw.confidence as CoachResponse["confidence"],
      generatedAt: meta.generatedAt,
      provider: meta.provider,
      degraded: meta.degraded ?? null,
    },
  };
}
