---
type: "query"
date: "2026-08-07T18:46:54.992758+00:00"
question: "In the role hierarchy in the hierarchy page, branch managers, line managers, and employees at the same level from their shared parent."
contributor: "graphify"
outcome: "useful"
source_nodes: ["buildCompanyRoleHierarchy()", "DepartmentRoleHierarchy()", "hierarchy-page.tsx"]
---

# Q: In the role hierarchy in the hierarchy page, branch managers, line managers, and employees at the same level from their shared parent.

## Answer

Expanded from graph vocabulary: hierarchy, organization, chart, employee, manager, line, parent, child, node, edge, reporting, role. The role hierarchy uses buildCompanyRoleHierarchy for parent-child data and DepartmentRoleHierarchy for recursive rendering. Desktop sibling containers now use horizontal flex layout at both department roots and nested direct-report levels; compact mobile layout overrides both to a vertical grid.

## Outcome

- Signal: useful

## Source Nodes

- buildCompanyRoleHierarchy()
- DepartmentRoleHierarchy()
- hierarchy-page.tsx