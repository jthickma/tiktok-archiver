# ADR-0001: Keep Monitored Profiles in Both Text and SQLite State

- Status: Accepted
- Date: 2026-06-23

## Context

Operators need a plain-text profile list that can be edited or mounted without
using the web UI. The application also needs queryable profile state, scan
history, archive counts, and active/inactive status.

Maintaining `data/channels.txt` and the SQLite `channels` table creates
reconciliation complexity and a possible whole-file write race. Removing
either representation would also remove a currently supported operational
workflow.

## Decision

Keep both representations.

The Monitored Profiles module owns Profile Reconciliation:

- startup and monitor runs read the text file into SQLite;
- web mutations update SQLite and rewrite the text file;
- removing a profile from the text file marks it inactive during the next
  reconciliation;
- stopping monitoring never deletes archived media.

No route, scheduler, or other module may update these representations
independently.

## Consequences

- Operators retain a portable control file.
- The web UI retains queryable state and history.
- Reconciliation must be tested through the Monitored Profiles interface.
- Rewrites use atomic file replacement, so readers never observe a partially
  written profile file.
- A concurrent external edit can still be superseded by a later application
  rewrite; conflict detection can be added without changing this decision.
