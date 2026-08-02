import { useLayoutEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, ChevronDown, ChevronRight, Pencil, Plus, Search, Users } from "lucide-react";
import { apiList, apiRequest, hasActiveSystemAdministratorRole, hasPermission, type BackendSession } from "../api";
import type { EmployeeRecord } from "../data";

type Permission = { id: string; code: string; displayName?: string; category: string; isProtected: boolean; isDeprecated: boolean };
type Role = { id: string; code: string; displayName: string; version: number; isBuiltIn: boolean; isActive: boolean; protection: "STANDARD" | "PROTECTED" | "SUPER_ADMIN"; inherits: string[]; permissions?: Array<{ permission: Permission }> };
type User = { id: string; email: string; isActive: boolean; localLoginEnabled: boolean; microsoftLoginEnabled: boolean; roles: Array<{ role: Role }> };
type InheritanceEditor = { role: Role; parentRoleIds: Set<string>; reason: string };
type ReportingRelation = "LINE_MANAGER" | "MANAGER" | "BOTH";
type OrganizationHierarchyIssue = { employee: EmployeeRecord; message: string };
type OrganizationHierarchyGraph = {
  activeEmployees: EmployeeRecord[];
  employeeById: Map<string, EmployeeRecord>;
  roots: EmployeeRecord[];
  unassignedRoots: EmployeeRecord[];
  unassignedRootIds: Set<string>;
  childrenByParentId: Map<string, EmployeeRecord[]>;
  primaryParentById: Map<string, string>;
  primaryRelationById: Map<string, ReportingRelation>;
  secondaryManagerEdges: EmployeeFlowEdge[];
  managerIds: Set<string>;
  lineManagerIds: Set<string>;
  issues: OrganizationHierarchyIssue[];
};
type EmployeeFlowNode = { id: string; employee?: EmployeeRecord; kind: "EMPLOYEE" | "UNASSIGNED" };
type EmployeeFlowEdge = { sourceId: string; targetId: string; relation: ReportingRelation | "UNASSIGNED"; secondary?: boolean };
type EmployeeFlowConnector = EmployeeFlowEdge & { path: string };
type RoleFlowGraph = { activeRoles: Role[]; roots: Role[]; childrenByCode: Map<string, Role[]> };
type RoleFlowEdge = { sourceCode: string; targetCode: string };
type RoleFlowConnector = RoleFlowEdge & { path: string };
type RoleAssignee = { id: string; name: string; department: string };

