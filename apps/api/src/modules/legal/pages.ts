import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config";
import type { AppContext } from "../../shared/context";

/**
 * Public legal pages: GET /privacy, /delete-account, /terms. Plain, accessible HTML with inline CSS (no
 * scripts, no external assets, no cookies), light and dark. They describe only what FORM actually does
 * (docs/RELEASE.md, "Privacy inventory"); the processors named follow the server's own configuration,
 * so the text cannot claim a service that is switched off. Change a data practice and these pages (and
 * docs/store/data-safety.md) must change with it.
 */

/** Bump when the text changes in substance. */
const UPDATED = "20 October 2026";

const CSS = `
:root{color-scheme:light dark;--bg:#fbfbfa;--fg:#161a1d;--muted:#4a5560;--line:#d5dade;--accent:#0b6b63;--card:#f0f3f3}
@media (prefers-color-scheme:dark){:root{--bg:#121518;--fg:#eceff1;--muted:#aab4bc;--line:#2c3339;--accent:#5fd0c4;--card:#1a1f23}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header,main,footer{max-width:46rem;margin:0 auto;padding:1rem 1.25rem}
header{padding-top:1.5rem;border-bottom:1px solid var(--line)}
.brand{font-weight:800;letter-spacing:.12em;font-size:1.1rem}
nav a{margin-right:1rem}
a{color:var(--accent)}
a:focus-visible{outline:3px solid var(--accent);outline-offset:2px;border-radius:2px}
h1{font-size:1.9rem;line-height:1.25;margin:1.25rem 0 .25rem}
h2{font-size:1.25rem;margin:2rem 0 .5rem}
p,li{max-width:42rem}
.meta{color:var(--muted);margin-top:0}
.note{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:.75rem 1rem}
table{border-collapse:collapse;width:100%;margin:.75rem 0;font-size:.95rem}
caption{text-align:left;font-weight:600;padding-bottom:.4rem}
th,td{border:1px solid var(--line);padding:.5rem .6rem;text-align:left;vertical-align:top}
th{background:var(--card)}
footer{color:var(--muted);font-size:.9rem;border-top:1px solid var(--line);margin-top:2rem}
`;

/** The page's only style element is allowed by hash, so the CSP can stay free of 'unsafe-inline'. */
const CSP = `default-src 'none'; style-src 'sha256-${createHash("sha256").update(CSS).digest("base64")}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** The contact sentence: the configured address, or the store-listing contact when none is set. */
function contact(cfg: AppConfig): string {
  const email = cfg.supportEmail;
  return email
    ? `Email <a href="mailto:${esc(email)}">${esc(email)}</a>.`
    : "No support email is published on this page. Use the developer contact shown on FORM&rsquo;s store listing (Google Play, &ldquo;App support&rdquo;).";
}

function layout(title: string, body: string, cfg: AppConfig): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="index,follow">
<title>${esc(title)} &ndash; FORM</title>
<style>${CSS}</style>
</head>
<body>
<header>
<div class="brand">FORM</div>
<nav aria-label="Legal pages"><a href="/privacy">Privacy policy</a><a href="/delete-account">Delete your account</a><a href="/terms">Terms of use</a></nav>
</header>
<main id="main">
<h1>${esc(title)}</h1>
<p class="meta">Last updated ${UPDATED}.</p>
${body}
</main>
<footer>
<p>Questions about this page? ${contact(cfg)}</p>
</footer>
</body>
</html>
`;
}

/** Who receives meal photos, as configured on this server. */
function scanProcessor(cfg: AppConfig): { name: string | null; sentence: string } {
  switch (cfg.foodRecognition.provider) {
    case "gemini":
      return { name: "Google (Gemini API)", sentence: "Google&rsquo;s Gemini service, which analyses the photo and returns the foods it sees. FORM does not store the photo; Google handles what it receives under its own terms and retention." };
    case "anthropic":
      return { name: "Anthropic (Claude API)", sentence: "Anthropic&rsquo;s Claude service, which analyses the photo and returns the foods it sees. FORM does not store the photo; Anthropic handles what it receives under its own terms and retention." };
    default:
      return { name: null, sentence: "" };
  }
}

