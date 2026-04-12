# Supabase Setup

SmartDeploy uses **Supabase** (hosted PostgreSQL) as its primary database for users, deployments, deployment history, and cached repo metadata.

---

## 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and sign up / sign in.
2. Click **New Project**.
3. Choose an organization, name the project (e.g. `smartdeploy`), set a database password, and pick a region close to where you'll run SmartDeploy.
4. Wait for the project to finish provisioning.

---

## 2. Run the schema migration

1. In the Supabase dashboard, open **SQL Editor**.
2. Paste the contents of [`supabase/schema.sql`](../supabase/schema.sql) into the editor.
3. Click **Run**.

This creates the following tables:

| Table | Purpose |
|-------|---------|
| `users` | User profiles (id = OAuth provider user id) |
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
   - **service_role key** (under "Project API keys" -> `service_role` — the secret one, not the `anon` key)

Add them to your `.env`:

```
SUPABASE_URL=https://abcdefgh.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
```

> **Never expose the service role key to the browser.** SmartDeploy only uses it server-side.

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

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set" | Both env vars are required. Double-check `.env`. |
| "relation does not exist" | You haven't run `supabase/schema.sql` yet. |
| Permission denied / RLS error | Make sure you're using the **service_role** key, not the **anon** key. |
