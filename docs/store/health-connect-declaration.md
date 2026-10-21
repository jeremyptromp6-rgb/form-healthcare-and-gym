# Health Connect: Play Console declaration (READ_STEPS)

Where: Play Console > Policy and programs > App content > **Health apps** (and the Health Connect permissions
declaration form). Google must approve the declaration before the permission works for store users; allow up to a
week and submit it early. Verify the form's current wording in Play Console.

## Facts

| Item | Value |
|---|---|
| Permission | `android.permission.health.READ_STEPS` only (declared in `apps/mobile/app.json`) |
| Library | `react-native-health-connect` (Expo config plugin) |
| Access | Read only. FORM never writes to Health Connect. No background access, no history permission, no other record types |
| What is read | The total step count for today and yesterday (Health Connect already merges the phone and any connected watch) |
| When | After the user taps "Connect steps" and grants the permission, then when the steps card refreshes |
| Stored | One number per day on FORM's server (`steps_daily`), tied to the account, plus the XP it earned |
| Shared | No. Not sold, not used for advertising, profiling or credit decisions |
| Retention | Until the account is deleted (deleted with it) |
| Optional | Yes. Every other feature works without it. Permission can be revoked in Health Connect at any time |
| Privacy policy | `https://<api-host>/privacy` (mentions Health Connect steps: what, why, retention) |

## Justification text (paste into "Why does your app need this permission?")

```
FORM is a workout and nutrition tracker. It reads the user's daily step count from Health Connect (READ_STEPS only) so the Home screen can show today's steps against a goal and so FORM can award a small amount of in-app XP for them (1 XP per 1,000 steps, at most 10 a day). Steps are optional: the user taps "Connect steps" and chooses whether to grant access, and every other feature works without it. FORM only reads the step total for today and yesterday and never writes to Health Connect or reads any other record type. The daily total is sent over TLS to FORM's server, stored against the user's account, and deleted when they delete their account. It is not used for advertising or profiling, and it is not sold or shared with any third party. Without this permission the app cannot show the user's steps or award step XP.
```

## Core-functionality check

If Play asks whether the data is core to the app: it supports one feature (the steps card and step XP) and is not
required for the main purpose (camera rep counting, workouts, nutrition). Pick the option for an optional supporting
feature, not "core".

## Manifest items the declaration checks

- The config plugin adds the permission-rationale activity (Android 13 and older) and the `VIEW_PERMISSION_USAGE`
  alias (Android 14+) that link to the privacy policy. Confirm both exist in the release AAB's merged manifest
  (see `release-checklist.md`).
- `minSdkVersion` is 26 via `expo-build-properties`.
- The privacy-policy link must work without signing in: `/privacy` does.

## Data safety consistency

In the data safety form: Fitness info (steps) collected, not shared, optional, purpose App functionality
(see `data-safety.md`).
