import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { apiList, apiRequest, hasActiveSystemAdministratorRole, hasPermission, type BackendSession } from "../api";
import type { EmployeeRecord } from "../data";

type Permission = { id: string; code: string; displayName?: string; category: string; isProtected: boolean; isDeprecated: boolean };
type Role = { id: string; code: string; displayName: string; version: number; isBuiltIn: boolean; isActive: boolean; protection: "STANDARD" | "PROTECTED" | "SUPER_ADMIN"; inherits: string[]; permissions?: Array<{ permission: Permission }> };
type User = { id: string; email: string; isActive: boolean; localLoginEnabled: boolean; microsoftLoginEnabled: boolean; roles: Array<{ role: Role }> };
type InheritanceEditor = { role: Role; parentRoleIds: Set<string>; reason: string };
export type OrganizationalRole = "HR" | "MANAGER" | "LINE_MANAGER" | "EMPLOYEE";
type ExecutiveRole = "CPO" | "COO";

const key = (session: BackendSession, value: string) => [value, session.sessionId, session.authorizationVersion] as const;
const organizationalRoleLabel: Record<OrganizationalRole, string> = { HR: "HR", MANAGER: "Manager", LINE_MANAGER: "Line manager", EMPLOYEE: "Employee" };
const childRole: Partial<Record<OrganizationalRole, OrganizationalRole>> = { HR: "MANAGER", MANAGER: "LINE_MANAGER", LINE_MANAGER: "EMPLOYEE" };

export function hierarchyNodeRole(employee: EmployeeRecord): OrganizationalRole {
  if (hierarchyExecutiveRole(employee)) return "MANAGER";
  const designation = (employee.fields.Designation || "").trim().toLowerCase().replaceAll("_", " ");
  if (designation.includes("line manager")) return "LINE_MANAGER";
  if (/\bhr\b|human resources/.test(designation)) return "HR";
  if (designation.includes("manager") || designation.includes("cpo") || designation.includes("coo")) return "MANAGER";
  return "EMPLOYEE";
}

export function hierarchyExecutiveRole(employee: EmployeeRecord): ExecutiveRole | null {
  const roles = new Set(employee.roleCodes || []);
  if (roles.has("COO")) return "COO";
  if (roles.has("CPO")) return "CPO";
  return null;
}

export function hierarchyManagerCode(employee: EmployeeRecord) {
  return (employee.fields["Manager Employee Code/Name"] || employee.fields["Reporting Manager Employee Code/Name"] || "").split(" - ", 1)[0].trim().toLowerCase();
}

export function hierarchyLineManagerCode(employee: EmployeeRecord) {
  return (employee.fields["Line Manager Employee Code/Name"] || employee.fields["Reporting Manager Employee Code/Name"] || "").split(" - ", 1)[0].trim().toLowerCase();
}

export function hierarchyReportingPayload(lineManagerId: string, managerId: string) {
  return { lineManagerId: lineManagerId || null, managerId: managerId || null };
}

export function hierarchyUserParams(search: string, roleId: string) {
  const params = new URLSearchParams();
  if (search.trim()) params.set("search", search.trim());
  if (roleId) params.set("roleId", roleId);
  return params;
}

export function hierarchyInheritancePayload(editor: InheritanceEditor) {
  return { parentRoleIds: [...editor.parentRoleIds], expectedVersion: editor.role.version, reason: editor.reason.trim() };
}

