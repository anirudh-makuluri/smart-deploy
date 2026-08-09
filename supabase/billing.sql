-- Billing: credit top-ups via Stripe Checkout.
-- Prerequisite: Better Auth `public."user"` table exists.
-- Run after schema.sql in the Supabase SQL Editor.

-- Per-user billing profile and cached credit balance (ledger is source of truth for audit).
create table if not exists public.user_billing_accounts (
  user_id text primary key references public."user"(id) on delete cascade,
  stripe_customer_id text unique,
  credit_balance int not null default 0 check (credit_balance >= 0),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_billing_accounts_stripe_customer
  on public.user_billing_accounts(stripe_customer_id)
  where stripe_customer_id is not null;

-- Sellable credit packages (admin-managed; seed defaults below).
create table if not exists public.topup_packages (
  id text primary key,
  credits int not null check (credits > 0),
  price_cents int not null check (price_cents > 0),
  currency text not null default 'usd',
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_topup_packages_active_sort
  on public.topup_packages(active, sort_order asc);

-- Append-only credit ledger.
create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public."user"(id) on delete cascade,
  amount int not null check (amount <> 0),
  type text not null check (type in ('topup', 'usage', 'refund', 'admin')),
  reference_id text,
  country_code text,
  tax_amount_cents int check (tax_amount_cents is null or tax_amount_cents >= 0),
  tax_rate numeric(7, 4) check (tax_rate is null or (tax_rate >= 0 and tax_rate <= 1)),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_credit_ledger_user_created
  on public.credit_ledger(user_id, created_at desc);

-- Idempotent top-up grants: one Stripe payment_intent / checkout session credits once.
create unique index if not exists idx_credit_ledger_topup_reference
  on public.credit_ledger(reference_id)
  where reference_id is not null and type = 'topup';

-- Idempotent usage debits (deploy, uptime, scan, etc.).
create unique index if not exists idx_credit_ledger_usage_reference
  on public.credit_ledger(reference_id)
  where reference_id is not null and type = 'usage';

-- Stripe webhook idempotency (Stripe retries events).
create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now()
);

create index if not exists idx_stripe_webhook_events_processed_at
  on public.stripe_webhook_events(processed_at desc);

alter table public.user_billing_accounts enable row level security;
alter table public.topup_packages enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.stripe_webhook_events enable row level security;

-- Default packages: tuned for Render/Railway-comparable hobby usage (hosting included).
-- $5 ≈ 70 container deploys or several months of light hobby use (8 deploys + 4 scans ≈ 100 credits).
insert into public.topup_packages (id, credits, price_cents, currency, active, sort_order)
values
  ('starter', 700, 500, 'usd', true, 1),
  ('growth', 1500, 1000, 'usd', true, 2),
  ('pro', 3500, 2000, 'usd', true, 3)
on conflict (id) do nothing;
