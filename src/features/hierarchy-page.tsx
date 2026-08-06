import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Building2, ChevronDown, ChevronLeft, ChevronRight, Crosshair, Download, Maximize2, Minus, Move, Pencil, Plus, RotateCcw, Search, ShieldCheck, Users, X } from "lucide-react";
import { hasPermission, type BackendSession } from "../api";
import type { EmployeeRecord } from "../data";
import { buildCompanyRoleHierarchy, type RoleHierarchyBranch, type RoleHierarchyDepartment, type RoleHierarchyMember } from "../roleHierarchy";

export type OrganizationalRole = "HR" | "MANAGER" | "LINE_MANAGER" | "EMPLOYEE";
type ReportingRelation = "LINE_MANAGER" | "MANAGER" | null;
type OrganizationHierarchyNode = { employee: EmployeeRecord; role: OrganizationalRole; roleLabel: string; parentRelation: ReportingRelation; children: OrganizationHierarchyNode[] };
type OrganizationHierarchyIssue = { employee: EmployeeRecord; message: string };
type CompanyRoleEdge = { sourceId: string; targetId: string };
type CompanyRoleConnector = CompanyRoleEdge & { path: string };

const organizationalRoleLabel: Record<OrganizationalRole, string> = { HR: "HR", MANAGER: "Manager", LINE_MANAGER: "Line manager", EMPLOYEE: "Employee" };
const childRole: Partial<Record<OrganizationalRole, OrganizationalRole>> = { HR: "MANAGER", MANAGER: "LINE_MANAGER", LINE_MANAGER: "EMPLOYEE" };
const companyCooId = "company-coo";
const companyCpoId = "company-cpo";
const companyRoleMinZoom = 0.5;
const companyRoleMaxZoom = 1.5;
const companyRoleZoomStep = 0.1;

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
      <div className="panel-head"><div><h3>Role hierarchy</h3><span>Explore reporting responsibility by department.</span></div></div>
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

function roleHierarchyMemberMatches(member: RoleHierarchyMember, query: string) {
  return [member.name, member.employeeCode, member.designation, member.department].some(value => value.toLocaleLowerCase().includes(query));
}

function filterRoleHierarchyBranch(branch: RoleHierarchyBranch, query: string): RoleHierarchyBranch | null {
  if (!query || branch.label.toLocaleLowerCase().includes(query) || branch.code.toLocaleLowerCase().includes(query) || roleHierarchyMemberMatches(branch.member, query)) return branch;
  const children = branch.children.map(child => filterRoleHierarchyBranch(child, query)).filter((child): child is RoleHierarchyBranch => Boolean(child));
  return children.length ? { ...branch, children } : null;
}

function filterRoleHierarchyDepartment(department: RoleHierarchyDepartment, query: string): RoleHierarchyDepartment | null {
  if (!query || department.name.toLocaleLowerCase().includes(query)) return department;
  const branches = department.branches.map(branch => filterRoleHierarchyBranch(branch, query)).filter((branch): branch is RoleHierarchyBranch => Boolean(branch));
  return branches.length ? { ...department, branches } : null;
}

function flattenRoleHierarchyBranches(branches: RoleHierarchyBranch[]): RoleHierarchyBranch[] {
  return branches.flatMap(branch => [branch, ...flattenRoleHierarchyBranches(branch.children)]);
}

function roleHierarchyBranchMatches(branch: RoleHierarchyBranch, query: string) {
  return branch.label.toLocaleLowerCase().includes(query)
    || branch.code.toLocaleLowerCase().includes(query)
    || roleHierarchyMemberMatches(branch.member, query);
}

type RoleHierarchyDepartmentMeta = {
  department: RoleHierarchyDepartment;
  owner: "COO" | "CPO" | "UNASSIGNED";
};

