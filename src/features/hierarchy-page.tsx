import { useLayoutEffect, useRef, useState } from "react";
import { Building2, ChevronDown, ChevronRight, Download, Pencil, Plus, Search, ShieldCheck, Users } from "lucide-react";
import { hasPermission, type BackendSession } from "../api";
import type { EmployeeRecord } from "../data";
import { buildCompanyRoleHierarchy, type DepartmentRoleGroup, type RoleHierarchyDepartment, type RoleHierarchyMember } from "../roleHierarchy";

export type OrganizationalRole = "HR" | "MANAGER" | "LINE_MANAGER" | "EMPLOYEE";
type ReportingRelation = "LINE_MANAGER" | "MANAGER" | null;
export type OrganizationHierarchyNode = { employee: EmployeeRecord; role: OrganizationalRole; roleLabel: string; parentRelation: ReportingRelation; children: OrganizationHierarchyNode[] };
type OrganizationHierarchyIssue = { employee: EmployeeRecord; message: string };
type CompanyRoleEdge = { sourceId: string; targetId: string };
type CompanyRoleConnector = CompanyRoleEdge & { path: string };

const organizationalRoleLabel: Record<OrganizationalRole, string> = { HR: "HR", MANAGER: "Manager", LINE_MANAGER: "Line manager", EMPLOYEE: "Employee" };
const childRole: Partial<Record<OrganizationalRole, OrganizationalRole>> = { HR: "MANAGER", MANAGER: "LINE_MANAGER", LINE_MANAGER: "EMPLOYEE" };
const companyLeadershipId = "company-leadership";

export function hierarchyManagerCode(employee: EmployeeRecord) {
  return (employee.fields["Manager Employee Code/Name"] || "").split(" - ", 1)[0].trim().toLowerCase();
}

export function hierarchyLineManagerCode(employee: EmployeeRecord) {
  return (employee.fields["Line Manager Employee Code/Name"] || employee.fields["Reporting Manager Employee Code/Name"] || "").split(" - ", 1)[0].trim().toLowerCase();
}

export function hierarchyReportingPayload(lineManagerId: string, managerId: string) {
  return { lineManagerId: lineManagerId || null, managerId: managerId || null };
}

function organizationDepartment(employee: EmployeeRecord) {
  return employee.fields.Department?.trim() || "Department not assigned";
}

