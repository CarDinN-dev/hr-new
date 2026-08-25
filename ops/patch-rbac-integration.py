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
  assert.deepEqual(ownPayslips.data, []);

  assert.equal((await api('/system/users', {}, sessions.EMPLOYEE)).status, 403);
"""
if old not in text:
    raise SystemExit("Integration insertion anchor not found")
text = text.replace(old, new, 1)

old = """  const unpublishedPayslips = await api('/payroll/payslips/me?year=2098&month=6', {}, sessions.EMPLOYEE);
  assert.equal(unpublishedPayslips.status, 403, JSON.stringify(unpublishedPayslips.payload));
"""
new = """  const unpublishedPayslips = await api('/payroll/payslips/me?year=2098&month=6', {}, sessions.EMPLOYEE);
  assert.equal(unpublishedPayslips.status, 200, JSON.stringify(unpublishedPayslips.payload));
  assert.deepEqual(unpublishedPayslips.data, []);
"""
if old not in text:
    raise SystemExit("Unpublished payslip assertion anchor not found")
text = text.replace(old, new, 1)

old = """  const myPayslips = await api('/payroll/payslips/me?year=2098&month=6', {}, sessions.EMPLOYEE);
  assert.equal(myPayslips.status, 403);
  const hrPayslips = await api('/payroll/payslips?year=2098&month=6', {}, sessions.HR);
  assert.equal(hrPayslips.status, 200);
  assert.equal(hrPayslips.data.length, 1);
  const payslipDownload = await api(`/payroll/payslips/${hrPayslips.data[0].id}/download`, {}, sessions.HR);
  assert.equal(payslipDownload.status, 200);
  assert.equal(payslipDownload.buffer.subarray(0, 4).toString(), '%PDF');
"""
new = """  const myPayslips = await api('/payroll/payslips/me?year=2098&month=6', {}, sessions.EMPLOYEE);
  assert.equal(myPayslips.status, 200, JSON.stringify(myPayslips.payload));
  assert.equal(myPayslips.data.length, 1);
  assert.equal(myPayslips.data[0].employeeId, sessions.EMPLOYEE.user.employeeId);
  const employeePayslipDownload = await api(`/payroll/payslips/${myPayslips.data[0].id}/download`, {}, sessions.EMPLOYEE);
  assert.equal(employeePayslipDownload.status, 200);
  assert.equal(employeePayslipDownload.buffer.subarray(0, 4).toString(), '%PDF');
  const hrPayslips = await api('/payroll/payslips?year=2098&month=6', {}, sessions.HR);
  assert.equal(hrPayslips.status, 200);
  assert.equal(hrPayslips.data.length, 1);
  const payslipDownload = await api(`/payroll/payslips/${hrPayslips.data[0].id}/download`, {}, sessions.HR);
  assert.equal(payslipDownload.status, 200);
  assert.equal(payslipDownload.buffer.subarray(0, 4).toString(), '%PDF');
"""
if old not in text:
    raise SystemExit("Published payslip assertion anchor not found")
text = text.replace(old, new, 1)

path.write_text(text, encoding="utf-8")