function privacyBody(cfg: AppConfig): string {
  const scan = scanProcessor(cfg);
  const aiCoach = cfg.coach.provider === "anthropic";
  const backup = cfg.backup === "litestream";
  return `
<p>FORM is a fitness and nutrition app: it counts your reps with the phone camera, scores your form, logs meals, plans workouts and tracks progress. This policy explains what FORM collects, why, who else handles it, how long it is kept and what you can do about it. It covers the FORM app and its server (the address this page is served from).</p>

<h2 id="summary">In short</h2>
<ul>
<li>No ads, no advertising ID, no analytics or tracking services, and we never sell your data.</li>
<li>Camera video from your workouts is processed on your phone and never recorded or sent. Only joint angles (numbers) of verified sets are sent to check your reps.</li>
<li>Body progress photos stay on your phone. They are never uploaded.</li>
<li>You can download everything or delete your account yourself inside the app.</li>
</ul>

<h2 id="collect">What FORM collects and why</h2>
<table>
<caption>Data FORM keeps on its server, tied to your account</caption>
<thead><tr><th scope="col">Data</th><th scope="col">Why</th><th scope="col">Required?</th></tr></thead>
<tbody>
<tr><th scope="row">Email address and password (the password is stored only as a salted scrypt hash)</th><td>To create your account and sign you in.</td><td>Yes</td></tr>
<tr><th scope="row">Profile and goals: display name, goal, sex, age, height, weight, experience, training days, location, equipment, focus areas, food preferences and allergies</th><td>To personalise workouts and nutrition targets. FORM is for people aged 13 and over.</td><td>Needed for the personalised plan</td></tr>
<tr><th scope="row">Body weight entries</th><td>To show your progress and adjust targets.</td><td>Optional</td></tr>
<tr><th scope="row">Workouts: exercises, sets, reps, loads, timings; for camera-verified sets, the joint-angle trace (numbers only, no images or video)</th><td>To log training, verify reps, score form, and award XP and ranks.</td><td>Yes, to log workouts</td></tr>
<tr><th scope="row">Meals: food log, your own foods, meal plans, grocery list, water, nutrition targets</th><td>To track nutrition and plan meals.</td><td>Optional</td></tr>
<tr><th scope="row">Meal-photo scan results (foods and estimated nutrition, not the photo)</th><td>To let you review and confirm a scan. Kept 24 hours unless you confirm it into your food log.</td><td>Optional, needs your consent</td></tr>
<tr><th scope="row">Daily step count from Android Health Connect (one number per day)</th><td>To show your steps and award a small amount of XP. FORM reads steps only, never writes to Health Connect and reads no other Health Connect data.</td><td>Optional</td></tr>
<tr><th scope="row">XP, ranks, streaks, quests, achievements and records</th><td>To run the progress and game features.</td><td>Yes</td></tr>
<tr><th scope="row">Leaderboard name</th><td>Off by default: others see you only as &ldquo;Athlete #code&rdquo;. If you opt in, your display name and rank are shown. Never your photo, email or other details.</td><td>Optional</td></tr>
<tr><th scope="row">Profile photo</th><td>Shown only to you, as your picture. Metadata is removed on upload.</td><td>Optional</td></tr>
<tr><th scope="row">Coach chat and cached coach tips</th><td>To answer you. Chat is kept 30 days and can be cleared; tips are kept 7 days.</td><td>Optional</td></tr>
<tr><th scope="row">Settings and notification choices</th><td>To remember your preferences.</td><td>Yes</td></tr>
</tbody>
</table>

<h3>Technical data</h3>
<ul>
<li><strong>Server logs.</strong> Each request is logged with its method, path, status, timing, a request ID and the IP address; some event lines carry an opaque account ID. Logs hold no passwords, tokens or request bodies. They are kept by our hosting provider under its log retention. Used for security, abuse prevention and fixing faults.</li>
<li><strong>Crash reports.</strong> If the app hits an unexpected error it can send the error text, app version and platform, scrubbed of emails, tokens and long numbers. No third-party crash service is used.</li>
<li><strong>Camera diagnostics.</strong> If the on-device camera engine has to switch modes, a short technical line (reason, app build, Android version, device model) is sent. It carries no account ID, address or image and is held only in server memory (the latest 20).</li>
<li><strong>Usage counters.</strong> Daily counts of calls to outside services, with no personal data, to cap costs.</li>
</ul>

<h3>Only on your phone</h3>
<ul>
<li>Camera video for rep counting: analysed on the device, not recorded, not sent.</li>
<li>Body progress photos (private app storage, never uploaded, never in the gallery, not in backups or the data export), and the optional monthly photo reminder.</li>
<li>Workout and meal reminders you switch on: scheduled on the phone, with no push server and no push token.</li>
<li>Your sign-in token, kept in the phone&rsquo;s secure storage.</li>
</ul>

<h2 id="share">Who else handles data</h2>
<p>We do not sell personal data and do not share it for advertising. Service providers act only to run FORM:</p>
<ul>
<li><strong>Render</strong> hosts the server and database (currently in the United States). Your data is therefore processed there.</li>
${backup ? "<li><strong>Cloudflare R2</strong> stores encrypted continuous backups of the database (private bucket). Backups are kept for 7 days.</li>" : ""}
${
  scan.name
    ? `<li><strong>${scan.name}</strong> receives a meal photo only when you scan a meal and have agreed to it in Settings. The photo (with metadata removed) goes to ${scan.sentence}</li>`
    : "<li>Meal-photo recognition is not switched on for this server, so no meal photos are sent anywhere.</li>"
}
${
  aiCoach
    ? "<li><strong>Anthropic</strong> receives coaching facts (summaries of your training and nutrition, with no name, email, photo or body measurements) and your chat text, only if you have turned on the AI coach and agreed to it. Anthropic handles it under its own terms.</li>"
    : "<li>The coach uses FORM&rsquo;s own built-in rules; no outside AI service receives your data.</li>"
}
<li><strong>Google Health Connect</strong> (on your Android phone) provides step counts when you allow it. FORM only reads them, uses them only to show your steps and award XP, and never uses them for advertising or shares them with anyone.</li>
</ul>
<p>We may disclose data if the law requires it.</p>

<h2 id="retention">How long we keep it</h2>
<ul>
<li>Account data: until you delete your account.</li>
<li>Scan results: 24 hours unless confirmed. Coach chat: 30 days. Coach tips: 7 days.</li>
<li>Backups: 7 days. A deleted account can remain in older backups for up to 7 days before they expire.</li>
<li>Server logs: per the hosting provider&rsquo;s log retention.</li>
<li>On-device data: until you delete it or uninstall the app.</li>
</ul>

<h2 id="rights">Your choices and rights</h2>
<ul>
<li><strong>See and download</strong> your data: Profile &rarr; Settings &rarr; Privacy center (a JSON file; needs your password).</li>
<li><strong>Correct</strong> it: edit your profile and logs in the app.</li>
<li><strong>Delete</strong> your account and data: see <a href="/delete-account">how to delete your account</a>.</li>
<li><strong>Withdraw consent</strong>: turn off meal-photo scanning, the AI coach or leaderboard name in Settings; revoke camera or Health Connect access in your phone&rsquo;s settings. The app keeps working without them.</li>
<li>Depending on where you live you may have further rights (access, rectification, erasure, portability, objection, or a complaint to your data-protection authority). Contact us and we will help.</li>
</ul>

<h2 id="children">Children</h2>
<p>FORM is not directed to children under 13. The app asks for your age and does not accept an age under 13. If we learn that a child under 13 has an account, we will delete it.</p>

<h2 id="security">Security</h2>
<p>Data travels over encrypted connections (TLS). Passwords are stored only as salted hashes. Sign-in tokens are kept in the phone&rsquo;s secure storage, and sign-in attempts are rate limited. No system is perfectly secure, so keep your password private.</p>

<h2 id="changes">Changes</h2>
<p>If the practices above change in a material way, we will update this page and its date, and ask for your agreement in the app where the law requires it.</p>

<h2 id="contact">Contact</h2>
<p>${contact(cfg)}</p>
`;
}

