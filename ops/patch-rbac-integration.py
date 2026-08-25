from pathlib import Path

path = Path("backend/scripts/integration-regression.js")
text = path.read_text(encoding="utf-8")
old = """  assert.equal((await api('/employees/me', {}, sessions.EMPLOYEE)).status, 200);
  assert.equal((await api('/system/users', {}, sessions.EMPLOYEE)).status, 403);
"""
new = """  assert.equal((await api('/employees/me', {}, sessions.EMPLOYEE)).status, 200);

  for (const role of ['EMPLOYEE', 'LINE_MANAGER', 'MANAGER']) {
    assert.equal((await api('/attendance?limit=10', {}, sessions[role])).status, 403, `${role} must not read attendance`);
    assert.equal((await api('/attendance/reports/summary?limit=10', {}, sessions[role])).status, 403, `${role} must not read attendance reports`);
    assert.equal((await api('/attendance/check-in', { method: 'POST', body: {} }, sessions[role])).status, 403, `${role} must not check in`);
    assert.equal((await api('/attendance/check-out', { method: 'POST', body: {} }, sessions[role])).status, 403, `${role} must not check out`);
    const identity = await api('/auth/me', {}, sessions[role]);
    assert.equal(identity.data.user.permissions.some((permission) => permission.startsWith('attendance.')), false, `${role} received an attendance grant`);
  }
  assert.equal((await api('/attendance?limit=10', {}, sessions.HR)).status, 200);
  const ownPayslips = await api('/payroll/payslips/me?limit=10', {}, sessions.EMPLOYEE);
  assert.equal(ownPayslips.status, 200, JSON.stringify(ownPayslips.payload));
  assert.equal(Array.isArray(ownPayslips.data), true);

  assert.equal((await api('/system/users', {}, sessions.EMPLOYEE)).status, 403);
"""
if old not in text:
    raise SystemExit("Integration insertion anchor not found")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
