-- Keep the individual reviews assigned to each sentiment theme so saved
-- analyses can show the evidence behind a cluster.
create table public.review_cluster_reviews (
  id uuid primary key default gen_random_uuid(),
  review_theme_id uuid not null references public.review_themes (id) on delete cascade,
  source_review_id text not null,
  store text not null check (store in ('appleStore', 'googlePlay')),
  score numeric(2, 1) not null check (score between 0.5 and 5),
  title text,
  body text not null,
  reviewed_at timestamptz,
  position integer not null check (position > 0),
  unique (review_theme_id, store, source_review_id),
  unique (review_theme_id, position)
);

create index review_cluster_reviews_theme_position_idx
  on public.review_cluster_reviews (review_theme_id, position);

alter table public.review_cluster_reviews enable row level security;

comment on table public.review_cluster_reviews is 'Recent store reviews assigned to a specific sentiment theme in a saved analysis.';
