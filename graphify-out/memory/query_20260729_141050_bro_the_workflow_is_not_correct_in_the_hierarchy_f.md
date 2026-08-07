---
type: "query"
date: "2026-07-29T14:10:50.980408+00:00"
question: "Bro the workflow is not correct in the hierarchy fix it bro. And make the hierarchy thing more better visually give it a better UI and UX"
contributor: "graphify"
outcome: "useful"
source_nodes: ["buildOrganizationHierarchy()", "OrganizationChart()", "hierarchy-page.tsx"]
---

# Q: Bro the workflow is not correct in the hierarchy fix it bro. And make the hierarchy thing more better visually give it a better UI and UX

## Answer

Expanded from original query via graph vocabulary: organizational, hierarchy, reporting, workflow, manager, executive, chart, role, employee, line. The root cause was in buildOrganizationHierarchy and OrganizationChart: executive role labels did not affect sibling ordering, and the recursive flex layout rendered the full employee tree as an impractically wide canvas. Corrected executive precedence and changed the chart to a searchable, collapsible vertical tree with explicit reporting and leave-approval paths.

## Outcome

- Signal: useful

## Source Nodes

- buildOrganizationHierarchy()
- OrganizationChart()
- hierarchy-page.tsx