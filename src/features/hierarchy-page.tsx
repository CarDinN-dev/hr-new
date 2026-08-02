import { useLayoutEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Pencil, Plus, Search, Users } from "lucide-react";
import { apiList, apiRequest, hasActiveSystemAdministratorRole, hasPermission, type BackendSession } from "../api";
import type { EmployeeRecord } from "../data";

type Permission = { id: string; code: string; displayName?: string; category: string; isProtected: boolean; isDeprecated: boolean };
type Role = { id: string; code: string; displayName: string; version: number; isBuiltIn: boolean; isActive: boolean; protection: "STANDARD" | "PROTECTED" | "SUPER_ADMIN"; inherits: string[]; permissions?: Array<{ permission: Permission }> };
type User = { id: string; email: string; isActive: boolean; localLoginEnabled: boolean; microsoftLoginEnabled: boolean; roles: Array<{ role: Role }> };
type InheritanceEditor = { role: Role; parentRoleIds: Set<string>; reason: string };
export type OrganizationalRole = "HR" | "MANAGER" | "LINE_MANAGER" | "EMPLOYEE";
type ReportingRelation = "LINE_MANAGER" | "MANAGER" | null;
type OrganizationHierarchyNode = { employee: EmployeeRecord; role: OrganizationalRole; roleLabel: string; parentRelation: ReportingRelation; children: OrganizationHierarchyNode[] };
type OrganizationHierarchyIssue = { employee: EmployeeRecord; message: string };
type RoleFlowGraph = { activeRoles: Role[]; roots: Role[]; childrenByCode: Map<string, Role[]> };
type RoleFlowEdge = { sourceCode: string; targetCode: string };
type RoleFlowConnector = RoleFlowEdge & { path: string };

const key = (session: BackendSession, value: string) => [value, session.sessionId, session.authorizationVersion] as const;
const organizationalRoleLabel: Record<OrganizationalRole, string> = { HR: "HR", MANAGER: "Manager", LINE_MANAGER: "Line manager", EMPLOYEE: "Employee" };
const childRole: Partial<Record<OrganizationalRole, OrganizationalRole>> = { HR: "MANAGER", MANAGER: "LINE_MANAGER", LINE_MANAGER: "EMPLOYEE" };
const roleFlowRootCode = "__all_users__";

export function hierarchyManagerCode(employee: EmployeeRecord) {
  return (employee.fields["Manager Employee Code/Name"] || "").split(" - ", 1)[0].trim().toLowerCase();
}

export function hierarchyLineManagerCode(employee: EmployeeRecord) {
  return (employee.fields["Line Manager Employee Code/Name"] || employee.fields["Reporting Manager Employee Code/Name"] || "").split(" - ", 1)[0].trim().toLowerCase();
}

export function hierarchyReportingPayload(lineManagerId: string, managerId: string) {
  return { lineManagerId: lineManagerId || null, managerId: managerId || null };
}