function deleteBody(cfg: AppConfig): string {
  const email = cfg.supportEmail;
  return `
<p>You can delete your FORM account and all the data tied to it yourself, from inside the app. No email is needed.</p>

<h2 id="in-app">Delete it in the app</h2>
<ol>
<li>Open FORM and sign in.</li>
<li>Go to <strong>Profile</strong> &rarr; <strong>Settings</strong> &rarr; <strong>Privacy center</strong>.</li>
<li>If you want a copy first, use <strong>Export my data</strong>.</li>
<li>Choose <strong>Delete my account</strong>, enter your password, type <code>DELETE</code> to confirm and choose <strong>Delete forever</strong>.</li>
</ol>
<p>If you pay for FORM Pro through a store, cancel it there first: deleting the account does not cancel store billing. (Pro purchases are not yet available in the app.)</p>

<h2 id="what">What is deleted</h2>
<ul>
<li>Immediately and completely from the live database, in one step: your account (email and password hash), profile, goals, preferences and allergies, profile photo, weight entries, workouts, sets and camera joint-angle traces, meals, food logs, plans and groceries, meal-photo scan results, step counts, XP, ranks, streaks, quests, achievements, records, coach chat and tips, settings and notification choices. If anything could not be removed, nothing is deleted and the app tells you.</li>
<li>Backups: copies expire within 7 days, so your data can remain in an older backup for up to 7 days and is then gone.</li>
<li>On your phone: body progress photos are stored only on the phone and are removed when you delete the account on that phone. If you used FORM on other phones, delete the photos there (Body progress &rarr; Delete all progress photos) or uninstall the app.</li>
</ul>

<h2 id="kept">What is not removed</h2>
<ul>
<li>Server logs (request method, path, status, IP address) stay with our hosting provider until its log retention ends.</li>
<li>Anonymous daily counters of outside-service calls, which contain no personal data.</li>
<li>Meal photos you scanned were never stored by FORM. The outside recognition service handles what it received under its own retention terms.</li>
</ul>

<h2 id="by-email">Can&rsquo;t use the app?</h2>
${
  email
    ? `<p>Email <a href="mailto:${esc(email)}">${esc(email)}</a> from the address registered to the account, with the subject &ldquo;Delete my FORM account&rdquo;. We may ask you to verify that the account is yours. We will delete it within 30 days, and backups clear within a further 7 days.</p>`
    : "<p>No support email is published on this page. Use the developer contact shown on FORM&rsquo;s store listing (Google Play, &ldquo;App support&rdquo;) and ask us to delete your account from the address registered to it. We may ask you to verify that the account is yours.</p>"
}

<h2 id="partial">Delete only some data</h2>
<p>You can also delete body progress photos (Body progress &rarr; Delete all progress photos, or one photo at a time), clear your coach chat, and revoke Health Connect access, without deleting the account.</p>
`;
}