const key = (session: BackendSession, value: string) => [value, session.sessionId, session.authorizationVersion] as const;
const roleFlowRootCode = "__all_users__";
export const unassignedReportingRootId = "__unassigned_reporting__";

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
  const activeEmployees = employees.filter(employee => employee.status === "Active" || employee.status === "On Leave");
  const employeeById = new Map(activeEmployees.map(employee => [employee.id, employee]));
  const employeeByCode = new Map(activeEmployees.map(employee => [employee.fields["Employee Code"]?.trim().toLowerCase(), employee] as const).filter(([code]) => Boolean(code)));
  const managerIds = new Set<string>();
  const lineManagerIds = new Set<string>();
  const primaryParentById = new Map<string, string>();
  const primaryRelationById = new Map<string, ReportingRelation>();
  const secondaryManagerEdges: EmployeeFlowEdge[] = [];
  const issues: OrganizationHierarchyIssue[] = [];

  const resolveRelation = (employee: EmployeeRecord, relation: "managerId" | "lineManagerId") => {
    const explicitId = employee[relation];
    if (explicitId !== undefined) {
      if (!explicitId) return { configured: false, employee: undefined };
      const related = employeeById.get(explicitId);
      return { configured: true, employee: related?.id === employee.id ? undefined : related };
    }
    const code = relation === "managerId" ? hierarchyManagerCode(employee) : hierarchyLineManagerCode(employee);
    const related = code ? employeeByCode.get(code) : undefined;
    return { configured: Boolean(code), employee: related?.id === employee.id ? undefined : related };
  };

  for (const employee of activeEmployees) {
    const managerRelation = resolveRelation(employee, "managerId");
    const lineManagerRelation = resolveRelation(employee, "lineManagerId");
    const manager = managerRelation.employee;
    const lineManager = lineManagerRelation.employee;

    if (manager) managerIds.add(manager.id);
    else if (managerRelation.configured) issues.push({ employee, message: "Manager is not an active employee in this hierarchy." });
    if (lineManager) lineManagerIds.add(lineManager.id);
    else if (lineManagerRelation.configured) issues.push({ employee, message: "Line Manager is not an active employee in this hierarchy." });

    const parent = lineManager ?? manager;
    if (parent) {
      primaryParentById.set(employee.id, parent.id);
      primaryRelationById.set(employee.id, lineManager && manager?.id === lineManager.id ? "BOTH" : lineManager ? "LINE_MANAGER" : "MANAGER");
    }
    if (lineManager && manager && lineManager.id !== manager.id) secondaryManagerEdges.push({ sourceId: manager.id, targetId: employee.id, relation: "MANAGER", secondary: true });
  }

  const processed = new Set<string>();
  for (const employee of activeEmployees) {
    if (processed.has(employee.id)) continue;
    const path: string[] = [];
    const positions = new Map<string, number>();
    let currentId: string | undefined = employee.id;
    while (currentId && !processed.has(currentId)) {
      const cycleStart = positions.get(currentId);
      if (cycleStart !== undefined) {
        const breakId = path.slice(cycleStart).sort()[0];
        primaryParentById.delete(breakId);
        primaryRelationById.delete(breakId);
        issues.push({ employee: employeeById.get(breakId)!, message: "Reporting cycle was broken here so every employee remains visible." });
        break;
      }
      positions.set(currentId, path.length);
      path.push(currentId);
      currentId = primaryParentById.get(currentId);
    }
    path.forEach(id => processed.add(id));
  }

  const compareEmployees = (left: EmployeeRecord, right: EmployeeRecord) =>
    (left.fields.Department || "").localeCompare(right.fields.Department || "")
    || (left.fields.Designation || "").localeCompare(right.fields.Designation || "")
    || (left.fields["Full Name"] || left.fields["Employee Code"] || "").localeCompare(right.fields["Full Name"] || right.fields["Employee Code"] || "")
    || left.id.localeCompare(right.id);
  const childrenByParentId = new Map(activeEmployees.map(employee => [employee.id, [] as EmployeeRecord[]]));
  activeEmployees.forEach(employee => {
    const parentId = primaryParentById.get(employee.id);
    if (parentId) childrenByParentId.get(parentId)?.push(employee);
  });
  childrenByParentId.forEach(children => children.sort(compareEmployees));

  const parentless = activeEmployees.filter(employee => !primaryParentById.has(employee.id));
  const roots = parentless.filter(employee => (childrenByParentId.get(employee.id)?.length ?? 0) > 0).sort(compareEmployees);
  const rootIds = new Set(roots.map(employee => employee.id));
  const unassignedRoots = parentless.filter(employee => !rootIds.has(employee.id)).sort(compareEmployees);
  return {
    activeEmployees: [...activeEmployees].sort(compareEmployees), employeeById, roots, unassignedRoots,
    unassignedRootIds: new Set(unassignedRoots.map(employee => employee.id)), childrenByParentId,
    primaryParentById, primaryRelationById, secondaryManagerEdges, managerIds, lineManagerIds, issues,
  } satisfies OrganizationHierarchyGraph;
}

export function employeeHierarchySearchPath(graph: OrganizationHierarchyGraph, search: string) {
  const query = search.trim().toLocaleLowerCase();
  const matchedIds = new Set(graph.activeEmployees.filter(employee => [
    employee.fields["Employee Code"], employee.fields["Full Name"], employee.fields.Designation, employee.fields.Department,
  ].some(value => value?.toLocaleLowerCase().includes(query))).map(employee => employee.id));
  const visibleIds = new Set<string>();
  matchedIds.forEach(id => {
    let currentId: string | undefined = id;
    let rootId = id;
    while (currentId && !visibleIds.has(currentId)) {
      visibleIds.add(currentId);
      rootId = currentId;
      currentId = graph.primaryParentById.get(currentId);
    }
    if (graph.unassignedRootIds.has(rootId)) visibleIds.add(unassignedReportingRootId);
  });
  return { matchedIds, visibleIds };
}

export function buildVisibleEmployeeFlow(graph: OrganizationHierarchyGraph, expandedIds: Set<string>, allowedIds?: Set<string>) {
  const visibleIds = new Set<string>();
  const edges: EmployeeFlowEdge[] = [];
  const levels: EmployeeFlowNode[][] = [];
  const queue: Array<{ id: string; depth: number; kind: EmployeeFlowNode["kind"] }> = [];
  const enqueue = (id: string, depth: number, kind: EmployeeFlowNode["kind"]) => {
    if (visibleIds.has(id) || (allowedIds && !allowedIds.has(id))) return;
    visibleIds.add(id);
    (levels[depth] ??= []).push({ id, employee: kind === "EMPLOYEE" ? graph.employeeById.get(id) : undefined, kind });
    queue.push({ id, depth, kind });
  };
  graph.roots.forEach(employee => enqueue(employee.id, 0, "EMPLOYEE"));
  if (graph.unassignedRoots.length) enqueue(unassignedReportingRootId, 0, "UNASSIGNED");

  while (queue.length) {
    const current = queue.shift()!;
    if (!expandedIds.has(current.id)) continue;
    const children = current.kind === "UNASSIGNED" ? graph.unassignedRoots : graph.childrenByParentId.get(current.id) ?? [];
    children.forEach(employee => {
      if (allowedIds && !allowedIds.has(employee.id)) return;
      edges.push({
        sourceId: current.id,
        targetId: employee.id,
        relation: current.kind === "UNASSIGNED" ? "UNASSIGNED" : graph.primaryRelationById.get(employee.id) ?? "MANAGER",
      });
      enqueue(employee.id, current.depth + 1, "EMPLOYEE");
    });
  }
  return { visibleIds, edges, levels: levels.filter(Boolean) };
}

