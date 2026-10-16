-- Store each review theme under the competitor app whose reviews produced it.
-- Existing analysis-wide themes remain nullable; newly written analyses always
-- set this value and the API returns themes grouped by competitor.
alter table public.review_themes
  add column if not exists analysis_competitor_id uuid
  references public.analysis_competitors (id) on delete cascade;

create index if not exists review_themes_competitor_sentiment_idx
  on public.review_themes (analysis_competitor_id, sentiment, mentions desc);

comment on column public.review_themes.analysis_competitor_id is
  'Competitor app whose reviews produced this sentiment theme. Null only for older analysis-wide theme rows.';
