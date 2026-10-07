# FORM — MASTER ENGINEERING DIRECTIVE

**Tagline:** Train. Eat. Level Up.

Premium AI-powered fitness and nutrition app: personalized workouts, camera-assisted exercise
verification, form and ROM analysis, nutrition tracking, food scanning, measured food weighing, meal
planning, recipes and grocery lists, XP/levels/ranks, quests, Body Quest, achievements, PRs, streaks,
AI Coach, progress analytics, privacy/security, FORM Pro, Free-tier advertising.

## Permanent rule

**IMPLEMENT → TEST → FIX → VERIFY → REPORT.** Inspect before changing. Reuse existing architecture.

Execution order: MASTER → A → B → … → S. Each stage inspects and integrates everything before it.

## Core product

Navigation: Home | Train | Eat | Progress | Profile.
Visual direction: premium, dark-first, athletic, high contrast, rounded cards, subtle gradients,
green/teal accents, restrained secondary purple, strong typography, polished motion, mobile-first.

## Product principle

FORM never pretends intelligence exists when it does not. Food camera = estimate. No pose = no rep.
AI unavailable = honest fallback. Billing unconfigured = no fake purchase. No ad provider = no fake ad.

## Source of truth

| Concern | Owner |
| --- | --- |
| Workout completion | Workout Engine |
| Verified reps | Rep Verification Engine |
| Form | Form Analysis Engine |
| ROM | ROM Analysis |
| Nutrition | NutritionCalculator |
| XP | ProgressionEngine |
| Achievements | AchievementEngine |
| PRs | PersonalRecord system |
| Streaks | StreakEngine |
| Body Quest | BodyQuestEngine |
| AI context | CoachContextBuilder |
| Premium access | EntitlementService |
| Ads | AdService |

No business logic in UI components.

## Security

Never trust the client for XP, premium entitlement, PRs, verified reps, progression, user ownership or
privileged operations. Protect auth, authorization, user isolation, fitness/nutrition/camera/AI data,
subscription information and provider secrets.

## Privacy

Workouts, nutrition, body data, progress photos, camera information, AI conversations, PRs,
achievements, streaks and XP are private by default. Do not retain raw camera video unless required.

## Safety

Never reward starvation, dangerous dehydration, unsafe progression, cheating, excessive exercise, or
exercising through serious injury. **Progress when earned.**

## Testing

Every stage: unit, integration, authorization, regression and edge-case tests; device/E2E/provider tests
where relevant. Every major feature handles loading, success, empty, error, unavailable, retry,
permission denied, network/provider failure.

## External providers

Provider abstractions for AI, pose, food recognition, billing, ads, analytics, notifications. When a
provider is not configured: build the boundary, use dev/test fallbacks only where appropriate, never
present a fake integration as real, and report the missing configuration.

## Stage report

1. IMPLEMENTED 2. ARCHITECTURE 3. DATA 4. TESTS 5. VERIFIED 6. EXTERNAL DEPENDENCIES 7. LIMITATIONS 8. NEXT STAGE