export function pruneExpandedEmployeeIds(graph: OrganizationHierarchyGraph, expandedIds: Set<string>) {
  const visibleIds = buildVisibleEmployeeFlow(graph, expandedIds).visibleIds;
  return new Set([...expandedIds].filter(id => visibleIds.has(id)));
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

export function buildRoleAssigneeMap(roles: Role[], employees: EmployeeRecord[]) {
  const assigneesByCode = new Map<string, RoleAssignee[]>(roles.filter(role => role.isActive).map(role => [role.code, []]));
  employees.filter(employee => employee.status === "Active" || employee.status === "On Leave").forEach(employee => {
    const name = employee.fields["Full Name"]?.trim() || employee.fields["Employee Code"]?.trim() || "Unnamed employee";
    const department = employee.fields.Department?.trim() || "Department not assigned";
    new Set(employee.roleCodes ?? []).forEach(code => assigneesByCode.get(code)?.push({ id: employee.id, name, department }));
  });
  assigneesByCode.forEach(assignees => assignees.sort((left, right) =>
    left.department.localeCompare(right.department) || left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
  ));
  return assigneesByCode;
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

export function HierarchyPage({ session, notify, employees, onAddNode, onUpdateReporting }: { session: BackendSession; notify: (message: string) => void; employees: EmployeeRecord[]; onAddNode: (parent?: EmployeeRecord) => void; onUpdateReporting: (employeeId: string, reporting: { lineManagerId: string | null; managerId: string | null }) => Promise<void> }) {
  const client = useQueryClient();
  const [activeTab, setActiveTab] = useState<"employees" | "access">("employees");
  const [search, setSearch] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [editor, setEditor] = useState<InheritanceEditor | null>(null);
  const [reportingEmployee, setReportingEmployee] = useState<EmployeeRecord | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const params = hierarchyUserParams(search, selectedRoleId);
  const canManageHierarchy = hasActiveSystemAdministratorRole(session);
  const roles = useQuery({ queryKey: key(session, "hierarchy-roles"), queryFn: () => apiList<Role>("/system/roles"), enabled: canManageHierarchy && activeTab === "access" });
  const users = useQuery({ queryKey: [...key(session, "hierarchy-users"), params.toString()], queryFn: () => apiList<User>(`/system/users?${params}`), enabled: canManageHierarchy && activeTab === "access" });
  const selectedRole = roles.data?.find(role => role.id === selectedRoleId);
  const replaceInheritance = useMutation({
    mutationFn: (next: InheritanceEditor) => apiRequest(`/system/roles/${next.role.id}/inheritance`, { method: "PUT", csrfToken: session.csrfToken, body: JSON.stringify(hierarchyInheritancePayload(next)) }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: key(session, "hierarchy-roles") }); setEditor(null); notify("Role inheritance updated. Affected sessions were revoked."); },
  });
  const activeBuiltIns = (roles.data ?? []).filter(role => role.isBuiltIn && role.isActive);

  const tabs = [{ id: "employees" as const, label: "Employee role hierarchy" }, { id: "access" as const, label: "Access role inheritance" }];
  const moveTabFocus = (index: number) => { setActiveTab(tabs[index].id); tabRefs.current[index]?.focus(); };
  const userCount = users.data?.length ?? 0;

  return <section className="stack">
    <div className="hierarchy-tabs" role="tablist" aria-label="Hierarchy views">{tabs.map((tab, index) => <button ref={node => { tabRefs.current[index] = node; }} id={"hierarchy-" + tab.id + "-tab"} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls={"hierarchy-" + tab.id + "-panel"} tabIndex={activeTab === tab.id ? 0 : -1} onClick={() => setActiveTab(tab.id)} onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "Home") moveTabFocus(0);
      else if (event.key === "End") moveTabFocus(tabs.length - 1);
      else moveTabFocus((index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length);
    }} key={tab.id}>{tab.label}</button>)}</div>

    <div id="hierarchy-employees-panel" role="tabpanel" aria-labelledby="hierarchy-employees-tab" hidden={activeTab !== "employees"}>
      <div className="stack">
        <div className="panel">
          <div className="panel-head"><div><h3>Employee role hierarchy</h3><span>Follow the saved reporting chain from each lead to their direct reports.</span></div></div>
          <EmployeeHierarchyFlowchart employees={employees} canCreate={hasPermission(session, "employee.hr.create")} canEdit={hasPermission(session, "employee.hr.update")} onAddNode={onAddNode} onEditReporting={setReportingEmployee} />
          <p className="muted hierarchy-access-note">Role means job designation here. Login access is managed separately under Access role inheritance.</p>
        </div>
        {reportingEmployee && <ReportingEditor employee={reportingEmployee} employees={employees} onCancel={() => setReportingEmployee(null)} onSave={async reporting => { await onUpdateReporting(reportingEmployee.id, reporting); setReportingEmployee(null); }} />}
      </div>
    </div>

    <div id="hierarchy-access-panel" role="tabpanel" aria-labelledby="hierarchy-access-tab" hidden={activeTab !== "access"}>
      {!canManageHierarchy ? <div className="panel"><p className="muted">System Administrator access is required to view access-role inheritance.</p></div> : <div className="stack">
        <div className="panel">
          <div className="panel-head"><div><h3>Access role inheritance</h3><span>Explore inherited permissions and find the users directly assigned to each role.</span></div></div>
          {roles.isPending ? <p className="muted">Loading role hierarchy…</p> : roles.isError ? <p className="sync-alert">{roles.error.message}</p> : <RoleBranchFilter roles={roles.data ?? []} employees={employees} selectedRoleId={selectedRoleId} onSelect={setSelectedRoleId} onEdit={role => setEditor({ role, parentRoleIds: new Set(role.inherits.map(code => roles.data?.find(item => item.code === code)?.id).filter((id): id is string => Boolean(id))), reason: "" })} />}
        </div>
        {editor && <div className="panel">
          <div className="panel-head"><div><h3>Edit {editor.role.displayName} hierarchy</h3><span>Choose the built-in roles whose permissions this custom role inherits.</span></div></div>
          <fieldset><legend>Inherited built-in roles</legend><div className="checkbox-grid">{activeBuiltIns.map(role => <label key={role.id}><input type="checkbox" checked={editor.parentRoleIds.has(role.id)} onChange={event => setEditor(currentEditor => { if (!currentEditor) return currentEditor; const parentRoleIds = new Set(currentEditor.parentRoleIds); if (event.target.checked) parentRoleIds.add(role.id); else parentRoleIds.delete(role.id); return { ...currentEditor, parentRoleIds }; })} /> {role.displayName}</label>)}</div></fieldset>
          <label>Reason<textarea value={editor.reason} onChange={event => setEditor(currentEditor => currentEditor ? { ...currentEditor, reason: event.target.value } : currentEditor)} /></label>
          <div className="form-actions"><button type="button" onClick={() => setEditor(null)}>Cancel</button><button className="primary" disabled={editor.reason.trim().length < 3 || replaceInheritance.isPending} onClick={() => replaceInheritance.mutate(editor)}>Save hierarchy</button></div>
          {replaceInheritance.isError && <p className="sync-alert">{replaceInheritance.error.message}</p>}
        </div>}
        <div className="panel">
          <div className="panel-head"><div><h3>Users in this hierarchy</h3><span>Search by name or email, then narrow the results by direct role assignment.</span></div></div>
          <div className="system-user-filters"><label>Find users<input type="search" value={search} placeholder="Name or email" onChange={event => setSearch(event.target.value)} /></label>{(search || selectedRoleId) && <button type="button" onClick={() => { setSearch(""); setSelectedRoleId(""); }}>Clear filters</button>}</div>
          <p className="muted system-user-filter-summary" aria-live="polite">{users.isPending ? "Finding users…" : userCount + " user" + (userCount === 1 ? "" : "s") + " found" + (selectedRole ? " with " + selectedRole.displayName : "") + "."}</p>
          {users.isError ? <p className="sync-alert">{users.error.message}</p> : <div className="table-wrap"><table><thead><tr><th>User</th><th>Roles</th><th>Status</th></tr></thead><tbody>{users.data?.map(user => <tr key={user.id}><td>{user.email}</td><td>{user.roles.map(item => item.role.displayName).join(", ") || "No role"}</td><td>{user.isActive ? "Active" : "Disabled"}</td></tr>)}{!users.isPending && !users.data?.length && <tr><td colSpan={3} className="system-user-empty">No users match these filters.</td></tr>}</tbody></table></div>}
        </div>
      </div>}
    </div>
  </section>;
}

