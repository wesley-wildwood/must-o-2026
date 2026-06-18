# Deploy MUST-O 2026

This project uses Vercel for the public website and live-score function. Supabase stores timestamped copies of the score feed for later history and analysis.

## 1. Put the project on GitHub

1. Extract the project archive.
2. Create an empty GitHub repository, for example `must-o-2026`.
3. Add the extracted project files to the repository root. `public`, `api`, `supabase`, `package.json`, and `vercel.json` should all be at the top level.
4. Commit and push the files to the `main` branch.

Do not commit `.env` files or any Supabase secret key.

## 2. Create Supabase

1. Create a project at `supabase.com` and wait for it to finish provisioning.
2. Open **SQL Editor**, choose **New query**, and paste the complete contents of `supabase/migrations/001_initial.sql`.
3. Click **Run**. The query creates `score_snapshots` and `latest_score_snapshot`.
4. Open the project's **Connect** dialog and copy the Project URL.
5. Open **Settings > API Keys**. Create or copy a server-side Secret key (`sb_secret_...`).

The secret key bypasses Row Level Security. Keep it only in Vercel's server-side environment variables and never put it in `public/` or browser code.

## 3. Deploy on Vercel

1. Sign in at `vercel.com` with the Git provider that owns the repository.
2. Select **Add New > Project**, find the repository, and click **Import**.
3. Leave the root directory as the repository root. The included `vercel.json` selects the **Other** framework preset and explicitly registers `api/scores.js` as a function. Vercel automatically serves the existing `public` directory.
4. In **Environment Variables**, add:

   - `SUPABASE_URL`: the Supabase Project URL
   - `SUPABASE_SECRET_KEY`: the Supabase `sb_secret_...` key

   Apply both to **Production**, **Preview**, and **Development**.
5. Click **Deploy**.

Vercel will provide a public `*.vercel.app` address. Every push to `main` creates a new production deployment.

## 4. Verify the public site

1. Open the Vercel address in a private/incognito window.
2. Confirm the status pill changes from **Connecting** to the current tournament status.
3. Confirm all 43 contestants appear and round tabs and search work.
4. Open `https://YOUR-DOMAIN.vercel.app/api/scores`. It should return JSON containing `event`, `players`, and `updatedAt`.
5. In Supabase, open **Table Editor > score_snapshots**. A row should appear after the public page requests scores.

The site remains live without Supabase if the two variables are omitted; Supabase is used for score history. Live scores come through the Vercel function in `api/scores.js`.

## 5. Optional custom domain

In Vercel, open **Project > Settings > Domains**, add the domain, and follow the DNS records Vercel displays. The original `vercel.app` address will continue working.

## Troubleshooting

- **Page loads but says Scores delayed:** Open `/api/scores` directly and inspect the Vercel Function logs under **Project > Logs**.
- **`/api/scores` returns Vercel `NOT_FOUND`:** Confirm `api/scores.js` is visible at the top level of the GitHub repository, not inside `public` or another enclosing folder. Confirm Vercel's Root Directory is `./`, then redeploy the latest commit.
- **No Supabase rows:** Recheck the two variable names, make sure the SQL ran successfully, then redeploy. Environment-variable changes apply only to new deployments.
- **404 on the home page:** Confirm `public/index.html` and `vercel.json` are in the repository root and Vercel's Root Directory is `./`.
- **Changes are not visible:** Confirm the commit reached `main` and that the latest Vercel production deployment finished successfully.