export function groupOrganizationBranches(nodes: OrganizationHierarchyNode[]) {
  const groups = new Map<string, OrganizationHierarchyNode[]>();
  nodes.forEach(node => {
    const department = organizationDepartment(node.employee);
    groups.set(department, [...(groups.get(department) ?? []), node]);
  });
  return [...groups.entries()]
    .sort(([left], [right]) => left === "Department not assigned" ? 1 : right === "Department not assigned" ? -1 : left.localeCompare(right))
    .map(([department, departmentNodes]) => ({ department, nodes: departmentNodes }));
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

export function HierarchyPage({ session, employees, onAddNode, onUpdateReporting, onExportRoleHierarchy }: { session: BackendSession; employees: EmployeeRecord[]; onAddNode: (role: OrganizationalRole, parent?: EmployeeRecord) => void; onUpdateReporting: (employeeId: string, reporting: { lineManagerId: string | null; managerId: string | null }) => Promise<void>; onExportRoleHierarchy: () => void }) {
  const [activeTab, setActiveTab] = useState<"organization" | "roles">("organization");
  const [reportingEmployee, setReportingEmployee] = useState<EmployeeRecord | null>(null);
  const tabRefs = useRef(new Map<"organization" | "roles", HTMLButtonElement>());
  const selectTab = (tab: "organization" | "roles") => {
    setActiveTab(tab);
    requestAnimationFrame(() => tabRefs.current.get(tab)?.focus());
  };
  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    selectTab(event.key === "Home" ? "organization" : event.key === "End" ? "roles" : activeTab === "organization" ? "roles" : "organization");
  };

  return <section className="stack">
    <div className="hierarchy-tabs" role="tablist" aria-label="Hierarchy views">
      <button ref={node => { if (node) tabRefs.current.set("organization", node); }} type="button" role="tab" id="organization-hierarchy-tab" aria-selected={activeTab === "organization"} aria-controls="organization-hierarchy-panel" tabIndex={activeTab === "organization" ? 0 : -1} onClick={() => setActiveTab("organization")} onKeyDown={onTabKeyDown}><Users size={17} aria-hidden="true" /> Organizational hierarchy</button>
      <button ref={node => { if (node) tabRefs.current.set("roles", node); }} type="button" role="tab" id="role-hierarchy-tab" aria-selected={activeTab === "roles"} aria-controls="role-hierarchy-panel" tabIndex={activeTab === "roles" ? 0 : -1} onClick={() => setActiveTab("roles")} onKeyDown={onTabKeyDown}><ShieldCheck size={17} aria-hidden="true" /> Role hierarchy</button>
    </div>
    {activeTab === "organization" && <div className="panel" role="tabpanel" id="organization-hierarchy-panel" aria-labelledby="organization-hierarchy-tab">
      <div className="panel-head"><div><h3>Organizational hierarchy</h3><span>Follow the reporting chain from executives to each employee.</span></div></div>
      <OrganizationChart employees={employees} canCreate={hasPermission(session, "employee.hr.create")} canEdit={hasPermission(session, "employee.hr.update")} onAddNode={onAddNode} onEditReporting={setReportingEmployee} />
      <p className="muted hierarchy-access-note">This chart manages employee reporting lines. Login access remains controlled by roles in System.</p>
    </div>}
    {activeTab === "organization" && reportingEmployee && <ReportingEditor employee={reportingEmployee} employees={employees} onCancel={() => setReportingEmployee(null)} onSave={async reporting => { await onUpdateReporting(reportingEmployee.id, reporting); setReportingEmployee(null); }} />}
    {activeTab === "roles" && <div className="panel role-hierarchy-print-surface" role="tabpanel" id="role-hierarchy-panel" aria-labelledby="role-hierarchy-tab">
      <div className="panel-head"><div><h3>Role hierarchy</h3><span>Explore the company by department and direct access role.</span></div></div>
      <DepartmentRoleHierarchy employees={employees} onExportPdf={onExportRoleHierarchy} />
    </div>}
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
  const departmentCount = new Set(allNodes.map(({ node }) => organizationDepartment(node.employee))).size;
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
      <span><strong>{departmentCount}</strong> departments</span>
      <span><strong>{reportingLeads}</strong> reporting leads</span>
      <span><strong>{hierarchy.roots.length}</strong> top-level roots</span>
      <span className={hierarchy.issues.length ? "has-issues" : ""}><strong>{hierarchy.issues.length}</strong> unresolved</span>
    </div>
    <div className="organization-toolbar">
      <label className="organization-search"><span className="sr-only">Find an employee or department</span><Search size={17} aria-hidden="true" /><input type="search" value={search} placeholder="Find employee, code, or department" onChange={event => setSearch(event.target.value)} /></label>
      <span className="organization-match-count" aria-live="polite">{normalizedSearch ? `${matches} match${matches === 1 ? "" : "es"}` : `${allNodes.length} employees`}</span>
      <div className="organization-tree-actions">
        <button type="button" onClick={() => setCollapsedIds(new Set())}>Expand all</button>
        <button type="button" onClick={() => setCollapsedIds(new Set(branchIds))}>Collapse all</button>
      </div>
    </div>
    {hierarchy.roots.length ? <div className="organization-tree"><OrganizationBranches nodes={normalizedSearch ? hierarchy.roots.filter(node => organizationBranchMatches(node, normalizedSearch)) : hierarchy.roots} query={normalizedSearch} collapsedIds={effectiveCollapsed} canCreate={canCreate} canEdit={canEdit} onToggle={toggle} onAddNode={onAddNode} onEditReporting={onEditReporting} root />{normalizedSearch && matches === 0 && <div className="organization-empty"><Search size={20} /><span>No employees or departments match “{search.trim()}”.</span></div>}</div> : <div className="organization-empty"><span>No active employees yet.</span>{canCreate && <button type="button" onClick={() => onAddNode("MANAGER")}><Plus size={16} /> Add employee</button>}</div>}
    {hierarchy.issues.length > 0 && <details className="organization-unresolved"><summary>{hierarchy.issues.length} unresolved reporting relationship{hierarchy.issues.length === 1 ? "" : "s"}</summary><p>Employees remain visible, using the next valid reporting relationship where possible.</p><div>{hierarchy.issues.map((issue, index) => <span key={`${issue.employee.id}-${index}`}><strong>{issue.employee.fields["Full Name"] || issue.employee.fields["Employee Code"]}:</strong> {issue.message}</span>)}</div></details>}
  </div>;
}