function EmployeeHierarchyFlowchart({ employees, canCreate, canEdit, onAddNode, onEditReporting }: { employees: EmployeeRecord[]; canCreate: boolean; canEdit: boolean; onAddNode: (parent?: EmployeeRecord) => void; onEditReporting: (employee: EmployeeRecord) => void }) {
  const graph = buildOrganizationHierarchy(employees);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [showManagerLinks, setShowManagerLinks] = useState(false);
  const [focusId, setFocusId] = useState(graph.roots[0]?.id ?? (graph.unassignedRoots.length ? unassignedReportingRootId : ""));
  const [connectors, setConnectors] = useState<EmployeeFlowConnector[]>([]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLButtonElement>());
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const searchResult = normalizedSearch ? employeeHierarchySearchPath(graph, normalizedSearch) : null;
  const displayedExpandedIds = searchResult ? new Set([...expandedIds, ...searchResult.visibleIds]) : expandedIds;
  const flow = buildVisibleEmployeeFlow(graph, displayedExpandedIds, searchResult?.visibleIds);
  const edges = [...flow.edges, ...(showManagerLinks ? graph.secondaryManagerEdges.filter(edge => flow.visibleIds.has(edge.sourceId) && flow.visibleIds.has(edge.targetId)) : [])];
  const focusTargetId = searchResult ? [...searchResult.matchedIds][0] ?? focusId : focusId;
  const signature = flow.levels.flat().map(node => node.id).join("|") + ":" + edges.map(edge => edge.sourceId + ">" + edge.targetId + ":" + (edge.secondary ? "secondary" : edge.relation)).join("|");
  const widestLevel = Math.max(1, ...flow.levels.map(level => level.length));
  const reportingLeads = [...graph.childrenByParentId.values()].filter(children => children.length).length;

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    if (!viewport || !canvas) return;
    let frame = 0;
    let focusFrame = 0;
    const refresh = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const canvasRect = canvas.getBoundingClientRect();
        setConnectors(edges.flatMap(edge => {
          const source = nodeRefs.current.get(edge.sourceId);
          const target = nodeRefs.current.get(edge.targetId);
          if (!source || !target) return [];
          const sourceRect = source.getBoundingClientRect();
          const targetRect = target.getBoundingClientRect();
          const sourceX = sourceRect.left + sourceRect.width / 2 - canvasRect.left;
          const targetX = targetRect.left + targetRect.width / 2 - canvasRect.left;
          const sourceBottom = sourceRect.bottom - canvasRect.top;
          const targetTop = targetRect.top - canvasRect.top;
          if (targetTop > sourceBottom + 8) {
            const controlY = sourceBottom + (targetTop - sourceBottom) / 2;
            return [{ ...edge, path: "M " + sourceX + " " + sourceBottom + " C " + sourceX + " " + controlY + ", " + targetX + " " + controlY + ", " + targetX + " " + targetTop }];
          }
          const direction = targetX >= sourceX ? 1 : -1;
          const sourceSide = sourceX + direction * sourceRect.width / 2;
          const targetSide = targetX - direction * targetRect.width / 2;
          const middleX = (sourceSide + targetSide) / 2;
          const sourceMiddle = sourceRect.top + sourceRect.height / 2 - canvasRect.top;
          const targetMiddle = targetRect.top + targetRect.height / 2 - canvasRect.top;
          return [{ ...edge, path: "M " + sourceSide + " " + sourceMiddle + " C " + middleX + " " + sourceMiddle + ", " + middleX + " " + targetMiddle + ", " + targetSide + " " + targetMiddle }];
        }));
      });
      cancelAnimationFrame(focusFrame);
      focusFrame = requestAnimationFrame(() => {
        const focused = nodeRefs.current.get(focusTargetId);
        if (!focused) return;
        const viewportRect = viewport.getBoundingClientRect();
        const focusedRect = focused.getBoundingClientRect();
        const left = viewport.scrollLeft + focusedRect.left + focusedRect.width / 2 - viewportRect.left - viewport.clientWidth / 2;
        viewport.scrollTo({ left: Math.max(0, left), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      });
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(refresh);
    observer?.observe(viewport);
    observer?.observe(canvas);
    nodeRefs.current.forEach(node => observer?.observe(node));
    window.addEventListener("resize", refresh);
    refresh();
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(focusFrame); observer?.disconnect(); window.removeEventListener("resize", refresh); };
  }, [signature, focusTargetId]);

  const setNodeRef = (id: string) => (node: HTMLButtonElement | null) => { if (node) nodeRefs.current.set(id, node); else nodeRefs.current.delete(id); };
  const toggle = (id: string, hasChildren: boolean) => {
    setFocusId(id);
    if (!hasChildren) return;
    setExpandedIds(currentIds => {
      const next = new Set(currentIds);
      if (next.has(id)) {
        next.delete(id);
        return pruneExpandedEmployeeIds(graph, next);
      }
      next.add(id);
      return next;
    });
  };

  return <div className="employee-flow" role="group" aria-label="Employee reporting hierarchy">
    <div className="employee-flow-summary" aria-label="Hierarchy summary">
      <span><strong>{graph.activeEmployees.length}</strong> active employees</span>
      <span><strong>{reportingLeads}</strong> reporting leads</span>
      <span><strong>{graph.roots.length}</strong> top-level leads</span>
      <span className={graph.unassignedRoots.length ? "has-issues" : ""}><strong>{graph.unassignedRoots.length}</strong> unassigned</span>
    </div>
    <div className="employee-flow-toolbar">
      <label className="employee-flow-search"><span className="sr-only">Find an employee</span><Search size={17} aria-hidden="true" /><input type="search" value={search} placeholder="Name, code, role or department" onChange={event => setSearch(event.target.value)} /></label>
      <span className="employee-flow-match-count" aria-live="polite">{searchResult ? searchResult.matchedIds.size + " match" + (searchResult.matchedIds.size === 1 ? "" : "es") : graph.activeEmployees.length + " employees"}</span>
      <div className="employee-flow-actions">
        <button type="button" onClick={() => setExpandedIds(new Set([unassignedReportingRootId, ...graph.activeEmployees.map(employee => employee.id)]))}>Expand all</button>
        <button type="button" onClick={() => setExpandedIds(new Set())}>Collapse all</button>
        {canCreate && <button type="button" onClick={() => onAddNode()}><Plus size={15} aria-hidden="true" /> Add employee</button>}
      </div>
    </div>
    <div className="employee-flow-legend">
      <span><i className="employee-flow-legend-solid" aria-hidden="true" /> Primary reporting line</span>
      <label><input type="checkbox" checked={showManagerLinks} onChange={event => setShowManagerLinks(event.target.checked)} /><i className="employee-flow-legend-dashed" aria-hidden="true" /> Show additional Manager links</label>
    </div>
    {flow.levels.length ? <div className="employee-flow-viewport" ref={viewportRef} tabIndex={0} aria-label="Employee hierarchy flowchart. Scroll horizontally to view more branches.">
      <div className="employee-flow-canvas" ref={canvasRef} style={{ minWidth: Math.max(360, widestLevel * 260) + "px" }}>
        <svg className="employee-flow-connectors" aria-hidden="true">
          <defs><marker id="employee-flow-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z" /></marker></defs>
          {connectors.map(connector => <path className={"employee-flow-line" + (connector.secondary ? " secondary" : "")} d={connector.path} markerEnd="url(#employee-flow-arrow)" key={connector.sourceId + "-" + connector.targetId + "-" + (connector.secondary ? "secondary" : connector.relation)} />)}
        </svg>
        {flow.levels.map((level, index) => <div className="employee-flow-level" role="group" aria-label={"Reporting level " + (index + 1)} key={level.map(node => node.id).join("-")}>
          {level.map(node => node.kind === "UNASSIGNED" ? <div className="employee-flow-node-shell" key={node.id}>
            <button ref={setNodeRef(node.id)} type="button" className={"employee-flow-card employee-flow-unassigned" + (displayedExpandedIds.has(node.id) ? " expanded" : "")} aria-expanded={displayedExpandedIds.has(node.id)} onClick={() => toggle(node.id, graph.unassignedRoots.length > 0)}>
              <span className="employee-flow-card-title"><CircleAlert size={18} aria-hidden="true" /><strong>Unassigned reporting lines</strong></span>
              <span>{graph.unassignedRoots.length} employee branch{graph.unassignedRoots.length === 1 ? "" : "es"} need a top-level link</span>
              <span className="employee-flow-disclosure" aria-hidden="true">{displayedExpandedIds.has(node.id) ? <ChevronDown size={17} /> : <ChevronRight size={17} />}</span>
            </button>
          </div> : <EmployeeFlowCard node={node} graph={graph} expanded={displayedExpandedIds.has(node.id)} canCreate={canCreate} canEdit={canEdit} setNodeRef={setNodeRef} onToggle={toggle} onAddNode={onAddNode} onEditReporting={onEditReporting} key={node.id} />)}
        </div>)}
      </div>
    </div> : <div className="employee-flow-empty"><Search size={20} aria-hidden="true" /><span>{normalizedSearch ? "No employees match “" + search.trim() + "”." : "No active employees yet."}</span></div>}
    {graph.issues.length > 0 && <details className="employee-flow-issues"><summary>{graph.issues.length} reporting link issue{graph.issues.length === 1 ? "" : "s"}</summary><div>{graph.issues.map((issue, index) => <span key={issue.employee.id + "-" + index}><strong>{issue.employee.fields["Full Name"] || issue.employee.fields["Employee Code"]}:</strong> {issue.message}</span>)}</div></details>}
  </div>;
}

