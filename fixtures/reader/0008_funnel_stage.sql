-- 0008_funnel_stage.sql
--
-- The file that started this build: `kinas open 0008_funnel_stage.sql` used to print
-- "is not a .md or .mdx file" and exit 65. It is a fixture now, so the happy path is
-- the real shape of the thing Miguel opens, not a toy.
--
-- Forward-only: shipped migrations are never edited.

alter table leads
  add column funnel_stage text not null default 'new'
  check (funnel_stage in ('new', 'qualified', 'contacted', 'won', 'lost'));

-- Read by the funnel view, which filters by stage within one org.
create index leads_by_stage on leads (org_id, funnel_stage, created_at desc);

-- Backfill what the tags column already implied, so the new column is never
-- silently wrong for rows that predate it.
update leads
   set funnel_stage = case
         when tags like '%won%' then 'won'
         when tags like '%lost%' then 'lost'
         when tags like '%contacted%' then 'contacted'
         else 'new'
       end
 where funnel_stage = 'new';
