# Environment editor row identity

The environment variable sheet previously regenerated identities for appended
rows when the list length changed, reused positions when external entries
reordered, and mutated caller-owned entry objects while editing. Delete buttons
and inputs also lacked accessible names. Initial DOM regressions failed against
the unchanged cookie-isolation parent at `6a090c9`.

The editor now stores stable row identities separately from persisted name/value
data. A component namespace and monotonic sequence allocate identities once;
positions and secret values never establish identity. Local updates preserve
each row's identity and create a new object only for the edited entry. External
loads/reorders match entry references first, then unambiguous nonempty names.
Duplicate and blank rows receive separate identities. Removed identities are
never recycled within the editor instance.

Secret reveal state follows the row identity. Removing the focused row or
closing the sheet clears that state; another row or a reopened sheet cannot
inherit it. Row inputs and remove buttons
have ordinal accessible names without secret values. Existing appearance,
controlled name/value contract, normalization, paste behavior and import
precedence remain. Nothing changes the secret storage API or cloud resources.

The identity snapshot adjusts before React commits externally changed entries,
following [React's conditional state adjustment guidance](https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes)
and [stable list identity guidance](https://react.dev/learn/rendering-lists#keeping-list-items-in-order-with-key).
An effect does not notify the parent or derive display values. A layout effect
only synchronizes the committed snapshot used by an external FileReader callback.
The callback merges into current edits instead of restoring values captured
when reading started. Imported values retain the existing last-value precedence.
Superseded reads are aborted and their callbacks cleared; unmount cancels any
pending read. ConfigTabs keys the editor by the actual DeployConfig.id, so
switching deployments resets reveal/row state and cancels the previous import.

## Evidence and scope

DOM regressions cover immutable edits, repeated add/delete, duplicate/blank
identities, external reorder under Strict Mode, reveal masking, accessible
controls, paste/import precedence, actual jsdom FileReader completion, and a
deterministically delayed read interleaved with edits/addition. They exercise
the real sheet/Radix/input components without replacing their rendering.
The real ConfigTabs/editor composition also verifies that a second deployment's
same-named secret starts masked in a fresh input. Its data-fetch hook is mocked;
the sheet is not. Superseded/unmounted readers cannot notify the parent.
This is local DOM evidence, not a hosted UI or native assistive-technology audit.

The raw Doctor targets are `no-array-index-as-key` and
`shadcn-icon-button-requires-label`. Canonical index-key guidance was available
but reported plugin version 0.9.3, while the pinned scanner is 0.9.18. The icon
prompt returned 404. Matched local `rules explain` output and the actual source/
DOM failures establish applicability; no rule was suppressed or disabled.

Final local verification passes: 136 unit files / 587 tests, including eleven
editor regressions and both actual ConfigTabs composition tests; full typecheck,
lint, worker compilation, configured production build and diff checks. The
initial five regressions failed against the parent. The deployment-switch test
also failed when its reset was temporarily removed, then passed when restored.
An additional real-focus close/reopen regression reproduced a plain-text secret;
clearing reveal state before closing fixes it.
Existing dynamic build tracing warnings remain. No hosted or native browser
editor audit was run for this increment, and no production change was made.

Pinned Doctor 0.9.18 completes all five changed source/test files at 100/100 with
zero findings. The complete unfiltered 588-file repository scan improves from
82/100 (42 warnings) to 83/100 (40 warnings), both with zero errors. These are
scanner-reported results without suppression. Full >=95 and complete-feature
production gates remain unmet; this increment stays draft on the cookie PR.