function EmployeeFlowCard({ node, graph, expanded, canCreate, canEdit, setNodeRef, onToggle, onAddNode, onEditReporting }: { node: EmployeeFlowNode; graph: OrganizationHierarchyGraph; expanded: boolean; canCreate: boolean; canEdit: boolean; setNodeRef: (id: string) => (node: HTMLButtonElement | null) => void; onToggle: (id: string, hasChildren: boolean) => void; onAddNode: (parent?: EmployeeRecord) => void; onEditReporting: (employee: EmployeeRecord) => void }) {
  const employee = node.employee!;
  const children = graph.childrenByParentId.get(employee.id) ?? [];
  const name = employee.fields["Full Name"]?.trim() || employee.fields["Employee Code"]?.trim() || "Unnamed employee";
  const code = employee.fields["Employee Code"]?.trim() || "No employee code";
  const designation = employee.fields.Designation?.trim() || "Role not assigned";
  const department = employee.fields.Department?.trim() || "Department not assigned";
  const parentId = graph.primaryParentById.get(employee.id);
  const parent = parentId ? graph.employeeById.get(parentId) : undefined;
  const relation = graph.primaryRelationById.get(employee.id);
  const parentName = parent && (parent.fields["Full Name"]?.trim() || parent.fields["Employee Code"]?.trim());
  const managerEdge = graph.secondaryManagerEdges.find(edge => edge.targetId === employee.id);
  const manager = managerEdge ? graph.employeeById.get(managerEdge.sourceId) : undefined;
  const managerName = manager && (manager.fields["Full Name"]?.trim() || manager.fields["Employee Code"]?.trim());
  const relationship = parentName ? "Reports to " + parentName + " · " + (relation === "BOTH" ? "Line Manager + Manager" : relation === "LINE_MANAGER" ? "Line Manager" : "Manager") : graph.unassignedRootIds.has(employee.id) ? "Reporting line not assigned" : "Top-level reporting lead";

  return <div className="employee-flow-node-shell" role="group" aria-label={name + ", " + designation}>
    <button ref={setNodeRef(employee.id)} type="button" className={"employee-flow-card" + (expanded ? " expanded" : "")} aria-expanded={children.length ? expanded : undefined} aria-label={children.length ? (expanded ? "Collapse" : "Expand") + " direct reports for " + name : name} onClick={() => onToggle(employee.id, children.length > 0)}>
      <span className="employee-flow-card-title"><strong>{name}</strong><small>{code}</small></span>
      <span className="employee-flow-role">{designation}</span>
      <span className="employee-flow-department">{department}</span>
      {(graph.lineManagerIds.has(employee.id) || graph.managerIds.has(employee.id)) && <span className="employee-flow-capacities">{graph.lineManagerIds.has(employee.id) && <i>Line Manager</i>}{graph.managerIds.has(employee.id) && <i>Manager</i>}</span>}
      <span className="employee-flow-relationship">{relationship}</span>
      {managerName && <span className="employee-flow-secondary-manager">Additional Manager: {managerName}</span>}
      {children.length > 0 && <span className="employee-flow-report-count"><Users size={14} aria-hidden="true" /> {children.length} direct report{children.length === 1 ? "" : "s"}{expanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}</span>}
      {employee.status === "On Leave" && <span className="employee-flow-leave">On Leave</span>}
    </button>
    {(canEdit || canCreate) && <div className="employee-flow-node-actions">
      {canEdit && <button type="button" onClick={() => onEditReporting(employee)}><Pencil size={14} aria-hidden="true" /> Edit reporting</button>}
      {canCreate && <button type="button" onClick={() => onAddNode(employee)}><Plus size={14} aria-hidden="true" /> Add direct report</button>}
    </div>}
  </div>;
}

