# Play Store release checklist (in order)

Tick items as you go. Steps 1 to 4 are the technical build (details in `docs/RELEASE.md`, "Play Store release");
the rest is Play Console set-up. Play's rules and numbers change: verify the figures marked "verify" in the
Play Console help before relying on them.

## 0. Before anything

- [ ] A Google Play developer account (one-time registration fee; identity verification can take days).
  Personal accounts created recently must run a closed test before production (see step 7).
- [ ] The API is on Render **Starter with a persistent disk** (not the free plan) and Cloudflare R2 backups are
  on: `GET /status` shows `"backup": "on"` (`docs/RELEASE.md`, Backups). The free plan overlaps instances on
  deploy and sleeps; do not launch on it.
- [ ] `APP_STAGE=live` and `BILLING_PROVIDER=none` on Render (Pro is "coming soon"; nobody gets it free).
- [ ] `SUPPORT_EMAIL` set in the Render dashboard (the public pages show it; Play also needs a public contact email).
- [ ] The public pages answer without signing in: `https://<api-host>/privacy`, `/delete-account`, `/terms`.
  Re-read them once against what the app does today.

## 1. Upload key

- [ ] `bash apps/mobile/scripts/make-upload-key.sh` (Git Bash); the key lands in `~/form-keys/`, outside the repo.
- [ ] Back up `upload-key.p12` and its password in two separate places. Note the printed SHA-256 fingerprint.

## 2. GitHub secrets

- [ ] Repository secrets: `ANDROID_UPLOAD_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_PASSWORD`,
  `ANDROID_KEY_ALIAS` (`upload`). Delete the `.base64.txt` file afterwards.
- [ ] Optional repository variable `EXPO_PUBLIC_API_URL` if the live API address is not the workflow's default.

## 3. Build the bundle

- [ ] Actions > **Android release** > Run workflow (or push a tag such as `v1.0.0`).
- [ ] The run's logged certificate SHA-256 equals the fingerprint from step 1.
- [ ] Download the `FORM-android-aab` artifact and unzip it. The `.aab` is the only thing you upload.

## 4. Check the bundle

- [ ] Merged manifest (for example with `bundletool dump manifest`, or Play Console's App bundle explorer) lists only
  the expected permissions: `CAMERA`, `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`, `INTERNET`, Health Connect
  `READ_STEPS`; no `RECORD_AUDIO`, no location, no `AD_ID`/advertising ID, no ads SDK.
- [ ] The Health Connect permission-rationale activity and the `VIEW_PERMISSION_USAGE` alias are present.
- [ ] Install on a real phone from an internal-testing track and run: sign up, onboarding, a camera set, a meal scan,
  steps connect, sign out, **delete account** (verify the account is gone and the progress photos are removed).

## 5. Create the app in Play Console

- [ ] Create app: name `FORM: Rep Counter & Meal Scan` (see `listing.md`), default language, App (not game), Free.
- [ ] Opt in to **Play App Signing** at the first upload (Google keeps the app signing key; yours is the upload key).
- [ ] Store listing: title, short and full description, icon, feature graphic, 8 phone screenshots
  (`listing.md`, `screenshots.md`). Category Health & Fitness; contact email; tags.
- [ ] Select countries and regions.

## 6. App content and policies (all must be complete before any release)

- [ ] **Privacy policy URL**: `https://<api-host>/privacy`.
- [ ] **Account deletion**: Data safety section asks for a web link: `https://<api-host>/delete-account`; also confirm
  the in-app path (Profile > Settings > Privacy center) and that data deletion is offered.
- [ ] **Data safety form**: answer from `data-safety.md` (resolve the IP-address / "Device or other IDs" decision
  noted there first).
- [ ] **Health apps / Health Connect declaration**: `health-connect-declaration.md`. Submit early; approval can take about a
  week and READ_STEPS does not work for store users until approved.
- [ ] **Content rating**: `content-rating.md`.
- [ ] **Target audience**: 13 and over. **News app**: no. **Ads**: no ads. **Government app**: no.
- [ ] **App access**: provide a working test account (email and password) for reviewers; explain that rep counting
  needs a person in front of the camera (reviewers can skip it: sets can also be logged by tapping).
- [ ] **Permissions declarations** if prompted (camera: rep counting, meal and barcode scanning, progress photos;
  notifications: user-enabled reminders).
- [ ] **Financial features**: none. **Health**: complete the Health apps form even though FORM gives only
  general fitness information, not medical advice.

## 7. Closed test, then production

- [ ] Testing > Closed testing: create a track, upload the `.aab`, add release notes, set up the tester list (a
  Google group or email list).
- [ ] **Requirement (verify the current numbers in Play Console):** accounts created after November 2023 that are
  personal accounts must have a closed test with **at least 12 testers opted in for 14 continuous days** before
  they can apply for production access. Organisation accounts may be exempt. Check the "Production" page of your
  app for the exact requirement shown to you.
- [ ] Recruit more than 12 testers (some drop out); ask them to stay opted in for the full period and to use the app
  (log workouts, scan a meal, delete a test account) so the feedback is meaningful.
- [ ] Fix what testers report; upload a new `.aab` (a higher versionCode is automatic: run number + 1000) and keep the
  14-day clock in mind (opt-ins must remain; a new build does not reset it).
- [ ] Apply for production access in Play Console; answer the questions on how you tested and what you changed.
- [ ] Review the pre-launch report (Play's automatic device test) and fix crashes or accessibility errors it lists.

## 8. Production

- [ ] Production > Create release, upload the tested `.aab`, write release notes, choose a **staged rollout**
  (for example 10%, then 50%, then 100%).
- [ ] Send for review (can take from hours to several days).
- [ ] After approval: watch `GET /status`, Render logs (`unhandled error`, `client error`) and Play Console's
  Android vitals for crashes and ANRs; keep deploys to quiet times.
- [ ] Keep the key backed up; plan the next release (tag a new `v*`).

## Later (not for this launch)

- FORM Pro: the app says "coming soon". Before selling it: Play Billing integration, products, server verification
  (`docs/RELEASE.md`, R-01), update the Data safety form (financial info / purchase history), content rating
  (in-app purchases), the privacy policy and the terms.
