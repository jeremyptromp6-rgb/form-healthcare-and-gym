# Google Play store listing (copy-paste text)

Everything here is limited to what FORM does today (see `docs/RELEASE.md`, "Privacy inventory"). Do not add
claims the app cannot back up: no medical claims, no "clinically proven", no "#1", no mention of Pro features
(Pro is not purchasable yet), no mention of iOS.

Limits to check in Play Console: title 30, short description 80, full description 4,000 characters.
Character counts below were measured when this file was written; re-check after any edit.

## App name (max 30; this one is 29)

```
FORM: Rep Counter & Meal Scan
```

Alternatives if you prefer a calmer name: `FORM: Workout & Meal Tracker`, `FORM Fitness`.

## Short description (max 80; this one is 80)

```
Camera rep counting, form feedback, meal photo scan and plans that adapt to you.
```

## Full description (max 4,000; this one is about 2,800)

```
FORM is a workout and nutrition tracker that watches your reps with your phone's camera, scores your form, logs your meals from a photo, and turns your effort into ranks, streaks and XP.

COUNT REPS WITH THE CAMERA
Prop your phone up and train. FORM follows your joints on the device, counts verified reps, and tells you how your range of motion and tempo looked. The camera video is analysed on your phone and is never recorded or uploaded. Only the joint angles of a verified set are sent so the server can double-check it.

FORM FEEDBACK THAT MAKES SENSE
Every rep gets a form score. See where your depth, tempo or range slipped, how form changes as the weight goes up, and which muscles need more work.

PLANS THAT ADAPT
Tell FORM your goal, experience, schedule, equipment and where you train, and it builds workouts to fit. Plans adjust as you progress, with warm-up sets and a plate calculator so loading the bar is quick.

SCAN A MEAL, THEN CHECK IT
Take a photo of your meal and FORM suggests what is on the plate with estimated calories and macros. Estimates are clearly labelled, you review and correct them before anything is logged, and the photo itself is not stored by FORM. You can also scan barcodes, search foods, save your own, plan meals and build a grocery list. Allergies are respected.

RANKS, STREAKS AND LEADERBOARDS
Earn XP for training, nutrition and steps, climb from Rookie to Champion, keep your streak alive, finish daily quests and unlock achievements. Each muscle group has its own rank. The leaderboard is private by default: others only see "Athlete #code" unless you choose to show your display name.

STEPS FROM HEALTH CONNECT
Connect Android Health Connect to see your daily steps and earn a little XP for them. FORM only reads your step count, only if you allow it, and never writes anything back.

PROGRESS PHOTOS THAT STAY ON YOUR PHONE
Track your body weight, take progress photos with a ghost pose to line them up, and compare them with a slider. The photos live only on your phone. They are never uploaded, never in your gallery and never in a backup.

YOUR DATA, YOUR CALL
- No ads and no tracking or analytics services.
- Download everything you have stored, or delete your account and data yourself in Profile > Settings > Privacy center.
- Turn off meal photo scanning, the AI coach or your leaderboard name any time.

HOW IT WORKS WITH YOUR PHONE
- Camera: rep counting and meal or barcode scanning.
- Notifications: optional reminders, scheduled on your phone.
- Health Connect: optional daily steps (read only).

FORM gives general fitness and nutrition information and estimates. It is not medical advice. Check with a doctor before you start a new training or diet programme.

Questions or feedback? Use the support contact on this page.
```

## Category and tags

- Category: Health & Fitness (application, not game).
- Tags (pick from Play's list): Fitness, Workout, Weight training, Nutrition, Calorie counter, Step counter, Health tracker.
- Keywords used naturally in the copy above: workout tracker, rep counter, form check, AI meal scan, calorie counter, macros, food scanner, barcode scanner, step counter, workout plan, gym log, streaks, leaderboard, progress photos.

## Other fields

| Field | Value |
|---|---|
| Default language | English (United States) |
| App icon | 512x512 PNG, 32-bit, no transparency needed; export from `apps/mobile/assets/images/icon.png` (check it is at least 512x512 and not rounded) |
| Feature graphic | 1024x500, see `screenshots.md` |
| Contact email | The same address as `SUPPORT_EMAIL` (shown publicly on the store page) |
| Website | Optional; the privacy page works: `https://<your-api-host>/privacy` |
| Privacy policy URL | `https://<your-api-host>/privacy` (current host: see `render.yaml` / your Render service URL) |
| Account deletion URL | `https://<your-api-host>/delete-account` |
| Ads | No, the app contains no ads |
| App access | Needs an account: give Google reviewers a test account (email + password) in "App access" |
| Target audience | 13 and over (not 18 and over only, not children) |
