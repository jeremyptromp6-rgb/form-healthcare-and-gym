# Play Console: Data safety form answers

Source of truth: `docs/RELEASE.md` "Privacy inventory" and the public policy (`apps/api/src/modules/legal/pages.ts`,
served at `/privacy`). If either changes, update this file and answer the Play form again.
Form wording changes now and then: verify each label in Play Console > App content > Data safety before submitting.

How the Play terms are applied here:
- **Collected** = sent off the device to FORM's server (or to us at all). Data that stays on the phone is not collected
  (progress photos, camera video, reminder choices).
- **Shared** = transferred to a third party for that party's own purposes. Passing data to a service provider that
  processes it on our behalf (Render hosting, Google Gemini recognising the meal photo, Cloudflare R2 backups) is
  **not** sharing under Play's definition. FORM sends nothing to third parties for their own use, and nothing to ad
  networks.
- FORM has **no ads SDK, no analytics SDK, no advertising ID**. Check the final AAB's merged manifest before you
  submit (see `release-checklist.md`).

## Section 1: overview questions

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | Yes |
| Is all of the user data collected by your app encrypted in transit? | Yes (TLS to the API; the app refuses plain HTTP to remote hosts) |
| Do you provide a way for users to request that their data be deleted? | Yes |
| Account deletion in the app | Profile > Settings > Privacy center > Delete my account |
| Delete account URL (Play asks for a web link) | `https://<api-host>/delete-account` |
| Offer deletion of some data without deleting the account? | Yes (progress photos, coach chat; Health Connect access can be revoked) |
| Committed to follow the Play Families Policy? | No. The app is not designed for children; it is for 13 and over |
| Independent security review (optional badge) | No |

## Section 2: data types

Purposes use Play's labels: App functionality, Analytics, Developer communications, Advertising or marketing,
Fraud prevention / security / compliance, Personalization, Account management.

### Personal info

| Data type | Collected | Shared | Required or optional | Purposes | What it is |
|---|---|---|---|---|---|
| Name | Yes | No | Optional | App functionality, Personalization | Display name. Shown to other users only if the user opts in to the leaderboard (default off: "Athlete #code") |
| Email address | Yes | No | Required | Account management, App functionality | Sign-in and account identity |
| User IDs | Yes | No | Required | Account management, App functionality | Internal account ID (random UUID) |
| Other info | Yes | No | Required for the personalised plan | App functionality, Personalization | Age and sex, entered in the profile (an age under 13 is rejected) |
| Address, phone number, race, political or religious beliefs, sexual orientation | No | - | - | - | - |

### Health and fitness

| Data type | Collected | Shared | Required or optional | Purposes | What it is |
|---|---|---|---|---|---|
| Health info | Yes | No | Optional | App functionality, Personalization | Body weight and height, weight entries, food allergies and preferences, the user's nutrition targets |
| Fitness info | Yes | No | Required to log workouts; steps optional | App functionality, Personalization | Workouts, sets, reps, loads, camera-verified set joint-angle traces (numbers only), daily step totals from Health Connect |

### Photos and videos

| Data type | Collected | Shared | Required or optional | Purposes | What it is |
|---|---|---|---|---|---|
| Photos | Yes | No | Optional | App functionality | (1) Profile photo, stored on the server, metadata removed. (2) Meal photo for a scan: sent to Google Gemini for recognition, held only in memory, not stored by FORM; only the recognised foods and estimates are kept (24 hours unless confirmed). Needs the user's consent in Settings. Body progress photos are on-device only and are **not** collected |
| Videos | No | - | - | - | The camera feed for rep counting is analysed on the phone and never recorded or sent |

### Messages

| Data type | Collected | Shared | Required or optional | Purposes | What it is |
|---|---|---|---|---|---|
| Other in-app messages | Yes | No | Optional | App functionality | Coach chat text, kept 30 days, clearable. Today the coach runs on built-in rules; if the AI coach is enabled on the server and the user opts in, chat text is processed by Anthropic as a service provider |

### App activity

| Data type | Collected | Shared | Required or optional | Purposes | What it is |
|---|---|---|---|---|---|
| App interactions | Yes | No | Required | App functionality | XP, ranks, streaks, quests, achievements, activity events |
| Other user-generated content | Yes | No | Optional | App functionality | Food logs, custom foods, meal plans, grocery list, water entries |
| Web browsing, in-app search history, installed apps, other actions | No | - | - | - | Food search terms are not logged or stored |

### App info and performance

| Data type | Collected | Shared | Required or optional | Purposes | What it is |
|---|---|---|---|---|---|
| Crash logs | Yes | No | Required (automatic, if the app crashes) | Analytics, App functionality | First-party report of an unexpected error: error text scrubbed of emails, tokens and numbers, app version, platform. No third-party SDK |
| Diagnostics | Yes | No | Required (automatic) | App functionality, Fraud prevention / security | Server request logs (method, path, status, timing) and a camera-engine fallback line (reason, build, Android version, device model; no user ID) |
| Other app performance data | No | - | - | - | - |

### Device or other IDs

| Data type | Collected | Shared | Notes |
|---|---|---|---|
| Device or other IDs | **Verify before answering** | No | FORM never reads the advertising ID or any hardware ID. Server logs include the client **IP address** and Play's form has no separate IP category. Google's guidance is to disclose IP-address logging; the conservative choice is to declare "Device or other IDs: collected, not shared, required, purposes: Fraud prevention / security / compliance". Check Play's current help text and, if you declare it, keep the privacy policy's "Server logs" wording |

### Not collected

Location (approximate and precise), Financial info (no purchases exist yet; revisit when FORM Pro is sold),
Contacts, Calendar, Audio (the microphone permission is disabled), Files and docs.

## Section 3: security practices

| Item | Answer |
|---|---|
| Data encrypted in transit | Yes (TLS) |
| Data at rest | Not asked as a separate checkbox. Passwords are stored only as salted scrypt hashes; backups sit in a private Cloudflare R2 bucket that encrypts objects at rest |
| Deletion | Account deletion removes the live data at once; backups expire within 7 days (7-day retention in `apps/api/litestream.yml`) |

## Retention (matches the policy)

| Data | Kept |
|---|---|
| Account data | Until the account is deleted |
| Scan results | 24 hours unless the user confirms them into the food log |
| Coach chat | 30 days (the user can clear it sooner); coach tips 7 days |
| Backups | 7 days |
| Server logs | The hosting provider's log retention |
| On-device data | Until the user deletes it or uninstalls |

## Permissions to list or justify

| Permission | Why |
|---|---|
| `CAMERA` | Rep counting, meal photo scanning, barcode scanning, progress photos. The user is asked when first needed |
| `POST_NOTIFICATIONS` (Android 13+) | Only when the user turns a reminder on in Settings; local notifications, no push server |
| `RECEIVE_BOOT_COMPLETED` | Added by the notifications library so scheduled reminders survive a restart |
| `android.permission.health.READ_STEPS` | Daily steps, see `health-connect-declaration.md` |
| Microphone | Not requested (disabled in `app.json`) |
