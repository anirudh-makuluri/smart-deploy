# Creator workspace and app sharing controls

`/home/apps`, linked from the dashboard's Apps & team item, lets a verified,
approved workspace owner/admin create team workspaces and app identities, create
and revoke member invitations, and grant/revoke an existing member's app use.
It uses the existing authenticated workspace and grant APIs. It introduces no
new server mutation adapter, role, AWS operation or migration. Creating an app
reserves its identity; runtime publishing remains a separate integration.

Both workspace/private-gateway feature flags must be enabled. The server checks
a fresh Better Auth session and platform approval before projecting only ID and
email into the client. Hydrated controls additionally require the same verified
identity. Ordinary memberships do not enter the management selector. Personal
workspaces cannot invite colleagues. Owners/admins inherit app access; only
ordinary members have explicit grant/revoke controls. Membership alone grants
neither app use nor previews. The server remains authoritative on every request.

Client form actions call the existing same-origin JSON APIs. These are React
client actions, not Server Actions or a no-JavaScript submission flow. Controlled
drafts survive errors; form status disables pending fields and submit buttons.
Requests have an eight-second abort deadline, no redirects, no cache and no write
retry. Validated creation receipts must match actor, workspace, name or invitee
as appropriate. A malformed acknowledgement cannot clear an app draft or reveal
an invitation link. An unconfirmed change may have committed; further attempts
are blocked until an explicit refresh checks current state.

Query keys include the current actor. Workspace/app selection remounts the
relevant child controls, aborting pending work. Identity changes unmount the
management view and late receipts cannot restore it. App lists are checked against
the selected workspace before showing controls. Refresh reads current members,
grants and pending invitations; an accepted or revoked invitation's displayed
link disappears. Creation requests only the ordinary member role. Links remain
in component memory, use HTTPS fragment tokens, are masked in a readonly password
field and reach the clipboard only after an explicit Copy click. No email is sent.
The existing analytics privacy wrapper masks this panel and excludes invitation
network bodies. The page adds no-referrer, frame denial, nosniff and no-index.

Final serial local verification: 173 unit files/1,326 tests (30 new), all 21
compiled Next/Better Auth/PostgreSQL/native HTTPS browser cases (three new), five
public/analytics browser cases, two compiled gateway and two workload process
cases pass. Typecheck, full lint, private/public production builds and worker/
workload compilation pass. Complete unfiltered React Doctor 0.9.18 is 100/100
across 710 files, zero errors/warnings/skips, no suppression. Chromium mobile
output was visually inspected at 390px with no horizontal overflow. Fixtures and
the owned disposable PostgreSQL database were stopped afterward.

The new browser flow actually creates a team/app, creates an invitation, explicitly
joins as a separate verified unapproved fixture account, checks no management or
app use before a grant, then grants/revokes through the creator UI and checks the
SQL authorization result. It also verifies draft preservation after intercepted
malformed success and waiting-list denial of management. Copy is unit-tested with
a clipboard mock; browser tests do not write the user's OS clipboard. Initial
browser test expectations were repaired for Next's hidden announcer and the
existing waiting-list guard; all final cases run without skips. Initial three
Doctor findings were repaired with client form actions, form-status controls and
cohesive invitation components rather than suppressions.

The unchanged standalone SQL/storage implementations pass exact parent #130 CI
and were not rerun locally for this UI slice. Local identity verification and
approval are controlled fixtures; this is not hosted OAuth/AWS proof. Trusted
publish/launch composition, restricted document credentials, bounded AWS demo
provisioning and hosted creator/colleague/revocation/persistence proof remain
release gates. No production account, invitation, email, provider connection,
flag, migration, cloud resource, worker startup, rollout merge or deployment was
changed. Billing #85 remains separate.