export function HierarchyPage({ session, notify, employees, onAddNode, onUpdateReporting }: { session: BackendSession; notify: (message: string) => void; employees: EmployeeRecord[]; onAddNode: (role: OrganizationalRole, parent?: EmployeeRecord) => void; onUpdateReporting: (employeeId: string, reporting: { lineManagerId: string | null; managerId: string | null }) => Promise<void> }) {
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [editor, setEditor] = useState<InheritanceEditor | null>(null);
  const [reportingEmployee, setReportingEmployee] = useState<EmployeeRecord | null>(null);
  const params = hierarchyUserParams(search, selectedRoleId);
  const canManageHierarchy = hasActiveSystemAdministratorRole(session);
  const roles = useQuery({ queryKey: key(session, "hierarchy-roles"), queryFn: () => apiList<Role>("/system/roles"), enabled: canManageHierarchy });
  const users = useQuery({ queryKey: [...key(session, "hierarchy-users"), params.toString()], queryFn: () => apiList<User>(`/system/users?${params}`), enabled: canManageHierarchy });
  const selectedRole = roles.data?.find(role => role.id === selectedRoleId);
  const replaceInheritance = useMutation({
    mutationFn: (next: InheritanceEditor) => apiRequest(`/system/roles/${next.role.id}/inheritance`, { method: "PUT", csrfToken: session.csrfToken, body: JSON.stringify(hierarchyInheritancePayload(next)) }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: key(session, "hierarchy-roles") }); setEditor(null); notify("Role inheritance updated. Affected sessions were revoked."); },
  });
  const activeBuiltIns = (roles.data ?? []).filter(role => role.isBuiltIn && role.isActive);

  return <section className="stack">
    <div className="panel">
      <div className="panel-head"><div><h3>Organizational hierarchy</h3><span>Select + to add the next reporting level: HR → manager → line manager → employee.</span></div></div>
      <OrganizationChart employees={employees} canCreate={hasPermission(session, "employee.hr.create")} canEdit={hasPermission(session, "employee.hr.update")} onAddNode={onAddNode} onEditReporting={setReportingEmployee} />
      <p className="muted hierarchy-access-note">This chart manages employee reporting lines. Login access remains controlled by roles in System.</p>
    </div>
    {reportingEmployee && <ReportingEditor employee={reportingEmployee} employees={employees} onCancel={() => setReportingEmployee(null)} onSave={async reporting => { await onUpdateReporting(reportingEmployee.id, reporting); setReportingEmployee(null); }} />}
    <div className="panel">
      <div className="panel-head"><div><h3>Role hierarchy</h3><span>Explore inherited access and find the users assigned to each branch.</span></div></div>
      {roles.isPending ? <p className="muted">Loading role hierarchy…</p> : roles.isError ? <p className="sync-alert">{roles.error.message}</p> : <RoleBranchFilter roles={roles.data ?? []} selectedRoleId={selectedRoleId} onSelect={setSelectedRoleId} onEdit={role => setEditor({ role, parentRoleIds: new Set(role.inherits.map(code => roles.data?.find(item => item.code === code)?.id).filter((id): id is string => Boolean(id))), reason: "" })} />}
    </div>
    {editor && <div className="panel">
      <div className="panel-head"><div><h3>Edit {editor.role.displayName} hierarchy</h3><span>Choose the built-in roles whose permissions this custom role inherits.</span></div></div>
      <fieldset><legend>Inherited built-in roles</legend><div className="checkbox-grid">{activeBuiltIns.map(role => <label key={role.id}><input type="checkbox" checked={editor.parentRoleIds.has(role.id)} onChange={event => setEditor(current => { if (!current) return current; const parentRoleIds = new Set(current.parentRoleIds); if (event.target.checked) parentRoleIds.add(role.id); else parentRoleIds.delete(role.id); return { ...current, parentRoleIds }; })} /> {role.displayName}</label>)}</div></fieldset>
      <label>Reason<textarea value={editor.reason} onChange={event => setEditor(current => current ? { ...current, reason: event.target.value } : current)} /></label>
      <div className="form-actions"><button type="button" onClick={() => setEditor(null)}>Cancel</button><button className="primary" disabled={editor.reason.trim().length < 3 || replaceInheritance.isPending} onClick={() => replaceInheritance.mutate(editor)}>Save hierarchy</button></div>
      {replaceInheritance.isError && <p className="sync-alert">{replaceInheritance.error.message}</p>}
    </div>}
    <div className="panel">
      <div className="panel-head"><div><h3>Users in this hierarchy</h3><span>Search by name or email, then narrow the results by role.</span></div></div>
      <div className="system-user-filters"><label>Find users<input type="search" value={search} placeholder="Name or email" onChange={event => setSearch(event.target.value)} /></label>{(search || selectedRoleId) && <button type="button" onClick={() => { setSearch(""); setSelectedRoleId(""); }}>Clear filters</button>}</div>
      <p className="muted system-user-filter-summary" aria-live="polite">{users.isPending ? "Finding users…" : `${users.data?.length ?? 0} user${users.data?.length === 1 ? "" : "s"} found${selectedRole ? ` with ${selectedRole.displayName}` : ""}.`}</p>
      {users.isError ? <p className="sync-alert">{users.error.message}</p> : <div className="table-wrap"><table><thead><tr><th>User</th><th>Roles</th><th>Status</th></tr></thead><tbody>{users.data?.map(user => <tr key={user.id}><td>{user.email}</td><td>{user.roles.map(item => item.role.displayName).join(", ") || "No role"}</td><td>{user.isActive ? "Active" : "Disabled"}</td></tr>)}{!users.isPending && !users.data?.length && <tr><td colSpan={3} className="system-user-empty">No users match these filters.</td></tr>}</tbody></table></div>}
    </div>
  </section>;
}