function OrganizationBranch({ node, query, collapsedIds, canCreate, canEdit, onToggle, onAddNode, onEditReporting }: { node: OrganizationHierarchyNode; query: string; collapsedIds: Set<string>; canCreate: boolean; canEdit: boolean; onToggle: (employeeId: string) => void; onAddNode: (role: OrganizationalRole, parent?: EmployeeRecord) => void; onEditReporting: (employee: EmployeeRecord) => void }) {
  if (query && !organizationBranchMatches(node, query)) return null;
  const visibleChildren = query ? node.children.filter(child => organizationBranchMatches(child, query)) : node.children;
  const expanded = Boolean(visibleChildren.length) && (Boolean(query) || !collapsedIds.has(node.employee.id));

  return <div className="organization-branch">
    <EmployeeHierarchyNode node={node} expanded={expanded} canCreate={canCreate} canEdit={canEdit} onToggle={onToggle} onAddNode={onAddNode} onEditReporting={onEditReporting} />
    {expanded && <div className="organization-children"><OrganizationBranches nodes={visibleChildren} parentDepartment={organizationDepartment(node.employee)} query={query} collapsedIds={collapsedIds} canCreate={canCreate} canEdit={canEdit} onToggle={onToggle} onAddNode={onAddNode} onEditReporting={onEditReporting} /></div>}
  </div>;
}

