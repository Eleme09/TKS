# PLACER SERVICES — Chaturbate token/payroll tracker

Internal tool for a Chaturbate webcam studio: tracks each model's token
earnings live, computes biweekly payroll (quincenas), runs an overtime
shift sign-up calendar, and gates everything behind 3 roles.

## Before touching anything

Run `git log --oneline -30` and skim recent commit messages, then read
the actual current `server.js` / `public/index.html`. **This project has
been developed from multiple, disconnected Claude Code sessions on
different devices, sometimes in parallel.** Don't trust any prior
session's description of "current state" (including sections below) —
trust the repo. If something below conflicts with what the code
actually does, the code wins; fix this file to match.

## Where things live

- **Code**: this repo (`Eleme09/TKS`, private GitHub repo). Deploy flow:
  commit → push `master` (via GitHub Desktop, the user's tool of choice)
  → Render auto-deploys `tks-4zsh.onrender.com`.
- **Database**: Supabase project ref `yklqqalnmficsbyabbrn`. All tables
  belonging to this app are prefixed `cb_` — that Supabase project has
  other, unrelated tables too (the user's other work); never touch
  non-`cb_` tables. Row Level Security is deliberately open to the
  `anon` role on `cb_*` tables (accepted tradeoff since the anon key
  never leaves server-side env vars).
- **Secrets**: at minimum `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `SESSION_SECRET`; check server.js top-of-file for any others that may
  have been added since (e.g. `VAPID_*` for push notifications). Never
  hardcode secret values in source — the server intentionally refuses to
  start without them as env vars. Locally they live in `env.bat` (in
  .gitignore, not in the repo — if missing, regenerate values from the
  Render dashboard's Environment tab, which is the source of truth, or
  ask the user). `iniciar.bat` sources `env.bat` then runs `node
  server.js`.
- **Uptime**: a free UptimeRobot monitor pings the live site every 5 min
  so Render's free tier doesn't sleep. Drop it if/when the studio
  upgrades to a paid Render plan.
- **Staging**: a second Render free web service, `tks-staging`
  (`tks-staging.onrender.com`), same repo, branch `dev`, same three
  secrets (but its own `SESSION_SECRET`, different from production's).
  It is normally **suspended** — resume it manually in Render only when
  you need to test something live, then re-suspend when done. Reason:
  it shares the same Supabase tables as production, so if it's left
  running it double-polls Chaturbate for the same models production
  already tracks (tip dedup on `event_id` prevents double-counted money,
  but it's still wasteful and not a real isolated environment — don't
  treat it as one for anything that writes meaningfully different data
  than production). Workflow: commit → push to `dev` → resume
  `tks-staging` → verify → push/merge to `master` for the real deploy.
- **Browser access**: Claude in Chrome (the user's real, logged-in
  Chrome) has working sessions for GitHub, Render, and Supabase — confirmed
  working for running SQL directly in the Supabase SQL Editor and for
  managing Render services end to end. Also, `git push` from this
  machine's shell works directly (credentials are already configured) —
  no need to route pushes through GitHub Desktop.

## Reliability notes (read before touching pollLoop / tracker logic)

- Each model's Chaturbate Events API long-poll cursor (`nextUrl`) is
  persisted to `cb_models.last_cursor` after every successful poll cycle,
  and reconnect (`reconnectAllModels`, `/api/start`, `/api/reconnect`)
  resumes from it instead of starting fresh. This closes a real
  money-loss window: without it, any tip arriving during a server
  restart (redeploy, crash, Render free-tier sleep) was silently lost
  forever. If the saved cursor is stale/rejected, the code falls back to
  a fresh connection automatically — don't treat that fallback path as a
  bug.
- Online/offline status is **in-memory only** (`tracker.online`), reset
  to `false` on every restart, by deliberate design (see the comment
  above `buildModelReports`): trusting the DB's last broadcast event
  instead would make a model who was live during a missed `broadcastStop`
  appear "online" forever. The tradeoff is that every model shows
  offline for a few minutes after any restart until a fresh event
  arrives — this is expected, not a bug to "fix" by reverting to
  DB-based status.

## Business rules (stable — confirm before changing)

- Quincena: day 1–15 of a month is paid the 20th of that month; day
  16–end of month is paid the 5th of the next month.
- Payout formula: `tokens × 0.023 USD/token`, converted to COP at a live
  daily rate (cached ~5 min). That USD-per-token rate is business
  financial data — never change it without the user explicitly asking.
  Historical (past-quincena) COP figures are approximate (today's rate,
  not the historical one) since exchange rates aren't archived per day;
  label them as such rather than presenting them as exact.
- Roles: `administrador` (full control), `ceo` (badge "CEO PLACER
  STUDIO", read-only on model earnings/status but can manage the shift
  calendar), `modelo` (sees/manages only her own data, logs in with her
  Chaturbate username + a password the admin assigns her, not an
  email).

## How this user likes to work

Non-technical, moves fast, dislikes long back-and-forth or being asked
to test things himself. Test every change yourself end-to-end (spin up
a scratch instance on a different port, hit it with curl and/or the
browser tool, against the real Supabase project) before saying
something works or asking him to check. Keep any engineering
justification ("we did X because Chaturbate's API doesn't support Y")
out of the product's own UI copy — that reasoning belongs in chat only.
