---
type: "query"
date: "2026-07-28T09:33:10.717013+00:00"
question: "/plan Implement a UI branching feature in system page. This UI branching feature is for showcasing the hierarchy between different roles while also acting as a search filter in place to find users."
contributor: "graphify"
outcome: "useful"
source_nodes: ["QuerySystemUsersDto", ".listUsers()", ".listRoles()"]
---

# Q: /plan Implement a UI branching feature in system page. This UI branching feature is for showcasing the hierarchy between different roles while also acting as a search filter in place to find users.

## Answer

Expanded from original query via graph vocab: [system, role, roles, user, users, access, filter, tree]. The System page already loads roles and users. QuerySystemUsersDto and SystemService.listUsers support search and roleId filters. SystemService.listRoles returns role data but not RBAC inheritance metadata. Plan: expose catalogue inherits metadata, render an accessible role hierarchy filter above the users table, combine selected role and text search in the existing users request, style in the existing stylesheet, and extend the System Playwright regression.

## Outcome

- Signal: useful

## Source Nodes

- QuerySystemUsersDto
- .listUsers()
- .listRoles()