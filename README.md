# MUSTO U.S. Open Fantasy Leaderboard

A live fantasy leaderboard for the 2026 U.S. Open at Shinnecock Hills. It combines the supplied 43-contestant picks with live round scoring and ranks each contestant by the lowest score among their five golfers each day. A built-in B-Team view scores the best round among the five golfers each contestant did not start. The Alt view selects the four lowest rounds posted across each contestant's three alternates, regardless of day.

## Run locally

Requires Node.js 20 or newer.

```bash
npm run dev
```

Open `http://localhost:3000`. The local server proxies the live leaderboard through `/api/scores` in the same way Vercel will.

## Scoring

- Each contestant has five active golfers in each round.
- The lowest 18-hole score is the contestant's counting score for that round.
- During play, pace is `course par + the golfer's current score to par`. A golfer at `-2 through 9`, for example, is pacing to 68 on a par-70 course.
- The leaderboard total is completed daily counting scores plus the selected round's live pace.
- Ties share the same rank.

## Deploy to Vercel

See `DEPLOYMENT.md` for the complete GitHub, Supabase, Vercel, verification, and custom-domain walkthrough.

Import this directory as a new Vercel project. The included `vercel.json` selects the **Other** framework preset and explicitly registers `api/scores.js` as a serverless function. Vercel automatically serves the existing `public/` directory.

The live event ID defaults to the 2026 U.S. Open. Set `ESPN_EVENT_ID` in Vercel only if the upstream event ID changes.

## Connect Supabase

1. Create a Supabase project.
2. Run `supabase/migrations/001_initial.sql` in the Supabase SQL editor.
3. Add `SUPABASE_URL` and `SUPABASE_SECRET_KEY` to Vercel's server-side environment variables. The legacy `SUPABASE_SERVICE_ROLE_KEY` name is also supported.
4. Redeploy.

With those variables present, successful score requests are also saved as timestamped snapshots. Never expose the service-role key in browser code.

## Data source note

Live scoring is read from ESPN's public golf scoreboard endpoint. This is an unofficial tracker, so the app identifies the feed in its footer and handles temporary feed failures without discarding the last successful update.
