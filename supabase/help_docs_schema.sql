-- Optional: Help-agent documentation knowledge base table.
-- Run in Supabase SQL Editor after the main schema.

create table if not exists public.help_docs (
  id uuid primary key default gen_random_uuid(),
  source_path text not null unique,
  title text not null,
  content text not null,
  checksum text not null,
  tags text[] not null default '{}',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_help_docs_updated_at on public.help_docs(updated_at desc);
create index if not exists idx_help_docs_tags on public.help_docs using gin(tags);

alter table public.help_docs enable row level security;

-- Service role bypasses RLS; client roles should not read/write this table directly.
