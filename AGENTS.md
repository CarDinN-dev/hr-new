# Project defaults

For every task in this repository, including new chats, use Ponytail at the `full` level by default.

- Read the relevant flow end-to-end before editing.
- Prefer the smallest safe root-cause change. Reuse existing helpers and patterns; prefer platform capabilities before adding dependencies.
- Do not add abstractions, dependencies, files, configuration, or tests unless they are necessary for the requested result.
- Preserve validation, error handling, security, accessibility, data integrity, and explicit requirements.
- For non-trivial logic, run the smallest relevant automated verification available in the repository.
- Preserve unrelated user changes.

## Live deployment

- Keep the current Cloudflare tunnel and live URL unchanged unless the user explicitly requests a tunnel or domain change.
- Deploy updates only to the existing `medtech-hr-erp` Docker Compose project in `/opt/medtech-hr-erp`; rebuild the affected existing services and never create a second application, database, or Compose stack.

Remain in Ponytail mode unless the user explicitly says `stop ponytail` or `normal mode`.