function OrganizationChart({ employees, canCreate, canEdit, onAddNode, onEditReporting }: { employees: EmployeeRecord[]; canCreate: boolean; canEdit: boolean; onAddNode: (role: OrganizationalRole, parent?: EmployeeRecord) => void; onEditReporting: (employee: EmployeeRecord) => void }) {
  const active = employees.filter(employee => employee.status === "Active" || employee.status === "On Leave");
  const role = new Map(active.map(employee => [employee.id, hierarchyNodeRole(employee)]));
  const executives = new Map<ExecutiveRole, EmployeeRecord>();
  for (const employee of active) {
    const executive = hierarchyExecutiveRole(employee);
    if (executive) executives.set(executive, employee);
  }
  const managers = active.filter(employee => role.get(employee.id) === "MANAGER" && !hierarchyExecutiveRole(employee));
  const lineManagers = active.filter(employee => role.get(employee.id) === "LINE_MANAGER");
  const staff = active.filter(employee => role.get(employee.id) === "EMPLOYEE");
  const hrNames = active.filter(employee => role.get(employee.id) === "HR").map(employee => employee.fields["Full Name"]).filter(Boolean);
  const managerCodes = new Set([...managers, ...executives.values()].map(employee => employee.fields["Employee Code"].trim().toLowerCase()));
  const reportingCodes = new Set([...managers, ...executives.values(), ...lineManagers].map(employee => employee.fields["Employee Code"].trim().toLowerCase()));
  const unassigned = [
    ...lineManagers.filter(employee => !managerCodes.has(hierarchyManagerCode(employee))),
    ...staff.filter(employee => !reportingCodes.has(hierarchyLineManagerCode(employee))),
  ];

  return <div className="organization-chart" aria-label="Organizational hierarchy">
    <div className="organization-spine">
      <HierarchyRoleNode label="Super Administrator" detail="Overrides everyone" />
      <HierarchyRoleNode label="COO" detail={executives.get("COO")?.fields["Full Name"] || "Not assigned"} role="MANAGER" canEdit={canEdit && executives.has("COO")} onEdit={executives.get("COO") ? () => onEditReporting(executives.get("COO")!) : undefined} />
      <HierarchyRoleNode label="CPO" detail={executives.get("CPO")?.fields["Full Name"] || "Not assigned"} role="MANAGER" canEdit={canEdit && executives.has("CPO")} onEdit={executives.get("CPO") ? () => onEditReporting(executives.get("CPO")!) : undefined} />
      <HierarchyRoleNode label="HR" detail={hrNames.join(", ") || "Human Resources"} role="HR" canCreate={canCreate} onAdd={() => onAddNode("MANAGER")} />
    </div>
    {managers.length ? <div className="organization-branches">{managers.map(manager => {
      const managerCode = manager.fields["Employee Code"].trim().toLowerCase();
      const reports = lineManagers.filter(employee => hierarchyManagerCode(employee) === managerCode);
      const directEmployees = staff.filter(employee => hierarchyLineManagerCode(employee) === managerCode);
      return <div className="organization-manager-branch" key={manager.id}>
        <EmployeeHierarchyNode employee={manager} role="MANAGER" canCreate={canCreate} canEdit={canEdit} onAddNode={onAddNode} onEditReporting={onEditReporting} />
        {reports.length > 0 && <div className="organization-children">{reports.map(lineManager => {
          const lineManagerCode = lineManager.fields["Employee Code"].trim().toLowerCase();
          const employees = staff.filter(employee => hierarchyLineManagerCode(employee) === lineManagerCode);
          return <div className="organization-line-branch" key={lineManager.id}>
            <EmployeeHierarchyNode employee={lineManager} role="LINE_MANAGER" canCreate={canCreate} canEdit={canEdit} onAddNode={onAddNode} onEditReporting={onEditReporting} />
            {employees.length > 0 && <div className="organization-employees">{employees.map(employee => <EmployeeHierarchyNode employee={employee} role="EMPLOYEE" canCreate={false} canEdit={canEdit} onAddNode={onAddNode} onEditReporting={onEditReporting} key={employee.id} />)}</div>}
          </div>;
        })}</div>}
        {directEmployees.length > 0 && <div className="organization-employees">{directEmployees.map(employee => <EmployeeHierarchyNode employee={employee} role="EMPLOYEE" canCreate={false} canEdit={canEdit} onAddNode={onAddNode} onEditReporting={onEditReporting} key={employee.id} />)}</div>}
      </div>;
    })}</div> : <div className="organization-empty"><span>No manager nodes yet.</span>{canCreate && <button type="button" onClick={() => onAddNode("MANAGER")}><Plus size={16} /> Add manager</button>}</div>}
    {unassigned.length > 0 && <details className="organization-unassigned"><summary>{unassigned.length} unassigned hierarchy node{unassigned.length === 1 ? "" : "s"}</summary><p>Set Manager for line managers and Line Manager for employees to place them in the chart.</p><div>{unassigned.map(employee => <span key={employee.id}>{employee.fields["Full Name"] || employee.fields["Employee Code"]}</span>)}</div></details>}
  </div>;
}

