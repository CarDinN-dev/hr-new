# MedTech HR ERP user guide

## Dashboard, My HR, and Leave

This guide covers only the **Dashboard**, **My HR**, and **Leave** areas. What you can see or do depends on the active role(s) assigned to your account. If an item is not shown, it is not available to your account; contact HR or a system administrator rather than using another person's account.

## Getting around

After signing in, use the left navigation:

| Area | Purpose | Direct path |
| --- | --- | --- |
| **Dashboard** | Today’s HR overview and shortcuts | `/` |
| **My HR** | Your personal information, current leave, service requests, and payslips | `/me` |
| **Leave** | Leave balance, applications, approvals, and history available to your role | `/leave` |

On a phone or narrow screen, select the menu icon in the top-left corner to open the navigation. Use the bell in the top bar for notifications. Select your name at the bottom of the sidebar to open **My HR**, change light/dark mode, or log out.

The Dashboard is available to every active role. **My HR** is available to roles that have self-service access. The **Leave** page changes according to the role, reporting relationship, workflow assignment, and any permission overrides.

## What each role can do

| Role | Dashboard | My HR | Leave |
| --- | --- | --- | --- |
| **Employee** | View the company dashboard and personal leave count | View own profile, current leave, requests, and payslips | Submit, track, correct, resubmit, or cancel own leave when allowed |
| **Line Manager** | Same dashboard, including leave items available to the role | Same personal self-service area | View direct-report leave and act on requests assigned at the Line Manager stage |
| **Manager** | Same dashboard, including leave items available to the role | Same personal self-service area | View leave in the management tree and act on requests assigned at the Manager stage |
| **HR** | Same dashboard, with HR shortcuts where applicable | Same personal self-service area | View and administer company leave; submit for an employee, approve assigned HR steps, or use the HR override action |
| **CPO** | Same dashboard, with executive payroll access where assigned | Same personal self-service area | View company leave and act on requests assigned at the CPO stage |
| **COO** | Same dashboard, with executive payroll access where assigned | Same personal self-service area | View company leave and act on requests assigned at the COO stage; the COO’s own leave has a protected self-approval route |
| **Administrator** | Same dashboard | Same personal self-service area | View all leave and reassign a current approval step; cannot make ordinary approval decisions unless another role grants that permission |
| **Super Administrator** | Same dashboard, including administrative shortcuts | Same personal self-service area | Full leave administration: submit for an employee, approve assigned steps, reassign, and override a request to Approved, Rejected, or Cancelled |

Role names can be combined. When your account has more than one active role, the available actions are the combined permissions, subject to the request’s assigned approval stage.

## Dashboard

The Dashboard is the home page after sign-in. It is a quick overview, not an approval screen.

### Read the top section

The **Today at MedTech** panel shows the current date, attendance summary, number of open leave items, and document-expiry alerts. The action buttons on the right are permission-based:

- **Add employee** appears only for roles allowed to create employee records.
- **Run payroll** appears for roles that can generate payroll.
- **View payslips** appears for roles that can open payroll but cannot generate it.

The metric cards underneath show active employees, today’s attendance, pending leave, open positions, current-month payroll, and documents expiring in the next 60 days. A warning colour means the value needs attention; it does not by itself mean that you have permission to resolve it.

### Use the dashboard panels

- **Headcount by Department** compares active employee counts by department.
- **Pending Leave Approvals** lists up to six leave requests awaiting a workflow decision. Open **Leave** to review a request or take action.
- **Birthdays – next 30 days** lists upcoming birthdays.
- **Recent Joiners** lists the latest employee records.

### Role-specific dashboard routine

**Employee:** check the pending-leave count, then open **My HR** to see your current application or **Leave** to submit one.

**Line Manager or Manager:** check **Pending Leave Approvals**, then open **Leave** and use the request list or your assigned approval inbox. Only requests assigned to you can be decided.

**HR:** start with pending leave and compliance alerts. Use **Leave** for employee requests; use the dashboard shortcut only when you need the related employee or payroll module.

**CPO or COO:** use the pending-leave count as a prompt to open **Leave** and work only the requests assigned to your executive stage.

**Administrator or Super Administrator:** use the dashboard to identify workload; use **Leave** for the actual reassignment or administrative action.

## My HR

Open **My HR** from the left navigation or your account menu. This is your self-service page, even when you also have a management, HR, or administrator role.

### Personal information

The **Personal information** card shows your name, employee ID, designation, reporting manager, department, phone number, and work email. These fields are read-only here and maintained by HR in the employee record. If something is wrong, contact HR with the correct details.

Your profile-photo panel lets you manage the picture associated with your profile when that option is enabled for your account.

### Current leave application

The **Current leave application** card shows your newest active request. If none is active, it shows the latest completed request. Select **View Leave** to open the full Leave page.

Use this card to check the request type, dates, number of days, and status. For the approval path, decision history, correction, cancellation, or a new application, continue in **Leave**.

### Service requests and payslips

The remaining panels show your service requests and payslips when your account has those self-service permissions. They are included for personal reference; management or HR rights do not turn this page into an employee-administration page.

## Leave

Open **Leave** from the left navigation, or select **View Leave** on My HR. The page has three main working areas: leave balance and application, the request list, and the request timeline.

### Submit a leave request

For Employees, Line Managers, Managers, CPOs, and COOs, the request is made for yourself. HR and Super Administrators can select an employee first and submit on that employee’s behalf.