function ReportingEditor({ employee, employees, onCancel, onSave }: { employee: EmployeeRecord; employees: EmployeeRecord[]; onCancel: () => void; onSave: (reporting: { lineManagerId: string | null; managerId: string | null }) => Promise<void> }) {
  const employeeByCode = new Map(employees.map(item => [item.fields["Employee Code"]?.trim().toLowerCase(), item] as const).filter(([code]) => Boolean(code)));
  const currentLineManagerId = employee.lineManagerId !== undefined ? employee.lineManagerId ?? "" : employeeByCode.get(hierarchyLineManagerCode(employee))?.id || "";
  const currentManagerId = employee.managerId !== undefined ? employee.managerId ?? "" : employeeByCode.get(hierarchyManagerCode(employee))?.id || "";
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
    <div className="form-grid reporting-editor-fields">
      <label>Line Manager<small>Primary day-to-day reporting line shown by the solid chart connector.</small><select value={lineManagerId} onChange={event => setLineManagerId(event.target.value)}><option value="">None</option>{options.map(item => <option value={item.id} key={item.id}>{label(item)}</option>)}</select></label>
      <label>Manager<small>Optional additional manager shown by a dashed connector when different.</small><select value={managerId} onChange={event => setManagerId(event.target.value)}><option value="">None</option>{options.map(item => <option value={item.id} key={item.id}>{label(item)}</option>)}</select></label>
    </div>
    <div className="form-actions"><button type="button" onClick={onCancel} disabled={saving}>Cancel</button><button type="button" className="primary" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save reporting"}</button></div>
    {error && <p className="sync-alert">{error}</p>}
  </div>;
}

