import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiList, hasPermission, type BackendSession } from "../api";

type Permission = { id: string; code: string; displayName?: string; category: string; isProtected: boolean; isDeprecated: boolean };
type Role = { id: string; code: string; displayName: string; version: number; isBuiltIn: boolean; isActive: boolean; protection: "STANDARD" | "PROTECTED" | "SUPER_ADMIN"; inherits: string[]; permissions?: Array<{ permission: Permission }> };
type User = { id: string; email: string; isActive: boolean; localLoginEnabled: boolean; microsoftLoginEnabled: boolean; roles: Array<{ role: Role }> };

const key = (session: BackendSession, value: string) => [value, session.sessionId, session.authorizationVersion] as const;

export function hierarchyUserParams(search: string, roleId: string) {
  const params = new URLSearchParams();
  if (search.trim()) params.set("search", search.trim());
  if (roleId) params.set("roleId", roleId);
  return params;
}

export function HierarchyPage({ session }: { session: BackendSession }) {
  const [search, setSearch] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const params = hierarchyUserParams(search, selectedRoleId);
  const roles = useQuery({ queryKey: key(session, "hierarchy-roles"), queryFn: () => apiList<Role>("/system/roles"), enabled: hasPermission(session, "role.read") });
  const users = useQuery({ queryKey: [...key(session, "hierarchy-users"), params.toString()], queryFn: () => apiList<User>(`/system/users?${params}`), enabled: hasPermission(session, "user.read") });
  const selectedRole = roles.data?.find(role => role.id === selectedRoleId);

  return <section className="stack">
    <div className="panel">
      <div className="panel-head"><div><h3>Role hierarchy</h3><span>Explore inherited access and find the users assigned to each branch.</span></div></div>
      {roles.isPending ? <p className="muted">Loading role hierarchy…</p> : roles.isError ? <p className="sync-alert">{roles.error.message}</p> : <RoleBranchFilter roles={roles.data ?? []} selectedRoleId={selectedRoleId} onSelect={setSelectedRoleId} />}
    </div>
    <div className="panel">
      <div className="panel-head"><div><h3>Users in this hierarchy</h3><span>Search by name or email, then narrow the results by role.</span></div></div>
      <div className="system-user-filters"><label>Find users<input type="search" value={search} placeholder="Name or email" onChange={event => setSearch(event.target.value)} /></label>{(search || selectedRoleId) && <button type="button" onClick={() => { setSearch(""); setSelectedRoleId(""); }}>Clear filters</button>}</div>
      <p className="muted system-user-filter-summary" aria-live="polite">{users.isPending ? "Finding users…" : `${users.data?.length ?? 0} user${users.data?.length === 1 ? "" : "s"} found${selectedRole ? ` with ${selectedRole.displayName}` : ""}.`}</p>
      {users.isError ? <p className="sync-alert">{users.error.message}</p> : <div className="table-wrap"><table><thead><tr><th>User</th><th>Roles</th><th>Status</th></tr></thead><tbody>{users.data?.map(user => <tr key={user.id}><td>{user.email}</td><td>{user.roles.map(item => item.role.displayName).join(", ") || "No role"}</td><td>{user.isActive ? "Active" : "Disabled"}</td></tr>)}{!users.isPending && !users.data?.length && <tr><td colSpan={3} className="system-user-empty">No users match these filters.</td></tr>}</tbody></table></div>}
    </div>
  </section>;
}

export function RoleBranchFilter({ roles, selectedRoleId, onSelect }: { roles: Role[]; selectedRoleId: string; onSelect: (roleId: string) => void }) {
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
    {custom.length > 0 && <div className="role-branch-custom" role="group" aria-label="Custom roles"><span>Custom roles</span>{custom.map(role => <button type="button" className={`role-branch-node${selectedRoleId === role.id ? " selected" : ""}`} aria-label={`Filter users by ${role.displayName} role`} aria-pressed={selectedRoleId === role.id} key={role.id} onClick={() => onSelect(selectedRoleId === role.id ? "" : role.id)}><strong>{role.displayName}</strong><span>{role.code.replaceAll("_", " ")}</span></button>)}</div>}
  </div>;
}
