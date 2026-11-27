# Kinas's cloud: the summaries store and the phone page

## What it is

The two hosted pieces that let the phone see the factory and answer the first mate while the Mac is closed (ADR 0023):
a Convex deployment that holds only summaries, and a static web page the captain adds to the phone's home screen,
which notifies through Web Push.

## Where

- **Convex** — a project in Miraside's team, region `aws-eu-west-1` (Ireland); the code in `cloud/convex/`. A **dev**
  deployment first; production only on the captain's word. Environment variable **names** in the deployment:
  `COMPANION_SECRET_SHA256`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
- **The phone page** — static files built from `cloud/phone/`, hosted on Vercel in Miraside's team; the build reads
  `VITE_CONVEX_URL` and `VITE_VAPID_PUBLIC_KEY`.
- **On the VPS** — `~/.config/kinas/companion.env` (0600): `CONVEX_URL`, `KINAS_COMPANION_SECRET`, and optionally
  `KINAS_COMPANION_LABEL` (a-z, 0-9, `-`, up to 32: the machine's name on the phone; `Linux machine` when absent) and
  `KINAS_PHONE_URL` (the phone page's https address, for the pairing link; absent, the Mac shows the code alone) (`vps.md`).
  The companion reads it only when it is the user's own and mode 0600, and the address must be a `*.convex.cloud` or
  `*.convex.site` https one. *Added 2026-11-27 (slice 7.2).*
- **Generated code** — `cloud/convex/_generated/` is written by `bun cloud/scripts/codegen-offline.ts` (Convex's own
  templates) until the dev deployment exists; the first `npx convex dev` rewrites it, and what it writes is committed.
- **Deploying** — `npx convex deploy` from the Mac with `CONVEX_DEPLOY_KEY` in that command's environment only, never
  saved by Kinas; this is a different key from the usage reader's (`convex-deploy-key.md`).
- **Web Push** — Apple's push service (`*.push.apple.com`) for a home-screen web app on iOS 16.4 or later; standard
  push services for other browsers.

## Who reads it

- `cli/src/companion/cloud.ts` — writes the reading summary, the heartbeat, the factory's events and pairings; takes
  pending answers and settles them.
- `cloud/convex/` — its own functions and crons: expire answers older than 60 s, watch the heartbeat, send pushes.
- The phone page — reads the summary, the inbox and the weeks; submits answers; pairs; subscribes to pushes.
- The Mac app — nothing: it reads the VPS through the companion, not the cloud.

## What it can do

Hold and serve the summaries of ADR 0023's list, and send a notification to a paired phone. The companion's secret can
write every companion table; a device token can only answer, finish its own pairing and store its own subscription.

## Never

- Any field outside ADR 0023's list — code, diffs, briefs, reports, transcripts, paths, branch names, logs, keys.
- A secret's or token's value stored in the deployment, the repository, a fixture, the Mac's store or a log: only
  SHA-256 hashes are stored; the VAPID private key lives only in the deployment's environment.
- A production deployment, a new region, or a public page without pairing, without the captain's word.
- Deleting factory events.

## Slice 7–10 as built (2026-11-27)

- **Convex functions** (`cloud/convex/`): `companion.ts` (`replaceReading`, `heartbeat`, `takeAnswers`, `settleAnswer`,
  `startPairing`, `phones`, `unpair`, `testNotification`, each starting with the secret), `phone.ts` (`pair`, `reading`,
  `inbox`, `submitAnswer`, `subscribe`, each but `pair` starting with the token), `push.ts` (`"use node"`: `notifyItem`,
  `notifyAlert`, `sendTest`), `crons.ts` (expire answers at 60 s, the heartbeat watch every minute, drop what closed 30 days
  ago). The pure rules are in `lib/` and tested without a deployment; source guards read the files as text.
- **Companion** (`cli/src/companion/`): `cloud.ts` (`summaryOf`, the Convex HTTP door, the file fake), `pair.ts`, `phone.ts`
  (the five-second answer loop and the receipts), `fleet.ts`.
- **Phone page** (`cloud/phone/`): a Vite static app; `VITE_CONVEX_URL` and `VITE_VAPID_PUBLIC_KEY` at build time; its
  Content-Security-Policy is written from the Convex address; `vercel.json` adds the frame and referrer headers.
- **Environment names in the deployment:** `COMPANION_SECRET_SHA256`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
  `VAPID_SUBJECT`, and optionally `KINAS_TIME_ZONE` (default `Europe/Lisbon`, for the unreachable notification's time).