export function RoleBranchFilter({ roles, employees, selectedRoleId, onSelect, onEdit }: { roles: Role[]; employees: EmployeeRecord[]; selectedRoleId: string; onSelect: (roleId: string) => void; onEdit?: (role: Role) => void }) {
  const graph = buildRoleFlowGraph(roles);
  const assigneesByCode = buildRoleAssigneeMap(roles, employees);
  const [rootExpanded, setRootExpanded] = useState(false);
  const [expandedRoleCodes, setExpandedRoleCodes] = useState<Set<string>>(new Set());
  const [expandedRosterCodes, setExpandedRosterCodes] = useState<Set<string>>(new Set());
  const [focusCode, setFocusCode] = useState(roleFlowRootCode);
  const [connectors, setConnectors] = useState<RoleFlowConnector[]>([]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLButtonElement>());
  const flow = buildVisibleRoleFlow(graph, rootExpanded, expandedRoleCodes);
  const signature = `${flow.levels.flat().map(role => role.code).join("|")}:${flow.edges.map(edge => `${edge.sourceCode}>${edge.targetCode}`).join("|")}:${[...expandedRosterCodes].sort().join("|")}`;
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
    if (!nextExpanded) {
      setExpandedRoleCodes(new Set());
      setExpandedRosterCodes(new Set());
    }
  };
  const toggleRole = (role: Role) => {
    onSelect(selectedRoleId === role.id ? "" : role.id);
    setFocusCode(role.code);
    if (!(graph.childrenByCode.get(role.code)?.length)) return;
    const next = new Set(expandedRoleCodes);
    if (!next.has(role.code)) {
      next.add(role.code);
      setExpandedRoleCodes(next);
      return;
    }
    next.delete(role.code);
    const pruned = pruneExpandedRoleCodes(graph, true, next);
    const visibleCodes = buildVisibleRoleFlow(graph, true, pruned).visibleCodes;
    setExpandedRoleCodes(pruned);
    setExpandedRosterCodes(current => new Set([...current].filter(code => visibleCodes.has(code))));
  };
  const toggleRoster = (role: Role) => {
    setFocusCode(role.code);
    setExpandedRosterCodes(current => {
      const next = new Set(current);
      if (next.has(role.code)) next.delete(role.code);
      else next.add(role.code);
      return next;
    });
  };

  return <div className="role-branch-filter" role="group" aria-label="Role hierarchy filter">
    <p>Select a role to filter users and reveal inherited roles. Use its assigned count to show employee names and departments. Redundant links are combined for clarity.</p>
    <div className="role-flowchart-viewport" ref={viewportRef}>
      <div className="role-flowchart-canvas" id="role-hierarchy-flowchart" ref={canvasRef} style={{ minWidth: `${Math.max(320, widestLevel * 200)}px` }}>
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
            const assignees = assigneesByCode.get(role.code) ?? [];
            const rosterExpanded = expandedRosterCodes.has(role.code);
            const rosterId = `role-assignees-${role.id}`;
            return <div className="role-flowchart-node-shell" key={role.id}>
              <button ref={setNodeRef(role.code)} type="button" className={`role-branch-node${role.isBuiltIn ? "" : " role-branch-node-custom"}${selectedRoleId === role.id ? " selected" : ""}${expanded ? " expanded" : ""}`} aria-label={`Filter users by ${role.displayName} role`} aria-pressed={selectedRoleId === role.id} aria-expanded={children.length ? expanded : undefined} onClick={() => toggleRole(role)}>
                <span className="role-branch-node-copy"><strong>{role.displayName}</strong><span>{role.code.replaceAll("_", " ")}</span></span>
                {children.length > 0 && <span className="role-branch-disclosure" aria-hidden="true">{expanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />}</span>}
              </button>
              {assignees.length ? <button type="button" className="role-assignee-toggle" aria-expanded={rosterExpanded} aria-controls={rosterId} aria-label={`${rosterExpanded ? "Hide" : "Show"} ${assignees.length} active employee${assignees.length === 1 ? "" : "s"} directly assigned to ${role.displayName}`} onClick={() => toggleRoster(role)}>
                <Users size={14} aria-hidden="true" /><span>{assignees.length} assigned</span>{rosterExpanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
              </button> : <span className="role-assignee-empty">No active employees assigned</span>}
              {rosterExpanded && <div id={rosterId} className="role-assignee-list" role="list" tabIndex={0} aria-label={`Employees directly assigned to ${role.displayName}`}>
                {assignees.map(assignee => <div className="role-assignee" role="listitem" key={assignee.id}><strong>{assignee.name}</strong><span>{assignee.department}</span></div>)}
              </div>}
              {!role.isBuiltIn && onEdit && <button type="button" className="role-branch-edit" onClick={() => onEdit(role)}><Pencil size={14} aria-hidden="true" /> Edit hierarchy</button>}
            </div>;
          })}
        </div>)}
        {rootExpanded && graph.activeRoles.length === 0 && <p className="role-flowchart-empty">No active roles are available.</p>}
      </div>
    </div>
  </div>;
}
