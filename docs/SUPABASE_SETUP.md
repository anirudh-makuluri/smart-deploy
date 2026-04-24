# Supabase Setup

SmartDeploy uses **Supabase** (hosted PostgreSQL) as its primary database for users, deployments, deployment history, and cached repo metadata.

It also uses the same Supabase Postgres instance to store **authentication/session tables** for Better Auth.

---

## 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and sign up / sign in.
2. Click **New Project**.
3. Choose an organization, name the project (e.g. `smartdeploy`), set a database password, and pick a region close to where you'll run SmartDeploy.
4. Wait for the project to finish provisioning.

---

## 2. Run the schema migration

**Order matters:** create Better Auth’s tables first, then app tables (foreign keys reference `public."user"`).

1. Set `DATABASE_URL` in `.env` and run **`npm run auth:migrate`** locally so Better Auth creates `public."user"` / `session` / `account` / `verification`.
2. In the Supabase dashboard, open **SQL Editor**.
3. Paste the contents of [`supabase/schema.sql`](../supabase/schema.sql) into the editor.
4. Click **Run**.

If you already have the **legacy** `public.users` table from an older schema, run [`supabase/drop_legacy_users_table.sql`](../supabase/drop_legacy_users_table.sql) once in the SQL Editor **after** step 1 (it repoints foreign keys to `public."user"` and drops `public.users`).

If your project was created from an **older** `schema.sql` that did not yet include deploy metrics, run [`supabase/deploy_metrics_rpc.sql`](../supabase/deploy_metrics_rpc.sql) once in the SQL Editor (the app falls back to reading `deployment_history` in chunks if the function is missing, but the RPC is faster for aggregates).

This creates the following tables:

| Table | Purpose |
|-------|---------|
| *(Better Auth)* `user`, `session`, `account`, `verification` | Auth identities and sessions (via `auth:migrate`, not `schema.sql`) |
| `deployments` | Active deployments (one row per deploy) |
| `deployment_history` | Immutable log of every deploy attempt |
| `user_repos` | Per-user repo metadata |
| `repo_services` | Detected services for scanned repos |
| `approved_users` | Emails allowed to sign in |
| `waiting_list` | Users who tried to sign in but aren't approved yet |
| `_health` | Simple health-check row |

Row Level Security (RLS) is enabled on all tables. The **service role key** bypasses RLS, which is what the server uses.

To grant someone access, insert their email into `approved_users`. If someone signs in before being approved, SmartDeploy will add them to `waiting_list` and deny access.

---

## 3. Get your credentials

1. In the Supabase dashboard, go to **Project Settings -> API**.
2. Copy:
   - **Project URL** (e.g. `https://abcdefgh.supabase.co`)
   - **service_role key** (under "Project API keys" -> `service_role`, the secret one, not the `anon` key)

Add them to your `.env`:

```
SUPABASE_URL=https://abcdefgh.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
```

> **Never expose the service role key to the browser.** SmartDeploy only uses it server-side.

### Supabase Postgres connection string (for Better Auth)

Better Auth needs a server-side Postgres connection string to the **same Supabase project**.

1. In the Supabase dashboard, open **Connect** (or **Project Settings → Database → Connection string**).
2. Set `DATABASE_URL` to a URI from the dashboard.

**IPv4 vs direct host:** The default **direct** string uses host `db.<project-ref>.supabase.co` on port **5432**. Supabase documents this path as **IPv6-first**; the dashboard may show *“Not IPv4 compatible — use Session Pooler if on an IPv4 network”*. On many home/office networks (especially Windows), **IPv4-only** routing is common, so the direct host can fail intermittently (`ENOTFOUND`, timeouts, or unreachable DB) even though the project and password are correct.

For **local dev and typical servers on IPv4**, prefer the **Session pooler** (Supavisor session mode) string instead. It uses a host like `aws-0-<REGION>.pooler.supabase.com`, port **5432**, and a username of the form `postgres.<project-ref>` (see the dashboard **Session pooler** tab). That path supports **IPv4 and IPv6** and works well with a persistent Node app and `pg`.

Official overview: [Connect to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres) (direct vs pooler session vs transaction).

```
DATABASE_URL=postgresql://...
```

> **Never expose `DATABASE_URL` to the browser.** It must remain server-only.

> **Migrations:** You can run `npm run auth:migrate` with either direct or session pooler URI; if direct fails on your network, use the session pooler string for all server-side Postgres (including `DATABASE_URL`).

### Lock down Better Auth tables (recommended)

Better Auth stores auth/session/account data in Postgres tables (e.g. `user`, `session`, `account`, `verification`).

SmartDeploy does **not** access these via Supabase PostgREST from the browser — Better Auth uses the server-side `DATABASE_URL`.
So, the recommended hardening step is to prevent the Supabase API roles (`anon`, `authenticated`) from querying these tables at all.

Run the following in Supabase **SQL Editor**:

```sql
revoke all on table public."user" from anon, authenticated;
revoke all on table public."session" from anon, authenticated;
revoke all on table public."account" from anon, authenticated;
revoke all on table public."verification" from anon, authenticated;

-- If any sequences were created by the migration:
revoke all on all sequences in schema public from anon, authenticated;
```

---

## 4. (Optional) Deployment screenshots bucket

SmartDeploy can store deployment screenshots in Supabase Storage.

1. In the dashboard, go to **Storage** and create a new bucket called `deployment-screenshots` (or any name).
2. Set it to **public** if you want screenshot URLs to be directly accessible.
3. If you use a different bucket name, set it in `.env`:

```
DEPLOYMENT_SCREENSHOT_BUCKET=your-bucket-name
```

The default is `deployment-screenshots`.

---

## 5. (Optional) Help-agent docs knowledge base table

If you want docs stored in Supabase (for admin workflows, analytics, and hybrid retrieval), create the optional docs table and sync markdown files.

1. In Supabase SQL Editor, run:

```sql
-- file: supabase/help_docs_schema.sql
```

2. Ensure `.env` includes:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

3. Sync docs from `README.md` and `docs/**/*.md`:

```bash
npm run sync:help-docs
```

4. Optional: remove rows for deleted docs while syncing:

```bash
npm run sync:help-docs -- --prune
```

This writes to `public.help_docs` with `source_path`, `title`, `content`, `checksum`, and `tags`.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set" | Both env vars are required. Double-check `.env`. |
| `getaddrinfo ENOTFOUND` / DB unreachable for `db.*.supabase.co` on a laptop or IPv4 network | Use the **Session pooler** connection string (not the direct IPv6-only host). See [Supabase: connecting to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres#pooler-session-mode). |
| "relation does not exist" | You haven't run `supabase/schema.sql` yet. |
| FK to `user`: Key `(owner_id)=(…)` not in table `"user"` | Old rows may still use a **GitHub numeric id** as `owner_id`. Run [`supabase/remap_legacy_owner_ids_to_better_auth.sql`](../supabase/remap_legacy_owner_ids_to_better_auth.sql) after signing in once with GitHub so `account` links `accountId` → `userId`. Remaining orphans can be deleted or fixed manually. |
| Permission denied / RLS error | Make sure you're using the **service_role** key, not the **anon** key. |