function EmployeeHierarchyNode({ employee, role, canCreate, canEdit, onAddNode, onEditReporting }: { employee: EmployeeRecord; role: OrganizationalRole; canCreate: boolean; canEdit: boolean; onAddNode: (role: OrganizationalRole, parent?: EmployeeRecord) => void; onEditReporting: (employee: EmployeeRecord) => void }) {
  const nextRole = childRole[role];
  return <HierarchyRoleNode
    label={organizationalRoleLabel[role]}
    detail={employee.fields["Full Name"] || employee.fields["Employee Code"]}
    role={role}
    canCreate={canCreate && Boolean(nextRole)}
    onAdd={nextRole ? () => onAddNode(nextRole, employee) : undefined}
    canEdit={canEdit}
    onEdit={() => onEditReporting(employee)}
  />;
}

function HierarchyRoleNode({ label, detail, role, canCreate = false, onAdd, canEdit = false, onEdit }: { label: string; detail?: string; role?: OrganizationalRole; canCreate?: boolean; onAdd?: () => void; canEdit?: boolean; onEdit?: () => void }) {
  const nextRole = role && childRole[role];
  return <div className="organization-node">
    <div><strong>{label}</strong>{detail && <span>{detail}</span>}</div>
    {canEdit && onEdit && <button type="button" onClick={onEdit}>Edit reporting</button>}
    {canCreate && onAdd && nextRole && <button type="button" className="organization-node-add" aria-label={`Add ${organizationalRoleLabel[nextRole]} under ${detail || label}`} title={`Add ${organizationalRoleLabel[nextRole]}`} onClick={onAdd}><Plus size={16} /></button>}
  </div>;
}

