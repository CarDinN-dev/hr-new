import { expect, test, type Page } from "@playwright/test";

function envelope(data: unknown) { return { success: true, data }; }

async function installDocumentsApi(page: Page) {
  const employee = { id: "employee-1", employeeCode: "EMP-001", firstName: "Noor", lastName: "Ahmed", email: "noor@example.invalid" };
  const user = { id: "employee-user", email: employee.email, displayName: "Noor Ahmed", roles: ["EMPLOYEE"], permissions: ["session.self.read", "employee.self.read", "document.self.read", "service_request.self.read", "service_request.self.create", "service_request.self.cancel", "service_request.self.download", "payroll.self.read_payslip"], departmentScopeIds: [], sessionId: "employee-session", authProvider: "local", authorizationVersion: 1, employeeId: employee.id };
  await page.route("**/api/v1/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(envelope(data)) });
    if (path === "/auth/me") return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ success: false, message: "Not signed in" }) });
    if (path === "/auth/login") return json({ csrfToken: "csrf-token", user }, 201);
    if (path === "/employees/me") return json({ ...employee, phone: "", hireDate: "2022-01-01", employmentStatus: "ACTIVE", department: { id: "department-1", name: "Service", code: "SERVICE" }, position: { title: "Engineer", code: "ENGINEER" } });
    if (path === "/documents") return json([{ id: "document-1", documentType: "OFFER_LETTER", fileName: "offer.pdf", documentNumber: "DOC-000001", createdAt: "2026-08-07T00:00:00.000Z", scanStatus: "CLEAN", employee }]);
    if (path === "/service-requests") return json([]);
    if (path === "/payroll/payslips/me") return json([]);
    return json([]);
  });
}

test("Documents is the employee document home", async ({ page }) => {
  await installDocumentsApi(page);
  await page.goto("/");
  await page.getByLabel("Email").fill("noor@example.invalid");
  await page.getByLabel("Password").fill("IntegrationPass123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("link", { name: "Documents", exact: true })).toBeVisible();
  await expect(page.getByText("Certificates", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Documents", exact: true }).click();
  await expect(page.getByText("Document library", { exact: true })).toBeVisible();
  await expect(page.getByText("Certificates", { exact: true })).toBeVisible();
  await expect(page.getByText("Document Templates", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Offer Letter", { exact: true })).toBeVisible();
});
