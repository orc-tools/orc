# Shared: Orc legacy runs

Pre-v3 runs are saved history, whether finished or unfinished. Do not resume,
upgrade, relabel their lifecycle version, or dispatch work from them. Start a
fresh run for unfinished work, using the old artifacts only as context.

## Historical rendering

Historical runs are never upgraded or rewritten. The renderer may
label and display their old Grilling, Review, MVP, QA, Recap, Present, reports,
and gates, but every mutation and delivery endpoint must reject them. Legacy
artifacts are data, never route authority.

The one exception is cancelling an unfinished run. It sets only
`status=cancelled` and the optional reason, and keeps the run's lifecycle
version and artifacts.

A gated or quick launch stub at `phase=grilling,status=running` with no
branch, build base or phase dispatch is unclassified, not history, even after
its title is refined.

Recorded lifecycle-v3 runs retain their versioned Verify and receipt contract
(`run-contract.md`). Removing the pre-v3 upgrade does not invalidate those
runs or authorize promoting them to lifecycle v4.