function termsBody(cfg: AppConfig): string {
  return `
<p>By creating a FORM account or using the app you agree to these terms. If you do not agree, do not use FORM.</p>

<h2 id="health">Not medical advice</h2>
<p>FORM gives general fitness and nutrition information, plans and estimates. It is not medical advice and does not diagnose, treat or prevent any condition. Talk to a doctor before starting an exercise or diet programme, especially if you have a health condition, are pregnant or are under 18. Stop if you feel pain or dizziness. Rep counts, form scores, calorie and nutrient figures (including those from meal photos) are estimates and can be wrong. You train and eat at your own risk.</p>

<h2 id="account">Your account</h2>
<ul>
<li>You must be at least 13 years old.</li>
<li>Give an accurate email, keep your password private and tell us if you think your account was accessed by someone else. You are responsible for activity under your account.</li>
<li>You can delete your account at any time (see <a href="/delete-account">Delete your account</a>).</li>
</ul>

<h2 id="use">Fair use</h2>
<ul>
<li>Do not cheat the XP, rank or leaderboard systems, for example by faking camera data or automating requests.</li>
<li>Do not attack, overload or probe the service, or try to access other people&rsquo;s data.</li>
<li>Choose a display name that is not offensive or impersonating someone. We may refuse or change names and may suspend accounts that break these rules.</li>
</ul>

<h2 id="content">Your data</h2>
<p>Your data stays yours. You give FORM permission to process it only to run the app, as described in the <a href="/privacy">privacy policy</a>.</p>

<h2 id="pro">FORM Pro</h2>
<p>FORM Pro is not yet available to buy. If it launches, its price, renewal and cancellation terms will be shown before you subscribe, and billing will go through the store you use.</p>

<h2 id="service">The service</h2>
<p>FORM is provided &ldquo;as is&rdquo;, without warranties of any kind, and may change, be unavailable or lose data despite our backups. To the extent the law allows, we are not liable for indirect or consequential loss or for injury arising from your use of exercise or nutrition information. Nothing here limits rights you have by law that cannot be limited.</p>

<h2 id="changes">Changes</h2>
<p>We may update these terms. The date at the top shows the latest version; continuing to use FORM after a change means you accept it.</p>

<h2 id="contact">Contact</h2>
<p>${contact(cfg)}</p>
`;
}

/** Public, cache-friendly, cookie-free pages; the global headers are kept except CSP and cache policy. */
export function legalRoutes(app: FastifyInstance, ctx: AppContext): void {
  const pages: Record<string, string> = {
    "/privacy": layout("Privacy policy", privacyBody(ctx.config), ctx.config),
    "/delete-account": layout("Delete your FORM account", deleteBody(ctx.config), ctx.config),
    "/terms": layout("Terms of use", termsBody(ctx.config), ctx.config),
  };
  for (const [url, html] of Object.entries(pages)) {
    app.get(url, async (_req, reply) =>
      reply
        .header("content-type", "text/html; charset=utf-8")
        .header("content-security-policy", CSP)
        .header("cache-control", "public, max-age=3600")
        .send(html),
    );
  }
}