export function DepartmentRoleHierarchy({ employees, onExportPdf }: { employees: EmployeeRecord[]; onExportPdf: () => void }) {
  const hierarchy = useMemo(() => buildCompanyRoleHierarchy(employees), [employees]);
  const coo = hierarchy.executives.find(executive => executive.code === "COO")!;
  const cpo = hierarchy.executives.find(executive => executive.code === "CPO")!;
  const departmentMeta = useMemo<RoleHierarchyDepartmentMeta[]>(() => [
    ...coo.departments.map(department => ({ department, owner: "COO" as const })),
    ...cpo.departments.map(department => ({ department, owner: "CPO" as const })),
    ...hierarchy.unassignedDepartments.map(department => ({ department, owner: "UNASSIGNED" as const })),
  ], [coo.departments, cpo.departments, hierarchy.unassignedDepartments]);
  const allDepartments = departmentMeta.map(item => item.department);
  const branchMeta = useMemo(() => {
    const byId = new Map<string, RoleHierarchyBranch>();
    const departmentByBranchId = new Map<string, RoleHierarchyDepartmentMeta>();
    const parentById = new Map<string, string>();
    const visit = (branch: RoleHierarchyBranch, meta: RoleHierarchyDepartmentMeta, parentId: string) => {
      byId.set(branch.id, branch);
      departmentByBranchId.set(branch.id, meta);
      parentById.set(branch.id, parentId);
      branch.children.forEach(child => visit(child, meta, branch.id));
    };
    departmentMeta.forEach(meta => {
      parentById.set(meta.department.id, meta.owner === "UNASSIGNED" ? "company-unassigned" : `company-${meta.owner.toLocaleLowerCase()}`);
      meta.department.branches.forEach(branch => visit(branch, meta, meta.department.id));
    });
    parentById.set(companyCpoId, companyCooId);
    return { byId, departmentByBranchId, parentById, branches: [...byId.values()] };
  }, [departmentMeta]);
  const [expandedExecutiveIds, setExpandedExecutiveIds] = useState<Set<string>>(new Set([companyCooId, companyCpoId]));
  const [expandedDepartmentIds, setExpandedDepartmentIds] = useState<Set<string>>(() => new Set(allDepartments.map(department => department.id)));
  const [expandedBranchIds, setExpandedBranchIds] = useState<Set<string>>(new Set());
  const [unassignedExpanded, setUnassignedExpanded] = useState(true);
  const [search, setSearch] = useState("");
  const [searchMatchIndex, setSearchMatchIndex] = useState(0);
  const [focusedDepartmentId, setFocusedDepartmentId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState(companyCooId);
  const [connectors, setConnectors] = useState<CompanyRoleConnector[]>([]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLElement>());
  const searchOriginDepartmentId = useRef<string | null>(null);
  const query = search.trim().toLocaleLowerCase();
  const searchMatches = query ? branchMeta.branches.filter(branch => roleHierarchyBranchMatches(branch, query)) : [];
  const focusedMeta = focusedDepartmentId ? departmentMeta.find(item => item.department.id === focusedDepartmentId) : undefined;
  const executiveExpanded = (id: string) => Boolean(query) || expandedExecutiveIds.has(id);
  const leadershipVisible = focusedMeta?.owner !== "UNASSIGNED";
  const cpoVisible = leadershipVisible && executiveExpanded(companyCooId) && (!focusedMeta || focusedMeta.owner === "CPO");
  const executiveMatches = Boolean(query) && hierarchy.executives.some(executive => executive.code.toLocaleLowerCase().includes(query) || executive.label.toLocaleLowerCase().includes(query) || executive.members.some(member => roleHierarchyMemberMatches(member, query)));
  const visibleDepartmentsFor = (departments: RoleHierarchyDepartment[]) => departments.map(department => filterRoleHierarchyDepartment(department, query)).filter((department): department is RoleHierarchyDepartment => Boolean(department));
  const scopedDepartments = (owner: RoleHierarchyDepartmentMeta["owner"], departments: RoleHierarchyDepartment[]) => focusedMeta
    ? focusedMeta.owner === owner ? [focusedMeta.department] : []
    : visibleDepartmentsFor(departments);
  const visibleCooDepartments = leadershipVisible && executiveExpanded(companyCooId) ? scopedDepartments("COO", coo.departments) : [];
  const visibleCpoDepartments = cpoVisible && executiveExpanded(companyCpoId) ? scopedDepartments("CPO", cpo.departments) : [];
  const visibleUnassignedDepartments = (query || unassignedExpanded || focusedMeta?.owner === "UNASSIGNED") ? scopedDepartments("UNASSIGNED", hierarchy.unassignedDepartments) : [];
  const branchesFor = (department: RoleHierarchyDepartment) => query || expandedDepartmentIds.has(department.id) ? department.branches : [];
  const branchEdges = (branch: RoleHierarchyBranch): CompanyRoleEdge[] => {
    const children = query || expandedBranchIds.has(branch.id) ? branch.children : [];
    return children.flatMap(child => [{ sourceId: branch.id, targetId: child.id }, ...branchEdges(child)]);
  };
  const departmentEdges = (sourceId: string, departments: RoleHierarchyDepartment[]) => departments.flatMap(department => {
    const branches = branchesFor(department);
    return [{ sourceId, targetId: department.id }, ...branches.flatMap(branch => [{ sourceId: department.id, targetId: branch.id }, ...branchEdges(branch)])];
  });
  const edges: CompanyRoleEdge[] = [
    ...(cpoVisible ? [{ sourceId: companyCooId, targetId: companyCpoId }] : []),
    ...departmentEdges(companyCooId, visibleCooDepartments),
    ...departmentEdges(companyCpoId, visibleCpoDepartments),
    ...(hierarchy.unassignedDepartments.length && (query || unassignedExpanded || focusedMeta?.owner === "UNASSIGNED") ? departmentEdges("company-unassigned", visibleUnassignedDepartments) : []),
  ];
  const signature = `${edges.map(edge => `${edge.sourceId}>${edge.targetId}`).join("|")}:${[...expandedBranchIds].sort().join("|")}`;
  const visibleDepartmentCount = visibleCooDepartments.length + visibleCpoDepartments.length + visibleUnassignedDepartments.length;
  const canvasMinWidth = Math.max(720, visibleDepartmentCount * 244 + Math.max(0, visibleDepartmentCount - 1) * 22);
  const [zoom, setZoom] = useState(1);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const zoomRef = useRef(1);
  const panRef = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null);
  const selectedPathIds = useMemo(() => {
    const path = new Set<string>();
    let currentId = selectedId ?? undefined;
    while (currentId && !path.has(currentId)) {
      path.add(currentId);
      currentId = branchMeta.parentById.get(currentId);
    }
    return path;
  }, [branchMeta.parentById, selectedId]);
  const selectedDirectReportIds = useMemo(() => {
    if (!selectedId) return new Set<string>();
    const branch = branchMeta.byId.get(selectedId);
    if (branch) return new Set(branch.children.map(child => child.id));
    const department = departmentMeta.find(item => item.department.id === selectedId)?.department;
    if (department) return new Set(department.branches.map(child => child.id));
    if (selectedId === companyCooId) return new Set([companyCpoId, ...coo.departments.map(item => item.id)]);
    if (selectedId === companyCpoId) return new Set(cpo.departments.map(item => item.id));
    if (selectedId === "company-unassigned") return new Set(hierarchy.unassignedDepartments.map(item => item.id));
    return new Set<string>();
  }, [branchMeta.byId, coo.departments, cpo.departments, departmentMeta, hierarchy.unassignedDepartments, selectedId]);

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
        const scale = zoomRef.current;
        const nextSize = { width: canvas.scrollWidth, height: canvas.scrollHeight };
        setCanvasSize(current => current.width === nextSize.width && current.height === nextSize.height ? current : nextSize);
        setConnectors(edges.flatMap(edge => {
          const source = nodeRefs.current.get(edge.sourceId);
          const target = nodeRefs.current.get(edge.targetId);
          if (!source || !target) return [];
          const sourceRect = source.getBoundingClientRect();
          const targetRect = target.getBoundingClientRect();
          const sourceX = (sourceRect.left + sourceRect.width / 2 - canvasRect.left) / scale;
          const sourceY = (sourceRect.bottom - canvasRect.top) / scale;
          const targetX = (targetRect.left + targetRect.width / 2 - canvasRect.left) / scale;
          const targetY = (targetRect.top - canvasRect.top) / scale;
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
        const top = viewport.scrollTop + focusedRect.top + focusedRect.height / 2 - viewportRect.top - viewport.clientHeight / 2;
        viewport.scrollTo({ left: Math.max(0, left), top: Math.max(0, top), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
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

  const setNodeRef = (id: string) => (node: HTMLElement | null) => {
    if (node) nodeRefs.current.set(id, node);
    else nodeRefs.current.delete(id);
  };
  const centerNode = (id: string) => {
    const node = nodeRefs.current.get(id);
    const viewport = viewportRef.current;
    if (!node || !viewport) return;
    const nodeRect = node.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    viewport.scrollTo({
      left: Math.max(0, viewport.scrollLeft + nodeRect.left + nodeRect.width / 2 - viewportRect.left - viewport.clientWidth / 2),
      top: Math.max(0, viewport.scrollTop + nodeRect.top + nodeRect.height / 2 - viewportRect.top - viewport.clientHeight / 2),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  };
  const changeZoom = (value: number, originX?: number, originY?: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const previous = zoomRef.current;
    const next = Math.min(companyRoleMaxZoom, Math.max(companyRoleMinZoom, Math.round(value * 100) / 100));
    if (next === previous) return;
    const x = originX ?? viewport.clientWidth / 2;
    const y = originY ?? viewport.clientHeight / 2;
    const contentX = (viewport.scrollLeft + x) / previous;
    const contentY = (viewport.scrollTop + y) / previous;
    zoomRef.current = next;
    setZoom(next);
    requestAnimationFrame(() => viewport.scrollTo({ left: Math.max(0, contentX * next - x), top: Math.max(0, contentY * next - y), behavior: "auto" }));
  };
  const fitHierarchy = () => {
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    if (!viewport || !canvas) return;
    const next = Math.min(1, (viewport.clientWidth - 28) / canvas.scrollWidth, (viewport.clientHeight - 28) / canvas.scrollHeight);
    changeZoom(next, 0, 0);
    requestAnimationFrame(() => viewport.scrollTo({ left: 0, top: 0, behavior: "auto" }));
  };
  const resetView = () => {
    zoomRef.current = 1;
    setZoom(1);
    setFocusId(companyCooId);
    requestAnimationFrame(() => centerNode(companyCooId));
  };
  const startPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as Element).closest("button, input, select, a, .company-role-canvas-controls")) return;
    const viewport = event.currentTarget;
    panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
    try { viewport.setPointerCapture(event.pointerId); } catch { /* Pointer capture is unavailable for synthetic/legacy pointer events. */ }
    setIsPanning(true);
    event.preventDefault();
  };
  const movePan = (event: React.PointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    event.currentTarget.scrollTo({ left: pan.left - (event.clientX - pan.x), top: pan.top - (event.clientY - pan.y), behavior: "auto" });
    event.preventDefault();
  };
  const endPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (panRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    panRef.current = null;
    setIsPanning(false);
  };
  const onCanvasKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const viewport = event.currentTarget;
    if (event.key === "+" || event.key === "=") changeZoom(zoomRef.current + companyRoleZoomStep);
    else if (event.key === "-") changeZoom(zoomRef.current - companyRoleZoomStep);
    else if (event.key === "0") resetView();
    else if (event.key.toLocaleLowerCase() === "f") fitHierarchy();
    else if (event.key.startsWith("Arrow")) viewport.scrollBy({ left: event.key === "ArrowLeft" ? -64 : event.key === "ArrowRight" ? 64 : 0, top: event.key === "ArrowUp" ? -64 : event.key === "ArrowDown" ? 64 : 0, behavior: "auto" });
    else return;
    event.preventDefault();
  };
  const selectAndCenter = (id: string) => {
    setSelectedId(id);
    setFocusId(id);
    requestAnimationFrame(() => centerNode(id));
  };
  const openAncestors = (id: string) => {
    const branchIds = new Set<string>();
    let currentId: string | undefined = id;
    while (currentId) {
      const parentId = branchMeta.parentById.get(currentId);
      if (!parentId) break;
      if (branchMeta.byId.has(parentId)) branchIds.add(parentId);
      currentId = parentId;
    }
    setExpandedBranchIds(current => new Set([...current, ...branchIds]));
  };
  const clearDescendants = () => {
    setExpandedDepartmentIds(new Set());
    setExpandedBranchIds(new Set());
  };
  const toggleExecutive = (id: string) => {
    selectAndCenter(id);
    setExpandedExecutiveIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleDepartment = (department: RoleHierarchyDepartment) => {
    selectAndCenter(department.id);
    setExpandedDepartmentIds(current => {
      const next = new Set(current);
      if (next.has(department.id)) {
        next.delete(department.id);
        const branchIds = new Set(flattenRoleHierarchyBranches(department.branches).map(branch => branch.id));
        setExpandedBranchIds(openBranches => new Set([...openBranches].filter(id => !branchIds.has(id))));
      } else next.add(department.id);
      return next;
    });
  };
  const toggleBranch = (branch: RoleHierarchyBranch) => {
    if (!branch.children.length) return;
    selectAndCenter(branch.id);
    setExpandedBranchIds(current => {
      const next = new Set(current);
      if (next.has(branch.id)) next.delete(branch.id);
      else next.add(branch.id);
      return next;
    });
  };
  const focusDepartment = (departmentId: string | null) => {
    const nextMeta = departmentId ? departmentMeta.find(item => item.department.id === departmentId) : undefined;
    searchOriginDepartmentId.current = null;
    setFocusedDepartmentId(departmentId);
    setSearch("");
    setSearchMatchIndex(0);
    setSelectedId(departmentId);
    if (departmentId) {
      if (nextMeta?.owner === "CPO") setExpandedExecutiveIds(new Set([companyCooId, companyCpoId]));
      else if (nextMeta?.owner === "COO") setExpandedExecutiveIds(current => new Set(current).add(companyCooId));
      else if (nextMeta?.owner === "UNASSIGNED") setUnassignedExpanded(true);
      setExpandedDepartmentIds(current => new Set(current).add(departmentId));
      setFocusId(departmentId);
      requestAnimationFrame(() => centerNode(departmentId));
    } else {
      setFocusId(companyCooId);
      setSelectedId(null);
    }
  };
  const expandAll = () => {
    searchOriginDepartmentId.current = null;
    setSearch("");
    setExpandedExecutiveIds(new Set([companyCooId, companyCpoId]));
    setExpandedDepartmentIds(new Set(allDepartments.map(department => department.id)));
    setExpandedBranchIds(new Set(allDepartments.flatMap(department => flattenRoleHierarchyBranches(department.branches).filter(branch => branch.children.length).map(branch => branch.id))));
    setUnassignedExpanded(true);
    setFocusId(companyCooId);
    setSelectedId(null);
  };
  const collapseAll = () => {
    searchOriginDepartmentId.current = null;
    setExpandedExecutiveIds(new Set([companyCooId]));
    setUnassignedExpanded(false);
    clearDescendants();
    setFocusId(companyCooId);
    setSelectedId(null);
  };
  const clearSearch = () => {
    const origin = searchOriginDepartmentId.current;
    setSearch("");
    setSearchMatchIndex(0);
    setFocusedDepartmentId(origin);
    searchOriginDepartmentId.current = null;
    setSelectedId(null);
    setFocusId(origin ?? companyCooId);
  };
  const showSearchMatch = (matches: RoleHierarchyBranch[], index: number) => {
    if (!matches.length) return;
    const nextIndex = (index + matches.length) % matches.length;
    const match = matches[nextIndex];
    const meta = branchMeta.departmentByBranchId.get(match.id);
    setSearchMatchIndex(nextIndex);
    if (meta) {
      setFocusedDepartmentId(meta.department.id);
      setExpandedDepartmentIds(current => new Set(current).add(meta.department.id));
      if (meta.owner === "CPO") setExpandedExecutiveIds(new Set([companyCooId, companyCpoId]));
      else if (meta.owner === "COO") setExpandedExecutiveIds(current => new Set(current).add(companyCooId));
      else setUnassignedExpanded(true);
    }
    openAncestors(match.id);
    selectAndCenter(match.id);
  };
  const onSearchChange = (value: string) => {
    const nextQuery = value.trim().toLocaleLowerCase();
    if (!query && nextQuery) searchOriginDepartmentId.current = focusedDepartmentId;
    if (!nextQuery) {
      clearSearch();
      return;
    }
    setSearch(value);
    setSearchMatchIndex(0);
    const match = branchMeta.branches.find(branch => roleHierarchyBranchMatches(branch, nextQuery));
    if (!match) {
      setSelectedId(null);
      setFocusedDepartmentId(null);
      return;
    }
    const meta = branchMeta.departmentByBranchId.get(match.id);
    if (meta) {
      setFocusedDepartmentId(meta.department.id);
      setExpandedDepartmentIds(current => new Set(current).add(meta.department.id));
      if (meta.owner === "CPO") setExpandedExecutiveIds(new Set([companyCooId, companyCpoId]));
      else if (meta.owner === "COO") setExpandedExecutiveIds(current => new Set(current).add(companyCooId));
      else setUnassignedExpanded(true);
    }
    openAncestors(match.id);
    selectAndCenter(match.id);
  };
  const selectedBreadcrumb = (() => {
    if (!selectedId && !focusedMeta) return [];
    const labels: string[] = [];
    const meta = selectedId
      ? branchMeta.departmentByBranchId.get(selectedId) ?? departmentMeta.find(item => item.department.id === selectedId) ?? focusedMeta
      : focusedMeta;
    if (!meta && selectedId === companyCooId) return ["COO"];
    if (!meta && selectedId === companyCpoId) return ["COO", "CPO"];
    if (meta?.owner === "CPO") labels.push("COO", "CPO");
    else if (meta?.owner === "COO") labels.push("COO");
    else if (meta?.owner === "UNASSIGNED") labels.push("Needs reporting assignment");
    if (meta) labels.push(meta.department.name);
    if (selectedId && branchMeta.byId.has(selectedId)) {
      const names: string[] = [];
      let currentId: string | undefined = selectedId;
      while (currentId && branchMeta.byId.has(currentId)) {
        names.unshift(branchMeta.byId.get(currentId)!.member.name);
        currentId = branchMeta.parentById.get(currentId);
      }
      labels.push(...names);
    }
    return labels;
  })();
  const executiveCard = (code: "COO" | "CPO", expanded: boolean, controls: string, onClick: () => void) => {
    const item = hierarchy.executives.find(executive => executive.code === code)!;
    const highlighted = selectedPathIds.has(item.id) || selectedDirectReportIds.has(item.id);
    return <button ref={setNodeRef(item.id)} type="button" className={`company-role-leadership company-role-leadership-${code.toLocaleLowerCase()}${expanded ? " expanded" : ""}${selectedId === item.id ? " selected" : ""}${selectedId && !highlighted ? " path-muted" : ""}${highlighted ? " path-active" : ""}`} aria-expanded={expanded} aria-controls={controls} onClick={onClick}>
      <span className="company-role-leadership-heading"><span><ShieldCheck size={18} aria-hidden="true" /> {code}</span><ChevronRight className="company-role-chevron" size={18} aria-hidden="true" /></span>
      <span className="company-role-executive"><small>EXECUTIVE LEADERSHIP</small><strong>{item.label}</strong><span>{item.members.length ? item.members.map(member => member.name).join(", ") : "Position not assigned"}</span><span>{item.departments.length} owned department{item.departments.length === 1 ? "" : "s"}</span></span>
    </button>;
  };
  const renderBranch = (branch: RoleHierarchyBranch): React.ReactNode => {
    const expandable = Boolean(branch.children.length);
    const expanded = expandable && (Boolean(query) || expandedBranchIds.has(branch.id));
    const highlighted = selectedPathIds.has(branch.id) || selectedDirectReportIds.has(branch.id);
    const roleBadges = branch.reportingRoles.length ? branch.reportingRoles : ["EMPLOYEE" as const];
    const contents = <><span className="company-role-node-icon"><Users size={17} aria-hidden="true" /></span><span className="company-role-card-copy"><strong>{branch.member.name}</strong><span className="company-role-role-badges">{roleBadges.map(role => <b className={`company-role-role-badge company-role-role-badge-${role.toLocaleLowerCase()}`} key={role}>{role === "LINE_MANAGER" ? "Line Manager" : role === "MANAGER" ? "Manager" : "Employee"}</b>)}</span><small>{branch.member.employeeCode} · {branch.member.designation}</small></span>{(branch.member.status === "On Leave" || expandable) && <span className="company-role-card-trailing">{branch.member.status === "On Leave" && <em>On leave</em>}{expandable && <span className="company-role-report-count">{branch.children.length}</span>}{expandable && <ChevronRight className="company-role-chevron" size={16} aria-hidden="true" />}</span>}</>;
    return <div className={`company-role-card-shell company-role-card-shell-${branch.code.toLocaleLowerCase()}`} key={branch.id}>
      {expandable
        ? <button ref={setNodeRef(branch.id)} type="button" className={`company-role-card company-role-card-${branch.code.toLocaleLowerCase()}${expanded ? " expanded" : ""}${selectedId === branch.id ? " selected" : ""}${selectedId && !highlighted ? " path-muted" : ""}${highlighted ? " path-active" : ""}`} aria-expanded={expanded} aria-controls={`${branch.id}-children`} aria-label={`${branch.member.name}, ${branch.label}, ${branch.member.employeeCode}, ${branch.member.designation}, ${branch.children.length} direct report${branch.children.length === 1 ? "" : "s"}`} onClick={() => toggleBranch(branch)}>{contents}</button>
        : <div ref={setNodeRef(branch.id)} className={`company-role-card company-role-card-${branch.code.toLocaleLowerCase()} company-role-card-leaf${selectedId === branch.id ? " selected" : ""}${selectedId && !highlighted ? " path-muted" : ""}${highlighted ? " path-active" : ""}`} role="listitem">{contents}</div>}
      {expanded && <div id={`${branch.id}-children`} className="company-role-branch-children">
        {branch.children.map(renderBranch)}
      </div>}
    </div>;
  };
  const renderDepartment = (department: RoleHierarchyDepartment) => {
    const expanded = Boolean(query) || expandedDepartmentIds.has(department.id);
    const branches = branchesFor(department);
    const meta = departmentMeta.find(item => item.department.id === department.id)!;
    const highlighted = selectedPathIds.has(department.id) || selectedDirectReportIds.has(department.id);
    return <section className="company-role-department-branch" aria-labelledby={`${department.id}-name`} key={department.id}>
      <div className={`company-role-department-shell${selectedId && !highlighted ? " path-muted" : ""}${highlighted ? " path-active" : ""}`}>
        <button ref={setNodeRef(department.id)} type="button" className={`company-role-department${expanded ? " expanded" : ""}${selectedId === department.id ? " selected" : ""}`} aria-expanded={expanded} aria-controls={`${department.id}-branches`} onClick={() => toggleDepartment(department)}>
          <span className="company-role-node-icon"><Building2 size={18} aria-hidden="true" /></span><span><strong id={`${department.id}-name`}>{department.name}</strong><small>{department.memberCount} {department.memberCount === 1 ? "person" : "people"} · {department.branches.length} direct report{department.branches.length === 1 ? "" : "s"}</small><small>{meta.owner === "UNASSIGNED" ? "Needs assignment" : `Reports to ${meta.owner}`}</small></span><ChevronRight className="company-role-chevron" size={17} aria-hidden="true" />
        </button>
        {focusedDepartmentId !== department.id && <button type="button" className="company-role-department-focus" aria-label={`Focus ${department.name} department`} onClick={() => focusDepartment(department.id)}><Crosshair size={14} aria-hidden="true" /> Focus</button>}
      </div>
      {expanded && <div id={`${department.id}-branches`} className="company-role-cards" role="list" aria-label={`${department.name} reporting branches`}>{branches.map(renderBranch)}</div>}
    </section>;
  };
  const visibleSearchContent = executiveMatches || visibleDepartmentCount > 0;
  const unassignedPeople = hierarchy.unassignedDepartments.reduce((total, department) => total + department.memberCount, 0);

  return <div className={`company-role-hierarchy${focusedMeta ? " company-role-hierarchy-focused" : ""}${selectedId ? " company-role-hierarchy-has-selection" : ""}`} role="group" aria-label="Company role hierarchy" onKeyDown={event => {
    if (event.key !== "Escape") return;
    if (query) clearSearch();
    else if (focusedDepartmentId) focusDepartment(null);
  }}>
    <div className="company-role-summary" aria-label="Role hierarchy summary">
      <span><strong>{hierarchy.activeEmployees.length}</strong> people</span>
      <span><strong>{hierarchy.departmentCount}</strong> departments</span>
      <span><strong>{hierarchy.managerCount}</strong> managers</span>
      <span><strong>{hierarchy.lineManagerCount}</strong> line managers</span>
      <span className={unassignedPeople ? "warning" : ""}><strong>{unassignedPeople}</strong> need assignment</span>
    </div>
    <div className="company-role-toolbar">
      <div className="company-role-search"><Search size={17} aria-hidden="true" /><input type="search" aria-label="Find a department, reporting role, or employee" value={search} placeholder="Find department, manager, or employee" onChange={event => onSearchChange(event.target.value)} />{query && <button type="button" aria-label="Clear role hierarchy search" onClick={clearSearch}><X size={15} aria-hidden="true" /></button>}</div>
      <label className="company-role-department-jump"><span className="sr-only">Jump to department</span><select value={focusedDepartmentId ?? ""} onChange={event => focusDepartment(event.target.value || null)}><option value="">Company overview</option><optgroup label="Reports directly to COO">{coo.departments.map(department => <option value={department.id} key={department.id}>{department.name}</option>)}</optgroup><optgroup label="Reports through CPO">{cpo.departments.map(department => <option value={department.id} key={department.id}>{department.name}</option>)}</optgroup>{hierarchy.unassignedDepartments.length > 0 && <optgroup label="Needs reporting assignment">{hierarchy.unassignedDepartments.map(department => <option value={department.id} key={department.id}>{department.name}</option>)}</optgroup>}</select></label>
      <span className="company-role-match-count" aria-live="polite">{query ? `${searchMatches.length} matching ${searchMatches.length === 1 ? "person" : "people"}${executiveMatches ? " · executive match" : ""}` : focusedMeta ? `Focused on ${focusedMeta.department.name}` : `${hierarchy.departmentCount} departments`}</span>
      {query && searchMatches.length > 0 && <div className="company-role-search-navigation" role="group" aria-label="Search result navigation"><button type="button" aria-label="Previous role hierarchy result" onClick={() => showSearchMatch(searchMatches, searchMatchIndex - 1)}><ChevronLeft size={16} aria-hidden="true" /></button><span>{searchMatchIndex + 1} of {searchMatches.length}</span><button type="button" aria-label="Next role hierarchy result" onClick={() => showSearchMatch(searchMatches, searchMatchIndex + 1)}><ChevronRight size={16} aria-hidden="true" /></button></div>}
      <div className="company-role-actions">{focusedDepartmentId && <button type="button" onClick={() => focusDepartment(null)}><ArrowLeft size={16} aria-hidden="true" /> Overview</button>}<button type="button" onClick={expandAll}>Expand all</button><button type="button" onClick={collapseAll}>Collapse all</button><button type="button" className="primary" onClick={onExportPdf}><Download size={16} aria-hidden="true" /> Export PDF</button></div>
    </div>
    {selectedBreadcrumb.length > 0 && <nav className="company-role-breadcrumb" aria-label="Selected reporting path">{selectedBreadcrumb.map((label, index) => <span key={`${label}-${index}`}>{index > 0 && <ChevronRight size={13} aria-hidden="true" />}{label}</span>)}</nav>}
    <div className="company-role-legend"><span><i className="leadership" /> Executive</span><span><i className="department" /> Department</span><span><i className="manager" /> Manager</span><span><i className="line-manager" /> Line Manager</span><span><i className="employee" /> Employee</span><span><i className="selected-path" /> Selected path</span></div>
    <p className="sr-only" id="company-role-canvas-help">Drag empty canvas space to move. Use the controls or plus and minus keys to zoom, arrow keys to pan, F to fit, and zero to reset.</p>
    <div className={`role-flowchart-viewport company-role-viewport${isPanning ? " is-panning" : ""}`} ref={viewportRef} tabIndex={0} role="region" aria-label="Interactive role hierarchy canvas" aria-describedby="company-role-canvas-help" onPointerDown={startPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan} onKeyDown={onCanvasKeyDown} onWheel={event => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      changeZoom(zoomRef.current + (event.deltaY < 0 ? companyRoleZoomStep : -companyRoleZoomStep), event.clientX - rect.left, event.clientY - rect.top);
    }}>
      <div className="company-role-canvas-controls" role="group" aria-label="Canvas navigation controls">
        <span className="company-role-pan-hint"><Move size={15} aria-hidden="true" /> Drag to move</span>
        <button type="button" aria-label="Zoom out role hierarchy" title="Zoom out (-)" disabled={zoom <= companyRoleMinZoom} onClick={() => changeZoom(zoomRef.current - companyRoleZoomStep)}><Minus size={16} aria-hidden="true" /></button>
        <output className="company-role-zoom-value" aria-live="polite">{Math.round(zoom * 100)}%</output>
        <button type="button" aria-label="Zoom in role hierarchy" title="Zoom in (+)" disabled={zoom >= companyRoleMaxZoom} onClick={() => changeZoom(zoomRef.current + companyRoleZoomStep)}><Plus size={16} aria-hidden="true" /></button>
        <button type="button" aria-label="Fit role hierarchy in view" title="Fit hierarchy (F)" onClick={fitHierarchy}><Maximize2 size={16} aria-hidden="true" /></button>
        <button type="button" aria-label="Center selected hierarchy item" title="Center selected" onClick={() => centerNode(selectedId ?? focusId)}><Crosshair size={16} aria-hidden="true" /></button>
        <button type="button" aria-label="Reset role hierarchy view" title="Reset view (0)" onClick={resetView}><RotateCcw size={16} aria-hidden="true" /></button>
      </div>
      <div className="company-role-stage" data-zoom={zoom} style={{ width: canvasSize.width ? `${canvasSize.width * zoom}px` : "100%", height: canvasSize.height ? `${canvasSize.height * zoom}px` : "100%" }}>
      <div className="role-flowchart-canvas company-role-canvas" id="company-role-hierarchy-flowchart" ref={canvasRef} style={{ minWidth: `${canvasMinWidth}px`, transform: `scale(${zoom})` }}>
        <svg className="role-flowchart-connectors" aria-hidden="true">
          <defs><marker id="company-role-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z" /></marker></defs>
          {connectors.map(connector => {
            const pathActive = selectedPathIds.has(connector.sourceId) && selectedPathIds.has(connector.targetId);
            const directActive = connector.sourceId === selectedId && selectedDirectReportIds.has(connector.targetId);
            return <path className={`role-flowchart-line${pathActive ? " path-active" : ""}${directActive ? " direct-active" : ""}${selectedId && !pathActive && !directActive ? " path-muted" : ""}`} data-source-id={connector.sourceId} data-target-id={connector.targetId} pathLength="1" d={connector.path} markerEnd="url(#company-role-arrow)" key={`${connector.sourceId}-${connector.targetId}`} />;
          })}
        </svg>
        {leadershipVisible && <><div className="role-flowchart-level role-flowchart-root-level">{executiveCard("COO", executiveExpanded(companyCooId), "company-role-coo-children", () => toggleExecutive(companyCooId))}</div>
        {executiveExpanded(companyCooId) && <div id="company-role-coo-children" className="company-role-executive-children">
          {cpoVisible && <div className="company-role-owned-lane company-role-executive-subtree"><span className="company-role-lane-label">Reports through CPO</span><div className="role-flowchart-level">{executiveCard("CPO", executiveExpanded(companyCpoId), "company-role-cpo-departments", () => toggleExecutive(companyCpoId))}</div>{executiveExpanded(companyCpoId) && <div id="company-role-cpo-departments" className="company-role-departments" role="group" aria-label="CPO departments">{visibleCpoDepartments.map(renderDepartment)}</div>}</div>}
          {visibleCooDepartments.length > 0 && <div className="company-role-owned-lane"><span className="company-role-lane-label">Reports directly to COO</span><div className="company-role-departments" role="group" aria-label="COO departments">{visibleCooDepartments.map(renderDepartment)}</div></div>}
        </div>}</>}
        {hierarchy.unassignedDepartments.length > 0 && (!focusedMeta || focusedMeta.owner === "UNASSIGNED") && <div className="company-role-unassigned-subtree">
          <button ref={setNodeRef("company-unassigned")} type="button" className={`company-role-unassigned${unassignedExpanded || query || focusedMeta?.owner === "UNASSIGNED" ? " expanded" : ""}${selectedId === "company-unassigned" ? " selected" : ""}${selectedPathIds.has("company-unassigned") ? " path-active" : ""}${selectedId && !selectedPathIds.has("company-unassigned") ? " path-muted" : ""}`} aria-expanded={Boolean(query) || unassignedExpanded || focusedMeta?.owner === "UNASSIGNED"} aria-controls="company-role-unassigned-departments" onClick={() => { selectAndCenter("company-unassigned"); setUnassignedExpanded(current => !current); }}><span><Users size={17} aria-hidden="true" /><strong>Needs reporting assignment</strong></span><small>{unassignedPeople} people without a valid active reporting reference</small><ChevronRight className="company-role-chevron" size={17} aria-hidden="true" /></button>
          {(query || unassignedExpanded || focusedMeta?.owner === "UNASSIGNED") && <div id="company-role-unassigned-departments" className="company-role-departments" role="group" aria-label="Unassigned reporting departments">{visibleUnassignedDepartments.map(renderDepartment)}</div>}
        </div>}
        {hierarchy.activeEmployees.length === hierarchy.executives.reduce((total, executive) => total + executive.members.length, 0) && <div className="role-flowchart-empty">No active employees are available below executive leadership.</div>}
        {query && !visibleSearchContent && <div className="role-flowchart-empty"><Search size={18} aria-hidden="true" /> No departments, reporting relationships, or employees match “{search.trim()}”.</div>}
      </div>
      </div>
    </div>
  </div>;
}
