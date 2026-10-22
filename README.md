# App Competition Analysis

App Competition Analysis helps founders explore the market around an app idea. It is built with Next.js App Router, React, TypeScript, and npm. Supabase Auth supports Google OAuth sign-in. Each signed-in account gets a profile row linked to its private research history.

## Run locally

```sh
npm install
npm run dev
```

Copy `.env.example` to `.env.local`, then set the Supabase project URL and **publishable** key in the `NEXT_PUBLIC_` variables. The server also reads `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) for trusted database operations. Never put the secret key in a `NEXT_PUBLIC_` variable or commit either environment file. Open http://localhost:3000; signed-out visitors are sent to `/login`.

## Authentication setup

- In Supabase **Authentication → URL Configuration**, set the local Site URL to `http://localhost:3000` and add `http://localhost:3000/auth/callback` to the allowed redirect URLs. Add your deployed site and its `/auth/callback` URL there too.
- In Supabase **Authentication → Sign In / Providers → Google**, enable Google and enter the OAuth client ID and secret from Google Cloud. Google Cloud's authorized redirect URI is the Supabase callback URL shown on that provider settings page (`https://<project-ref>.supabase.co/auth/v1/callback`).
- The website currently offers Google sign-in only; it does not expose email/password sign-up.
- Visitors can use Home and Explore Market without signing in. Guest analyses stay in page memory and are not written to Supabase; they disappear on reload or when the visitor leaves the page. Sign in before analyzing to save a result to Your Work.
- Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to local `.env.local` and the Vercel project. A legacy Supabase anon key can be used as the publishable key value. Keep `SUPABASE_SECRET_KEY` server-only.

## API routes

- `GET /api/users` returns the signed-in user's profile, creating it the first time if needed, or `{ "user": null }` for a guest.
- `GET /api/history` returns only the signed-in user's saved ideas and analyses, or an empty list for a guest.
- `DELETE /api/ideas` accepts `{ "ideaId": "..." }` and deletes only the signed-in user's idea; related records are removed by database cascades.
- `GET /api/snapshot?analysisId=...` returns a snapshot only when it belongs to the signed-in user.
- `POST /api/analyses` saves a new idea, its analysis counts, and its competitor records under the signed-in user. Re-analyzing an existing idea replaces its prior analysis snapshot. It uses the server-side Supabase secret and removes partial writes if a later insert fails.
- `POST /api/similar-apps` accepts `{ "appDescription": "..." }` and returns `{ "suggestedAppName": "...", "apps": [...] }`. The apps array contains ten `{ name, appSummary, appleAppStoreUrl, googlePlayUrl }` competitors. `appSummary` is a short phrase of at most five words. Store URLs are `null` when a listing cannot be verified.
- `POST /api/app-metadata` accepts `{ "apps": [{ "name": "...", "appSummary": "...", "appleAppStoreUrl": "...", "googlePlayUrl": "..." }] }` and returns a combined rating (the higher store rating) and review count for each app. The review count averages Apple user ratings and Google Play ratings when both are available; otherwise it uses the available store count.

Home, Explore Market, and live competitor/review research APIs are available to guests. Database-backed history, snapshot, delete, and save operations require a Supabase Auth session; research APIs derive ownership from that session rather than trusting a user ID supplied by the browser. Anonymous analyses are kept only in the current page's React state and are never written to Supabase. `mockApis/market-data.ts` still reads `mockData/market-fixtures.json` for its fixture-backed sample preview.

The similar-app route uses the OpenAI Responses API with web search and structured output. Configure `OPENAI_API_KEY` on the server; `OPENAI_MODEL` is optional and defaults to `gpt-5.5`. This endpoint only returns similar app listings; it does not persist analyses or collect reviews.

`/api/app-metadata` is a Next.js TypeScript route. It uses Apple's iTunes lookup endpoint and the `@mradex77/google-play-scraper` npm package. It intentionally omits long store descriptions; the short `appSummary` comes from the similar-app discovery request. Run `npm run dev` locally to exercise it with the rest of the Next.js app. The scraper requires Node.js 22.12 or newer.

## Supabase seed data

`mockData/market-fixtures.json` contains illustrative fixtures, including app-specific themes for every mock competitor. The JavaScript seed scripts under `supabase/seed/` use this same JSON file to seed users, ideas, analyses, competitors, and review themes in parent-first order. Keep the seed `.env` private.

Schema migrations live in `supabase/migrations/`. For a hosted Supabase project, apply migrations with the Supabase CLI and run the seed script from `supabase/seed/` as described there. Configure the public Supabase URL/publishable key and server-only `SUPABASE_URL`/`SUPABASE_SECRET_KEY` in Vercel project environment variables.
