# Mobile App Agent

Mobile App Agent helps founders explore the market around an app idea. It is built with Next.js App Router, React, TypeScript, and npm. The Supabase API is read-only: it loads saved ideas and analyses. The Explore Market form shows an unsaved fixture-backed preview until live analysis generation is implemented.

## Run locally

```sh
npm install
npm run dev
```

Open http://localhost:3000. The server reads `SUPABASE_URL` and `SUPABASE_SECRET_KEY` from `.env.local` or, as a fallback, `supabase/seed/.env`. Never expose the secret in browser code or commit either environment file.

## API routes

- `GET /api/users` returns users from Supabase.
- `GET /api/history?userId=...` returns that user's saved ideas and analyses.
- `GET /api/snapshot?analysisId=...` returns the selected saved analysis, competitors, and review themes.
- `POST /api/analyses` saves a new idea, its analysis counts, and its competitor records to Supabase. Re-analyzing an existing idea replaces its prior analysis snapshot. It uses the server-side Supabase secret and removes partial writes if a later insert fails.
- `POST /api/similar-apps` accepts `{ "appDescription": "..." }` and returns `{ "suggestedAppName": "...", "apps": [...] }`. The apps array contains ten `{ name, appSummary, appleAppStoreUrl, googlePlayUrl }` competitors. `appSummary` is a short phrase of at most five words. Store URLs are `null` when a listing cannot be verified.
- `POST /api/app-metadata` accepts `{ "apps": [{ "name": "...", "appSummary": "...", "appleAppStoreUrl": "...", "googlePlayUrl": "..." }] }` and returns a combined rating (the higher store rating) and review count for each app. The review count averages Apple user ratings and Google Play ratings when both are available; otherwise it uses the available store count.

The UI calls these routes for **Your Work** and saved snapshot details. `mockApis/market-data.ts` reads `mockData/market-fixtures.json` directly for the unsaved sample preview; it does not call Supabase.

There is no write endpoint for creating analyses. The future generation flow will call an LLM and app-store APIs, then save those results. Until then, new idea previews do not modify history or the database.

The similar-app route uses the OpenAI Responses API with web search and structured output. Configure `OPENAI_API_KEY` on the server; `OPENAI_MODEL` is optional and defaults to `gpt-5.5`. This endpoint only returns similar app listings; it does not persist analyses or collect reviews.

`/api/app-metadata` is a Next.js TypeScript route. It uses Apple's iTunes lookup endpoint and the `@mradex77/google-play-scraper` npm package. It intentionally omits long store descriptions; the short `appSummary` comes from the similar-app discovery request. Run `npm run dev` locally to exercise it with the rest of the Next.js app. The scraper requires Node.js 22.12 or newer.

## Supabase seed data

`mockData/market-fixtures.json` contains illustrative fixtures, including app-specific themes for every mock competitor. The JavaScript seed scripts under `supabase/seed/` use this same JSON file to seed users, ideas, analyses, competitors, and review themes in parent-first order. Keep the seed `.env` private.

Schema migrations live in `supabase/migrations/`. For a hosted Supabase project, apply migrations with the Supabase CLI and run the seed script from `supabase/seed/` as described there. Configure `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in Vercel project environment variables for deployed API routes.