1. Open **Leave**.
2. Check **Leave balance** for the selected leave year and type. The card shows total, used, pending, and available days. A leave type that does not need a balance is marked accordingly.
3. In **New leave request**, choose the leave type, then choose the start and end dates.
4. Choose **Half day** only when that leave type permits it.
5. Read the preview before submitting. It shows the calculated duration, paid/unpaid days, available balance, eligibility, and whether a supporting file is required.
6. Enter a clear business reason. Attach the required supporting file, if the preview asks for one.
7. Select **Submit request**.

The system prevents a request from being submitted when it is ineligible, overlaps a pending/approved request, has insufficient applicable balance, requires a missing attachment, or covers a period whose payroll has already been closed for this type of change.

### Track a request

The **Leave requests** table shows the requests available to your role. Use the search field to find an employee, leave type, status, or date. The table includes employee, leave type and total days, dates, paid/unpaid split, attachment status, current status, and actions.

Select **Timeline** on a request to see each workflow stage, assigned approver, recorded decision, decision reason, and timestamp. Use the timeline instead of guessing who currently owns the request.

Common statuses are:

| Status | Meaning | What to do |
| --- | --- | --- |
| **Pending Line Manager / Manager / HR / CPO / COO** | The request is waiting at the named stage | Wait, or act if the request is assigned to you |
| **Returned for Correction** | An approver needs the requester to amend the request | Select **Correct and resubmit**, update the details, then resubmit |
| **Blocked Approver Missing** | The required approver could not be resolved | Contact HR or an Administrator/Super Administrator to correct or reassign the workflow |
| **Approved** | The leave workflow is complete | Keep the confirmation for your records |
| **Rejected** | The request was not approved | Review the decision reason in the timeline |
| **Cancelled** | The request was withdrawn or administratively cancelled | Submit a new request if leave is still required |

### Employee and self-service actions

All self-service roles can view their own requests. An Employee can submit a request, attach a required document, and open its timeline.

For your own request:

- Select **Cancel** while it is pending, returned for correction, or blocked, if your account has the self-cancel permission. Enter a meaningful reason when requested.
- If the request is **Returned for Correction**, select **Correct and resubmit**. Update the leave type, dates, duration, reason, and replacement attachment as needed; then confirm the resubmission.
- If an attachment needs updating, use **Add file** or **Replace**. The replacement must meet the allowed upload requirements.

You cannot approve your own request through the normal workflow.

### Approver actions: Line Manager, Manager, HR, CPO, and COO

The page shows **Approve**, **Return**, and **Reject** only when the current step is assigned to you and your active role matches that step. A request can be visible to you without being assigned to you; visibility does not grant approval authority.

1. Find the request in the table or the assigned inbox.
2. Select **Timeline** and review dates, type, balance impact, attachments, and earlier decisions.
3. Select the appropriate action:
   - **Approve** moves the request to the next required stage, or marks it Approved if it is the final step.
   - **Return** sends it back to the requester for correction. A decision reason is required.
   - **Reject** ends the request. A decision reason is required.
4. Confirm the action and check the success message. The request list and timeline refresh after a successful decision.

Approval routes are based on the requester’s organisational role. A standard employee normally routes through Line Manager, Manager, HR, CPO, then COO. More senior requesters skip the stages below them: a Line Manager starts at Manager, a Manager starts at HR, HR starts at CPO, and a CPO starts at COO. The COO’s own request follows a protected COO self-approval route.

For a COO self-approval, the application asks for recent re-authentication: enter the current password for a local account, or re-authenticate with Microsoft when using Microsoft sign-in. This confirms the protected decision; it is not a password change.

### HR actions

HR can select an employee in the new-request form, view company leave, and handle its assigned HR-stage decisions. HR can also use **Override & approve** for an active request belonging to another employee. This immediately approves the request and bypasses remaining workflow stages, so use it only under the company’s approved exception process and enter a clear reason.

HR can cancel a request when policy permits and can replace an attachment on behalf of the employee. HR should use the normal assigned-stage decision whenever possible; the override is for exceptions, not routine processing.

### Administrator actions

Administrators can view the company leave register and use **Reassign** on the active stage when a qualified replacement approver is needed. Select the replacement approver from the list, provide a reason, and confirm. Reassignment keeps the request at the same workflow stage.

The Administrator role is not a normal leave approver. It does not make **Approve**, **Return**, or **Reject** available unless the account also has a role or specific permission that grants that action.

### Super Administrator actions

Super Administrators inherit the standard, management, HR, executive, and Administrator capabilities. In addition, **Override** lets them set an active request to **Approved**, **Rejected**, or **Cancelled**. The workflow records the decision, reason, affected stages, and audit history.

Use an override only when you are authorised to bypass the workflow. Prefer the ordinary assigned-stage action or reassignment when either resolves the issue.

## Good operating practice

- Use the account menu to confirm the roles shown beneath your name before taking a sensitive action.
- Check the timeline before approving, returning, rejecting, reassigning, or overriding a request.
- Give a specific reason for a return, rejection, cancellation, reassignment, or override; it becomes part of the request history.
- Do not use another employee’s account to bypass an unavailable action. Ask HR or a system administrator to verify the role, reporting line, or workflow assignment.
- If the screen reports that a request changed, refresh the list and review the latest timeline before trying again.