export function buildOrganizationHierarchy(employees: EmployeeRecord[]) {
  const active = employees.filter(employee => employee.status === "Active" || employee.status === "On Leave");
  const employeeByCode = new Map(active.map(employee => [employee.fields["Employee Code"].trim().toLowerCase(), employee] as const).filter(([code]) => Boolean(code)));
  const managerIds = new Set<string>();
  const lineManagerIds = new Set<string>();
  const parentById = new Map<string, string>();
  const parentRelationById = new Map<string, Exclude<ReportingRelation, null>>();
  const issues: OrganizationHierarchyIssue[] = [];

  for (const employee of active) {
    const managerCode = hierarchyManagerCode(employee);
    const lineManagerCode = hierarchyLineManagerCode(employee);
    const manager = employeeByCode.get(managerCode);
    const lineManager = employeeByCode.get(lineManagerCode);
    const validManager = manager?.id !== employee.id ? manager : undefined;
    const validLineManager = lineManager?.id !== employee.id ? lineManager : undefined;

    if (validManager) managerIds.add(validManager.id);
    else if (managerCode) issues.push({ employee, message: "Manager does not match another active employee." });
    if (validLineManager) lineManagerIds.add(validLineManager.id);
    else if (lineManagerCode) issues.push({ employee, message: "Line Manager does not match another active employee." });

    const parent = validLineManager ?? validManager;
    if (parent) {
      parentById.set(employee.id, parent.id);
      parentRelationById.set(employee.id, validLineManager ? "LINE_MANAGER" : "MANAGER");
    }
  }

  const processed = new Set<string>();
  for (const employee of active) {
    if (processed.has(employee.id)) continue;
    const path: string[] = [];
    const positions = new Map<string, number>();
    let currentId: string | undefined = employee.id;
    while (currentId && !processed.has(currentId)) {
      const cycleStart = positions.get(currentId);
      if (cycleStart !== undefined) {
        const breakId = path.slice(cycleStart).sort()[0];
        parentById.delete(breakId);
        parentRelationById.delete(breakId);
        issues.push({ employee: active.find(item => item.id === breakId)!, message: "Reporting cycle was broken here so every employee remains visible." });
        break;
      }
      positions.set(currentId, path.length);
      path.push(currentId);
      currentId = parentById.get(currentId);
    }
    path.forEach(id => processed.add(id));
  }

  const nodes = new Map<string, OrganizationHierarchyNode>(active.map(employee => {
    const isManager = managerIds.has(employee.id);
    const isLineManager = lineManagerIds.has(employee.id);
    const role: OrganizationalRole = isManager ? "MANAGER" : isLineManager ? "LINE_MANAGER" : "EMPLOYEE";
    const node: OrganizationHierarchyNode = {
      employee,
      role,
      roleLabel: ["COO", "CPO", "HR"].find(code => employee.roleCodes?.includes(code))
        ?? (isManager && isLineManager ? "Manager / Line manager" : organizationalRoleLabel[role]),
      parentRelation: parentRelationById.get(employee.id) ?? null,
      children: [],
    };
    return [employee.id, node];
  }));
  const roots: OrganizationHierarchyNode[] = [];
  for (const node of nodes.values()) {
    const parent = nodes.get(parentById.get(node.employee.id) || "");
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const roleOrder: Record<string, number> = { COO: 0, CPO: 1, HR: 2, "Manager / Line manager": 3, Manager: 4, "Line manager": 5, Employee: 6 };
  const sortNodes = (items: OrganizationHierarchyNode[]) => items.sort((left, right) =>
    roleOrder[left.roleLabel] - roleOrder[right.roleLabel]
    || (left.employee.fields["Full Name"] || left.employee.fields["Employee Code"]).localeCompare(right.employee.fields["Full Name"] || right.employee.fields["Employee Code"])
  ).forEach(node => sortNodes(node.children));
  sortNodes(roots);
  return { roots, issues };
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

export function buildRoleFlowGraph(roles: Role[]): RoleFlowGraph {
  const activeRoles = roles.filter(role => role.isActive);
  const roleByCode = new Map(activeRoles.map(role => [role.code, role]));
  const orderByCode = new Map(activeRoles.map((role, index) => [role.code, index]));
  const directCodes = new Map(activeRoles.map(role => [role.code, [...new Set(role.inherits)]
    .filter(code => code !== role.code && roleByCode.has(code))
    .sort((left, right) => (orderByCode.get(left) ?? 0) - (orderByCode.get(right) ?? 0))]));
  const reaches = (sourceCode: string, targetCode: string, visited = new Set<string>()): boolean => {
    if (sourceCode === targetCode) return true;
    if (visited.has(sourceCode)) return false;
    const nextVisited = new Set(visited).add(sourceCode);
    return (directCodes.get(sourceCode) ?? []).some(code => reaches(code, targetCode, nextVisited));
  };
  const childrenByCode = new Map(activeRoles.map(role => {
    const children = directCodes.get(role.code) ?? [];
    const reduced = children.filter(code => !children.some(other => other !== code && reaches(other, code)));
    return [role.code, reduced.map(code => roleByCode.get(code)!).filter(Boolean)] as const;
  }));
  const inheritedCodes = new Set([...childrenByCode.values()].flatMap(children => children.map(role => role.code)));
  const roots = activeRoles.filter(role => !inheritedCodes.has(role.code));
  return { activeRoles, roots: roots.length ? roots : activeRoles, childrenByCode };
}

export function buildVisibleRoleFlow(graph: RoleFlowGraph, rootExpanded: boolean, expandedRoleCodes: Set<string>) {
  const visibleCodes = new Set<string>();
  const edges: RoleFlowEdge[] = [];
  const queue: Role[] = [];
  if (rootExpanded) graph.roots.forEach(role => {
    visibleCodes.add(role.code);
    edges.push({ sourceCode: roleFlowRootCode, targetCode: role.code });
    queue.push(role);
  });
  const processed = new Set<string>();
  while (queue.length) {
    const role = queue.shift()!;
    if (processed.has(role.code)) continue;
    processed.add(role.code);
    if (!expandedRoleCodes.has(role.code)) continue;
    for (const child of graph.childrenByCode.get(role.code) ?? []) {
      edges.push({ sourceCode: role.code, targetCode: child.code });
      if (!visibleCodes.has(child.code)) {
        visibleCodes.add(child.code);
        queue.push(child);
      }
    }
  }

  const incoming = new Map<string, string[]>();
  edges.filter(edge => edge.sourceCode !== roleFlowRootCode).forEach(edge => incoming.set(edge.targetCode, [...(incoming.get(edge.targetCode) ?? []), edge.sourceCode]));
  const depthCache = new Map<string, number>();
  const depth = (code: string, path = new Set<string>()): number => {
    const cached = depthCache.get(code);
    if (cached !== undefined) return cached;
    if (path.has(code)) return 0;
    const parents = incoming.get(code) ?? [];
    const nextPath = new Set(path).add(code);
    const value = parents.length ? 1 + Math.max(...parents.map(parent => depth(parent, nextPath))) : 0;
    depthCache.set(code, value);
    return value;
  };
  const rolesByDepth = new Map<number, Role[]>();
  graph.activeRoles.filter(role => visibleCodes.has(role.code)).forEach(role => {
    const roleDepth = depth(role.code);
    rolesByDepth.set(roleDepth, [...(rolesByDepth.get(roleDepth) ?? []), role]);
  });
  const levels = [...rolesByDepth.entries()].sort(([left], [right]) => left - right).map(([, levelRoles]) => levelRoles);
  return { visibleCodes, edges, levels };
}

export function pruneExpandedRoleCodes(graph: RoleFlowGraph, rootExpanded: boolean, expandedRoleCodes: Set<string>) {
  const visibleCodes = buildVisibleRoleFlow(graph, rootExpanded, expandedRoleCodes).visibleCodes;
  return new Set([...expandedRoleCodes].filter(code => visibleCodes.has(code)));
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
      <div className="panel-head"><div><h3>Organizational hierarchy</h3><span>Follow the reporting chain from executives to each employee.</span></div></div>
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
  const hierarchy = buildOrganizationHierarchy(employees);
  const [search, setSearch] = useState("");
  const [collapsedIds, setCollapsedIds] = useState<Set<string> | null>(null);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const allNodes = flattenOrganizationHierarchy(hierarchy.roots);
  const branchIds = allNodes.filter(({ node }) => node.children.length).map(({ node }) => node.employee.id);
  const defaultCollapsed = new Set(allNodes.filter(({ node }) => node.children.length && !["COO", "CPO", "HR"].includes(node.roleLabel)).map(({ node }) => node.employee.id));
  const effectiveCollapsed = collapsedIds ?? defaultCollapsed;
  const matches = normalizedSearch ? allNodes.filter(({ node }) => organizationNodeMatches(node, normalizedSearch)).length : allNodes.length;
  const reportingLeads = allNodes.filter(({ node }) => node.children.length).length;
  const toggle = (employeeId: string) => setCollapsedIds(current => {
    const next = new Set(current ?? defaultCollapsed);
    if (next.has(employeeId)) next.delete(employeeId);
    else next.add(employeeId);
    return next;
  });

  return <div className="organization-chart" aria-label="Organizational hierarchy">
    <HierarchyWorkflowGuide employees={employees} />
    <div className="organization-overview" aria-label="Hierarchy summary">
      <span><strong>{allNodes.length}</strong> active employees</span>
      <span><strong>{reportingLeads}</strong> reporting leads</span>
      <span><strong>{hierarchy.roots.length}</strong> top-level roots</span>
      <span className={hierarchy.issues.length ? "has-issues" : ""}><strong>{hierarchy.issues.length}</strong> unresolved</span>
    </div>
    <div className="organization-toolbar">
      <label className="organization-search"><span className="sr-only">Find an employee</span><Search size={17} aria-hidden="true" /><input type="search" value={search} placeholder="Find an employee or code" onChange={event => setSearch(event.target.value)} /></label>
      <span className="organization-match-count" aria-live="polite">{normalizedSearch ? `${matches} match${matches === 1 ? "" : "es"}` : `${allNodes.length} employees`}</span>
      <div className="organization-tree-actions">
        <button type="button" onClick={() => setCollapsedIds(new Set())}>Expand all</button>
        <button type="button" onClick={() => setCollapsedIds(new Set(branchIds))}>Collapse all</button>
      </div>
    </div>
    {hierarchy.roots.length ? <div className="organization-tree">{hierarchy.roots.map(node =>
      <OrganizationBranch node={node} query={normalizedSearch} collapsedIds={effectiveCollapsed} canCreate={canCreate} canEdit={canEdit} onToggle={toggle} onAddNode={onAddNode} onEditReporting={onEditReporting} key={node.employee.id} />
    )}{normalizedSearch && matches === 0 && <div className="organization-empty"><Search size={20} /><span>No employees match “{search.trim()}”.</span></div>}</div> : <div className="organization-empty"><span>No active employees yet.</span>{canCreate && <button type="button" onClick={() => onAddNode("MANAGER")}><Plus size={16} /> Add employee</button>}</div>}
    {hierarchy.issues.length > 0 && <details className="organization-unresolved"><summary>{hierarchy.issues.length} unresolved reporting relationship{hierarchy.issues.length === 1 ? "" : "s"}</summary><p>Employees remain visible, using the next valid reporting relationship where possible.</p><div>{hierarchy.issues.map((issue, index) => <span key={`${issue.employee.id}-${index}`}><strong>{issue.employee.fields["Full Name"] || issue.employee.fields["Employee Code"]}:</strong> {issue.message}</span>)}</div></details>}
  </div>;
}

function OrganizationBranch({ node, query, collapsedIds, canCreate, canEdit, onToggle, onAddNode, onEditReporting }: { node: OrganizationHierarchyNode; query: string; collapsedIds: Set<string>; canCreate: boolean; canEdit: boolean; onToggle: (employeeId: string) => void; onAddNode: (role: OrganizationalRole, parent?: EmployeeRecord) => void; onEditReporting: (employee: EmployeeRecord) => void }) {
  if (query && !organizationBranchMatches(node, query)) return null;
  const visibleChildren = query ? node.children.filter(child => organizationBranchMatches(child, query)) : node.children;
  const expanded = Boolean(visibleChildren.length) && (Boolean(query) || !collapsedIds.has(node.employee.id));

  return <div className="organization-branch">
    <EmployeeHierarchyNode node={node} expanded={expanded} canCreate={canCreate} canEdit={canEdit} onToggle={onToggle} onAddNode={onAddNode} onEditReporting={onEditReporting} />
    {expanded && <div className="organization-children">{visibleChildren.map(child =>
      <OrganizationBranch node={child} query={query} collapsedIds={collapsedIds} canCreate={canCreate} canEdit={canEdit} onToggle={onToggle} onAddNode={onAddNode} onEditReporting={onEditReporting} key={child.employee.id} />
    )}</div>}
  </div>;
}

function EmployeeHierarchyNode({ node, expanded, canCreate, canEdit, onToggle, onAddNode, onEditReporting }: { node: OrganizationHierarchyNode; expanded: boolean; canCreate: boolean; canEdit: boolean; onToggle: (employeeId: string) => void; onAddNode: (role: OrganizationalRole, parent?: EmployeeRecord) => void; onEditReporting: (employee: EmployeeRecord) => void }) {
  const nextRole = childRole[node.role];
  const employeeCode = node.employee.fields["Employee Code"];
  const fullName = node.employee.fields["Full Name"] || employeeCode;
  const initials = fullName.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
  const relationship = node.parentRelation === "LINE_MANAGER" ? "Reports through Line Manager" : node.parentRelation === "MANAGER" ? "Manager fallback" : "Top-level employee";

  return <div className={`organization-node organization-node-${node.roleLabel.toLocaleLowerCase().replaceAll(/[^a-z]+/g, "-")}`}>
    {node.children.length ? <button type="button" className="organization-node-toggle" aria-label={`${expanded ? "Collapse" : "Expand"} ${fullName}'s reports`} aria-expanded={expanded} onClick={() => onToggle(node.employee.id)}>{expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</button> : <span className="organization-node-toggle-spacer" />}
    <span className="organization-node-avatar" aria-hidden="true">{initials}</span>
    <div className="organization-node-copy">
      <div className="organization-node-heading"><strong>{fullName}</strong><span className="organization-role-badge">{node.roleLabel}</span></div>
      <span className="organization-node-meta">{employeeCode} · {relationship}</span>
    </div>
    {node.children.length > 0 && <span className="organization-report-count"><Users size={15} aria-hidden="true" /> {node.children.length} direct report{node.children.length === 1 ? "" : "s"}</span>}
    <div className="organization-node-actions">
      {canEdit && <button type="button" aria-label={`Edit reporting for ${fullName}`} title="Edit reporting" onClick={() => onEditReporting(node.employee)}><Pencil size={16} aria-hidden="true" /><span>Edit</span></button>}
      {canCreate && nextRole && <button type="button" className="organization-node-add" aria-label={`Add ${organizationalRoleLabel[nextRole]} under ${fullName}`} title={`Add ${organizationalRoleLabel[nextRole]}`} onClick={() => onAddNode(nextRole, node.employee)}><Plus size={16} aria-hidden="true" /><span>Add</span></button>}
    </div>
  </div>;
}

function HierarchyWorkflowGuide({ employees }: { employees: EmployeeRecord[] }) {
  const roleHolder = (role: string) => employees.find(employee => employee.roleCodes?.includes(role) && (employee.status === "Active" || employee.status === "On Leave"));
  const stages = [
    { role: "COO", employee: roleHolder("COO") },
    { role: "CPO", employee: roleHolder("CPO") },
    { role: "HR", employee: roleHolder("HR") },
    { role: "Manager" },
    { role: "Line Manager" },
    { role: "Employee" },
  ];
  return <div className="hierarchy-workflow-guide">
    <div className="hierarchy-workflow-heading"><div><span>CHAIN OF RESPONSIBILITY</span><strong>Reporting flows down. Approvals flow up.</strong></div><p>Employee placement below follows the saved Line Manager first, then Manager fallback.</p></div>
    <div className="hierarchy-role-flow" aria-label="Reporting hierarchy from COO to Employee">{stages.map((stage, index) => <div className="hierarchy-role-stage" key={stage.role}>
      <span>{stage.role}</span>
      <strong>{stage.employee ? stage.employee.fields["Full Name"] || stage.employee.fields["Employee Code"] : stage.role}</strong>
      {index < stages.length - 1 && <i aria-hidden="true">→</i>}
    </div>)}</div>
    <div className="hierarchy-approval-routes">
      <span><strong>Standard leave</strong> Line Manager → Manager → HR → CPO → COO</span>
      <span><strong>Reports to COO or CPO</strong> HR → CPO → COO</span>
      <span><strong>Executive leave</strong> HR → CPO → COO · CPO → COO · COO self-approval</span>
    </div>
  </div>;
}

function flattenOrganizationHierarchy(roots: OrganizationHierarchyNode[]) {
  const flattened: Array<{ node: OrganizationHierarchyNode; depth: number }> = [];
  const visit = (node: OrganizationHierarchyNode, depth: number) => {
    flattened.push({ node, depth });
    node.children.forEach(child => visit(child, depth + 1));
  };
  roots.forEach(root => visit(root, 0));
  return flattened;
}

function organizationNodeMatches(node: OrganizationHierarchyNode, query: string) {
  return [node.employee.fields["Employee Code"], node.employee.fields["Full Name"], node.roleLabel].some(value => value?.toLocaleLowerCase().includes(query));
}

function organizationBranchMatches(node: OrganizationHierarchyNode, query: string): boolean {
  return organizationNodeMatches(node, query) || node.children.some(child => organizationBranchMatches(child, query));
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
  const graph = buildRoleFlowGraph(roles);
  const [rootExpanded, setRootExpanded] = useState(false);
  const [expandedRoleCodes, setExpandedRoleCodes] = useState<Set<string>>(new Set());
  const [focusCode, setFocusCode] = useState(roleFlowRootCode);
  const [connectors, setConnectors] = useState<RoleFlowConnector[]>([]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLButtonElement>());
  const flow = buildVisibleRoleFlow(graph, rootExpanded, expandedRoleCodes);
  const signature = `${flow.levels.flat().map(role => role.code).join("|")}:${flow.edges.map(edge => `${edge.sourceCode}>${edge.targetCode}`).join("|")}`;
  const widestLevel = Math.max(1, ...flow.levels.map(level => level.length));

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    if (!viewport || !canvas) return;
    let frame = 0;
    let focusFrame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const canvasRect = canvas.getBoundingClientRect();
        setConnectors(flow.edges.flatMap(edge => {
          const source = nodeRefs.current.get(edge.sourceCode);
          const target = nodeRefs.current.get(edge.targetCode);
          if (!source || !target) return [];
          const sourceRect = source.getBoundingClientRect();
          const targetRect = target.getBoundingClientRect();
          const sourceX = sourceRect.left + sourceRect.width / 2 - canvasRect.left;
          const sourceY = sourceRect.bottom - canvasRect.top;
          const targetX = targetRect.left + targetRect.width / 2 - canvasRect.left;
          const targetY = targetRect.top - canvasRect.top;
          const controlY = sourceY + Math.max(24, (targetY - sourceY) / 2);
          return [{ ...edge, path: `M ${sourceX} ${sourceY} C ${sourceX} ${controlY}, ${targetX} ${controlY}, ${targetX} ${targetY}` }];
        }));
      });
    };
    const centerFocused = () => {
      cancelAnimationFrame(focusFrame);
      focusFrame = requestAnimationFrame(() => {
        const focused = nodeRefs.current.get(focusCode);
        if (!focused) return;
        const viewportRect = viewport.getBoundingClientRect();
        const focusedRect = focused.getBoundingClientRect();
        const left = viewport.scrollLeft + focusedRect.left + focusedRect.width / 2 - viewportRect.left - viewport.clientWidth / 2;
        viewport.scrollTo({ left: Math.max(0, left), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      });
    };
    const refresh = () => { measure(); centerFocused(); };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(refresh);
    observer?.observe(viewport);
    observer?.observe(canvas);
    nodeRefs.current.forEach(node => observer?.observe(node));
    window.addEventListener("resize", refresh);
    measure();
    centerFocused();
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(focusFrame);
      observer?.disconnect();
      window.removeEventListener("resize", refresh);
    };
  }, [signature, focusCode]);

  const setNodeRef = (code: string) => (node: HTMLButtonElement | null) => {
    if (node) nodeRefs.current.set(code, node);
    else nodeRefs.current.delete(code);
  };
  const toggleRoot = () => {
    const nextExpanded = !rootExpanded;
    setRootExpanded(nextExpanded);
    setFocusCode(roleFlowRootCode);
    onSelect("");
    if (!nextExpanded) setExpandedRoleCodes(new Set());
  };
  const toggleRole = (role: Role) => {
    onSelect(selectedRoleId === role.id ? "" : role.id);
    setFocusCode(role.code);
    if (!(graph.childrenByCode.get(role.code)?.length)) return;
    setExpandedRoleCodes(current => {
      const next = new Set(current);
      if (next.has(role.code)) {
        next.delete(role.code);
        return pruneExpandedRoleCodes(graph, true, next);
      }
      next.add(role.code);
      return next;
    });
  };

  return <div className="role-branch-filter" role="group" aria-label="Role hierarchy filter">
    <p>Select a card to filter users and reveal the roles it inherits. Redundant links are combined for clarity.</p>
    <div className="role-flowchart-viewport" ref={viewportRef}>
      <div className="role-flowchart-canvas" id="role-hierarchy-flowchart" ref={canvasRef} style={{ minWidth: `${Math.max(320, widestLevel * 176)}px` }}>
        <svg className="role-flowchart-connectors" aria-hidden="true">
          <defs><marker id="role-flowchart-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z" /></marker></defs>
          {connectors.map(connector => <path className="role-flowchart-line" d={connector.path} markerEnd="url(#role-flowchart-arrow)" key={`${connector.sourceCode}-${connector.targetCode}`} />)}
        </svg>
        <div className="role-flowchart-level role-flowchart-root-level">
          <div className="role-flowchart-node-shell role-branch-root-shell">
            <button ref={setNodeRef(roleFlowRootCode)} type="button" className={`role-branch-node role-branch-root${selectedRoleId ? "" : " selected"}${rootExpanded ? " expanded" : ""}`} aria-label="All users" aria-pressed={!selectedRoleId} aria-expanded={graph.activeRoles.length ? rootExpanded : undefined} onClick={toggleRoot}>
              <span className="role-branch-node-copy"><strong>All users</strong><span>Every role</span></span>
              {graph.activeRoles.length > 0 && <span className="role-branch-disclosure" aria-hidden="true">{rootExpanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />}</span>}
            </button>
          </div>
        </div>
        {flow.levels.map((level, index) => <div className="role-flowchart-level" role="group" aria-label={`Role hierarchy level ${index + 1}`} key={level.map(role => role.code).join("-")}>
          {level.map(role => {
            const children = graph.childrenByCode.get(role.code) ?? [];
            const expanded = expandedRoleCodes.has(role.code);
            return <div className="role-flowchart-node-shell" key={role.id}>
              <button ref={setNodeRef(role.code)} type="button" className={`role-branch-node${role.isBuiltIn ? "" : " role-branch-node-custom"}${selectedRoleId === role.id ? " selected" : ""}${expanded ? " expanded" : ""}`} aria-label={`Filter users by ${role.displayName} role`} aria-pressed={selectedRoleId === role.id} aria-expanded={children.length ? expanded : undefined} onClick={() => toggleRole(role)}>
                <span className="role-branch-node-copy"><strong>{role.displayName}</strong><span>{role.code.replaceAll("_", " ")}</span></span>
                {children.length > 0 && <span className="role-branch-disclosure" aria-hidden="true">{expanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />}</span>}
              </button>
              {!role.isBuiltIn && onEdit && <button type="button" className="role-branch-edit" onClick={() => onEdit(role)}><Pencil size={14} aria-hidden="true" /> Edit hierarchy</button>}
            </div>;
          })}
        </div>)}
        {rootExpanded && graph.activeRoles.length === 0 && <p className="role-flowchart-empty">No active roles are available.</p>}
      </div>
    </div>
  </div>;
}