function OrganizationBranches({ nodes, parentDepartment, root = false, ...branchProps }: { nodes: OrganizationHierarchyNode[]; parentDepartment?: string; root?: boolean; query: string; collapsedIds: Set<string>; canCreate: boolean; canEdit: boolean; onToggle: (employeeId: string) => void; onAddNode: (role: OrganizationalRole, parent?: EmployeeRecord) => void; onEditReporting: (employee: EmployeeRecord) => void }) {
  const directNodes = root ? nodes.filter(node => ["COO", "CPO", "HR"].includes(node.roleLabel)) : [];
  const groupedNodes = groupOrganizationBranches(root ? nodes.filter(node => !directNodes.includes(node)) : nodes);
  return <>{directNodes.map(node => <OrganizationBranch node={node} {...branchProps} key={node.employee.id} />)}{groupedNodes.flatMap(group =>
    group.department === parentDepartment
      ? group.nodes.map(node => <OrganizationBranch node={node} {...branchProps} key={node.employee.id} />)
      : [<div className="organization-branch organization-department-branch" key={`department-${group.department}`}>
        <div className="organization-department-node"><span className="organization-department-icon"><Building2 size={18} aria-hidden="true" /></span><span><strong>{group.department}</strong><small>{group.nodes.length} reporting branch{group.nodes.length === 1 ? "" : "es"}</small></span></div>
        <div className="organization-children">{group.nodes.map(node => <OrganizationBranch node={node} {...branchProps} key={node.employee.id} />)}</div>
      </div>]
  )}</>;
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
  return [node.employee.fields["Employee Code"], node.employee.fields["Full Name"], node.employee.fields.Department, node.roleLabel].some(value => value?.toLocaleLowerCase().includes(query));
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

function roleHierarchyMemberMatches(member: RoleHierarchyMember, query: string) {
  return [member.name, member.employeeCode, member.designation, member.department, ...member.roleCodes].some(value => value.toLocaleLowerCase().includes(query));
}

function roleHierarchyRoleMatches(role: DepartmentRoleGroup, query: string) {
  return role.label.toLocaleLowerCase().includes(query) || role.code.toLocaleLowerCase().includes(query) || role.members.some(member => roleHierarchyMemberMatches(member, query));
}

function roleHierarchyDepartmentMatches(department: RoleHierarchyDepartment, query: string) {
  return department.name.toLocaleLowerCase().includes(query) || department.roles.some(role => roleHierarchyRoleMatches(role, query));
}

export function DepartmentRoleHierarchy({ employees, onExportPdf }: { employees: EmployeeRecord[]; onExportPdf: () => void }) {
  const hierarchy = buildCompanyRoleHierarchy(employees);
  const [leadershipExpanded, setLeadershipExpanded] = useState(true);
  const [expandedDepartmentIds, setExpandedDepartmentIds] = useState<Set<string>>(new Set());
  const [expandedRoleIds, setExpandedRoleIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [focusId, setFocusId] = useState(companyLeadershipId);
  const [connectors, setConnectors] = useState<CompanyRoleConnector[]>([]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLButtonElement>());
  const query = search.trim().toLocaleLowerCase();
  const rootExpanded = leadershipExpanded || Boolean(query);
  const executiveMatches = Boolean(query) && hierarchy.executives.some(executive => executive.code.toLocaleLowerCase().includes(query) || executive.label.toLocaleLowerCase().includes(query) || executive.members.some(member => roleHierarchyMemberMatches(member, query)));
  const visibleDepartments = rootExpanded ? hierarchy.departments.filter(department => !query || roleHierarchyDepartmentMatches(department, query)) : [];
  const rolesFor = (department: RoleHierarchyDepartment) => {
    if (query) return department.name.toLocaleLowerCase().includes(query) ? department.roles : department.roles.filter(role => roleHierarchyRoleMatches(role, query));
    return expandedDepartmentIds.has(department.id) ? department.roles : [];
  };
  const visibleBranches = visibleDepartments.map(department => ({ department, roles: rolesFor(department) }));
  const edges: CompanyRoleEdge[] = visibleBranches.flatMap(({ department, roles }) => [
    { sourceId: companyLeadershipId, targetId: department.id },
    ...roles.map(role => ({ sourceId: department.id, targetId: role.id })),
  ]);
  const signature = `${edges.map(edge => `${edge.sourceId}>${edge.targetId}`).join("|")}:${[...expandedRoleIds].sort().join("|")}`;
  const canvasMinWidth = Math.max(680, visibleBranches.reduce((width, branch) => width + Math.max(230, branch.roles.length * 218), 0) + Math.max(0, visibleBranches.length - 1) * 22);

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
        setConnectors(edges.flatMap(edge => {
          const source = nodeRefs.current.get(edge.sourceId);
          const target = nodeRefs.current.get(edge.targetId);
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
        const focused = nodeRefs.current.get(focusId);
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
  }, [signature, focusId]);

  const setNodeRef = (id: string) => (node: HTMLButtonElement | null) => {
    if (node) nodeRefs.current.set(id, node);
    else nodeRefs.current.delete(id);
  };
  const toggleLeadership = () => {
    setFocusId(companyLeadershipId);
    if (rootExpanded) {
      setLeadershipExpanded(false);
      setSearch("");
      setExpandedDepartmentIds(new Set());
      setExpandedRoleIds(new Set());
    } else setLeadershipExpanded(true);
  };
  const toggleDepartment = (department: RoleHierarchyDepartment) => {
    setFocusId(department.id);
    setExpandedDepartmentIds(current => {
      const next = new Set(current);
      if (next.has(department.id)) {
        next.delete(department.id);
        const roleIds = new Set(department.roles.map(role => role.id));
        setExpandedRoleIds(openRoles => new Set([...openRoles].filter(id => !roleIds.has(id))));
      } else next.add(department.id);
      return next;
    });
  };
  const toggleRole = (role: DepartmentRoleGroup) => {
    setFocusId(role.id);
    setExpandedRoleIds(current => {
      const next = new Set(current);
      if (next.has(role.id)) next.delete(role.id);
      else next.add(role.id);
      return next;
    });
  };
  const expandAll = () => {
    setSearch("");
    setLeadershipExpanded(true);
    setExpandedDepartmentIds(new Set(hierarchy.departments.map(department => department.id)));
    setExpandedRoleIds(new Set(hierarchy.departments.flatMap(department => department.roles.map(role => role.id))));
    setFocusId(companyLeadershipId);
  };
  const collapseAll = () => {
    setLeadershipExpanded(false);
    setExpandedDepartmentIds(new Set());
    setExpandedRoleIds(new Set());
    setSearch("");
    setFocusId(companyLeadershipId);
  };

  return <div className="company-role-hierarchy" role="group" aria-label="Company role hierarchy">
    <div className="company-role-summary" aria-label="Role hierarchy summary">
      <span><strong>{hierarchy.activeEmployees.length}</strong> active employees</span>
      <span><strong>{hierarchy.departments.length}</strong> departments</span>
      <span><strong>{hierarchy.roleAssignmentCount}</strong> direct role assignments</span>
      <span className={hierarchy.unassignedCount ? "has-issues" : ""}><strong>{hierarchy.unassignedCount}</strong> unassigned</span>
    </div>
    <div className="company-role-toolbar">
      <label className="company-role-search"><span className="sr-only">Find a department, role, or employee</span><Search size={17} aria-hidden="true" /><input type="search" value={search} placeholder="Find department, role, or employee" onChange={event => { setSearch(event.target.value); if (event.target.value) setLeadershipExpanded(true); }} /></label>
      <span className="company-role-match-count" aria-live="polite">{query ? `${visibleDepartments.length} department${visibleDepartments.length === 1 ? "" : "s"}${executiveMatches ? " · executive match" : ""}` : `${hierarchy.departments.length} departments`}</span>
      <div className="company-role-actions"><button type="button" onClick={expandAll}>Expand all</button><button type="button" onClick={collapseAll}>Collapse all</button><button type="button" className="primary" onClick={onExportPdf}><Download size={16} aria-hidden="true" /> Export PDF</button></div>
    </div>
    <div className="company-role-legend"><span><i className="leadership" /> Executive leadership</span><span><i className="department" /> Department</span><span><i className="access-role" /> Direct access role</span><p>Employees with more than one direct role appear in each relevant role card. Reporting lines remain in Organizational hierarchy.</p></div>
    <div className="role-flowchart-viewport company-role-viewport" ref={viewportRef} tabIndex={0} aria-label="Interactive role hierarchy flowchart. Scroll horizontally to explore departments.">
      <div className="role-flowchart-canvas company-role-canvas" id="company-role-hierarchy-flowchart" ref={canvasRef} style={{ minWidth: `${canvasMinWidth}px` }}>
        <svg className="role-flowchart-connectors" aria-hidden="true">
          <defs><marker id="company-role-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z" /></marker></defs>
          {connectors.map(connector => <path className="role-flowchart-line" d={connector.path} markerEnd="url(#company-role-arrow)" key={`${connector.sourceId}-${connector.targetId}`} />)}
        </svg>
        <div className="role-flowchart-level role-flowchart-root-level">
          <button ref={setNodeRef(companyLeadershipId)} type="button" className={`company-role-leadership${rootExpanded ? " expanded" : ""}`} aria-expanded={hierarchy.departments.length ? rootExpanded : undefined} aria-controls="company-role-departments" onClick={toggleLeadership}>
            <span className="company-role-leadership-heading"><span><ShieldCheck size={18} aria-hidden="true" /> Executive leadership</span>{hierarchy.departments.length > 0 && (rootExpanded ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />)}</span>
            <span className="company-role-executives">{hierarchy.executives.map(executive => <span className={`company-role-executive company-role-executive-${executive.code.toLocaleLowerCase()}`} key={executive.code}><small>{executive.code}</small><strong>{executive.label}</strong><span>{executive.members.length ? executive.members.map(member => member.name).join(", ") : "Position not assigned"}</span></span>)}</span>
          </button>
        </div>
        {rootExpanded && <div id="company-role-departments" className="company-role-departments" role="group" aria-label="Departments">
          {visibleBranches.map(({ department, roles }) => {
            const departmentExpanded = Boolean(query) || expandedDepartmentIds.has(department.id);
            return <section className="company-role-department-branch" style={{ width: `${Math.max(230, roles.length * 218)}px` }} aria-labelledby={`${department.id}-name`} key={department.id}>
              <button ref={setNodeRef(department.id)} type="button" className={`company-role-department${departmentExpanded ? " expanded" : ""}`} aria-expanded={departmentExpanded} aria-controls={`${department.id}-roles`} onClick={() => toggleDepartment(department)}>
                <span className="company-role-node-icon"><Building2 size={18} aria-hidden="true" /></span><span><strong id={`${department.id}-name`}>{department.name}</strong><small>{department.memberCount} employee{department.memberCount === 1 ? "" : "s"} · {department.roles.length} role{department.roles.length === 1 ? "" : "s"}</small></span>{departmentExpanded ? <ChevronDown size={17} aria-hidden="true" /> : <ChevronRight size={17} aria-hidden="true" />}
              </button>
              {departmentExpanded && <div id={`${department.id}-roles`} className="company-role-cards" role="group" aria-label={`${department.name} access roles`}>{roles.map(role => {
                const rosterExpanded = Boolean(query) || expandedRoleIds.has(role.id);
                return <div className="company-role-card-shell" key={role.id}>
                  <button ref={setNodeRef(role.id)} type="button" className={`company-role-card${rosterExpanded ? " expanded" : ""}`} aria-expanded={rosterExpanded} aria-controls={`${role.id}-members`} onClick={() => toggleRole(role)}>
                    <span className="company-role-node-icon"><ShieldCheck size={17} aria-hidden="true" /></span><span><strong>{role.label}</strong><small>{role.code.replaceAll("_", " ")} · {role.members.length} assigned</small></span>{rosterExpanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                  </button>
                  {rosterExpanded && <div id={`${role.id}-members`} className="company-role-roster" role="list" aria-label={`${role.label} employees`}>{role.members.map(member => <div className="company-role-member" role="listitem" key={`${role.id}-${member.id}`}><span className="company-role-avatar" aria-hidden="true">{member.name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toLocaleUpperCase()}</span><span><strong>{member.name}</strong><small>{member.employeeCode} · {member.designation}</small></span>{member.status === "On Leave" && <em>On leave</em>}</div>)}</div>}
                </div>;
              })}</div>}
            </section>;
          })}
        </div>}
        {rootExpanded && hierarchy.departments.length === 0 && <div className="role-flowchart-empty">No active employees are available below executive leadership.</div>}
        {rootExpanded && query && !executiveMatches && visibleDepartments.length === 0 && <div className="role-flowchart-empty"><Search size={18} aria-hidden="true" /> No departments, roles, or employees match “{search.trim()}”.</div>}
      </div>
    </div>
  </div>;
}
