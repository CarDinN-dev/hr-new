# Project defaults

## Source of truth

- Use this repository (`C:\Users\Lenovo\OneDrive\Documents\HR NEw`) for MedTech HR ERP work. Its GitHub origin is `CarDinN-dev/hr-new` on `main`.
- The live application is the existing `medtech-hr-erp` Compose deployment in `/opt/medtech-hr-erp` on Google Cloud project `hr-erp-502412`; do not use older HR/ERP folders as deployment sources.

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

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
