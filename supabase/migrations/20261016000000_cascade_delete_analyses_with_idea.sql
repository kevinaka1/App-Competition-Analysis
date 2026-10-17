alter table public.analyses
  drop constraint if exists analyses_idea_id_fkey;

alter table public.analyses
  add constraint analyses_idea_id_fkey
  foreign key (idea_id)
  references public.ideas (id)
  on delete cascade;