function ReportingEditor({ employee, employees, onCancel, onSave }: { employee: EmployeeRecord; employees: EmployeeRecord[]; onCancel: () => void; onSave: (reporting: { lineManagerId: string | null; managerId: string | null }) => Promise<void> }) {
  const employeeByCode = new Map(employees.map(item => [item.fields["Employee Code"].trim().toLowerCase(), item]));
  const currentLineManagerId = employeeByCode.get(hierarchyLineManagerCode(employee))?.id || "";
  const currentManagerId = employeeByCode.get(hierarchyManagerCode(employee))?.id || "";
  const [lineManagerId, setLineManagerId] = useState(currentLineManagerId);
  const [managerId, setManagerId] = useState(currentManagerId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const options = employees.filter(item => item.id !== employee.id && (item.status === "Active" || item.status === "On Leave"));
  const save = async () => {
    setSaving(true); setError("");
    try { await onSave(hierarchyReportingPayload(lineManagerId, managerId)); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : "Reporting lines could not be updated."); }
    finally { setSaving(false); }
  };
  const label = (item: EmployeeRecord) => `${item.fields["Employee Code"]} - ${item.fields["Full Name"] || item.fields["First Name"]}`;
  return <div className="panel">
    <div className="panel-head"><div><h3>Edit reporting: {employee.fields["Full Name"] || employee.fields["Employee Code"]}</h3><span>Saved here and in Employees as the same employee record.</span></div></div>
    <div className="form-grid">
      <label>Line Manager<select value={lineManagerId} onChange={event => setLineManagerId(event.target.value)}><option value="">None</option>{options.map(item => <option value={item.id} key={item.id}>{label(item)}</option>)}</select></label>
      <label>Manager<select value={managerId} onChange={event => setManagerId(event.target.value)}><option value="">None</option>{options.map(item => <option value={item.id} key={item.id}>{label(item)}</option>)}</select></label>
    </div>
    <div className="form-actions"><button type="button" onClick={onCancel} disabled={saving}>Cancel</button><button type="button" className="primary" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save reporting"}</button></div>
    {error && <p className="sync-alert">{error}</p>}
  </div>;
}

export function RoleBranchFilter({ roles, selectedRoleId, onSelect, onEdit }: { roles: Role[]; selectedRoleId: string; onSelect: (roleId: string) => void; onEdit?: (role: Role) => void }) {
  const activeRoles = roles.filter(role => role.isActive);
  const roleByCode = new Map(activeRoles.map(role => [role.code, role]));
  const depth = (role: Role, path = new Set<string>()): number => {
    if (path.has(role.code)) return 0;
    const inherited = role.inherits.map(code => roleByCode.get(code)).filter((item): item is Role => Boolean(item));
    return inherited.length ? 1 + Math.max(...inherited.map(item => depth(item, new Set(path).add(role.code)))) : 0;
  };
  const builtIn = activeRoles.filter(role => role.isBuiltIn);
  const levels = [...new Set(builtIn.map(role => depth(role)))].sort((a, b) => b - a);
  const custom = activeRoles.filter(role => !role.isBuiltIn);

  return <div className="role-branch-filter" role="group" aria-label="Role hierarchy filter">
    <p>Higher branches inherit access from the roles below them. Selecting a role filters users by direct assignment.</p>
    <button type="button" className={`role-branch-node role-branch-root${selectedRoleId ? "" : " selected"}`} aria-pressed={!selectedRoleId} onClick={() => onSelect("")}><strong>All users</strong><span>Every role</span></button>
    <div className="role-branch-levels">
      {levels.map(level => <div className="role-branch-level" role="group" aria-label={`Role hierarchy level ${levels.length - level}`} key={level}>{builtIn.filter(role => depth(role) === level).map(role => <button type="button" className={`role-branch-node${selectedRoleId === role.id ? " selected" : ""}`} aria-label={`Filter users by ${role.displayName} role`} aria-pressed={selectedRoleId === role.id} key={role.id} onClick={() => onSelect(selectedRoleId === role.id ? "" : role.id)}><strong>{role.displayName}</strong><span>{role.code.replaceAll("_", " ")}</span></button>)}</div>)}
    </div>
    {custom.length > 0 && <div className="role-branch-custom" role="group" aria-label="Custom roles"><span>Custom roles</span>{custom.map(role => <div className="role-branch-custom-role" key={role.id}><button type="button" className={`role-branch-node${selectedRoleId === role.id ? " selected" : ""}`} aria-label={`Filter users by ${role.displayName} role`} aria-pressed={selectedRoleId === role.id} onClick={() => onSelect(selectedRoleId === role.id ? "" : role.id)}><strong>{role.displayName}</strong><span>{role.code.replaceAll("_", " ")}</span></button><span className="role-branch-inherits">Inherits: {role.inherits.map(code => roleByCode.get(code)?.displayName ?? code).join(", ") || "No built-in roles"}</span>{onEdit && <button type="button" onClick={() => onEdit(role)}>Edit hierarchy</button>}</div>)}</div>}
  </div>;
}
