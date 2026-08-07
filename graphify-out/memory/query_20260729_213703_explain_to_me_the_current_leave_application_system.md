---
type: "query"
date: "2026-07-29T21:37:03.011892+00:00"
question: "Explain to me the current leave application system for user roles."
contributor: "graphify"
outcome: "useful"
source_nodes: ["LeaveService", "LeaveWorkflowController", "LeaveRequestStatus", "LeaveApprovalStage"]
---

# Q: Explain to me the current leave application system for user roles.

## Answer

Expanded terms: leave, request, approval, approve, reject, balance, employee, manager, admin, role. Leave is a server-assigned, staged workflow: standard Employee route is Line Manager, Manager, HR, CPO, COO; requester seniority removes earlier stages; CPO goes to COO; COO self-approves with fresh authentication. Employee submits and views/cancels own pending request; line managers approve direct reports; managers approve management-tree requests; HR can submit for staff, configure balances/types, approve, and override to approval; CPO/COO approve executive stages; Admin reads all and reassigns; Super Admin can override terminal outcomes. Paid leave reserves pending balance at submission, moves it to used on final approval, and releases it on rejection/cancellation. Returned requests can be corrected and resubmitted.

## Outcome

- Signal: useful

## Source Nodes

- LeaveService
- LeaveWorkflowController
- LeaveRequestStatus
- LeaveApprovalStage