import { expect, test, type Page } from "@playwright/test";

const session = {
  id: "recruitment-user", email: "recruitment@example.invalid", displayName: "Recruitment HR", csrfToken: "csrf-token",
  roles: ["HR"], departmentScopeIds: [], sessionId: "recruitment-session", authProvider: "local", authorizationVersion: 1,
  permissions: ["session.self.read", "recruitment.read", "recruitment.manage"]
};

const job = {
  id: "job-1", version: 1, title: "Clinical Applications Specialist", department: { id: "dept-1", name: "Diagnostics & POCT" },
  openings: 1, status: "CLOSED", postedOn: "2026-08-01", description: "Clinical support"
};

const candidates = [
  {
    id: "candidate-interview", version: 1, jobId: job.id, name: "Amina Saleh", email: "amina@example.invalid", phone: "+974 5000 1000",
    stage: "INTERVIEW", rating: "0", notes: "", appliedOn: "2026-08-02",
    interviewAssessment: { date: "2026-08-06", hiringDepartment: job.department.name }
  },
  {
    id: "candidate-offer", version: 2, jobId: job.id, name: "Noor Ahmed", email: "noor@example.invalid", phone: "+974 5000 2000",
    stage: "OFFER", rating: "5", notes: "", appliedOn: "2026-08-01",
    interviewAssessment: { date: "2026-08-05", overallRating: 5 },
    offerDetails: { issueDate: "2026-08-06", basic: 10000, hra: 4000, conveyance: 1000, otherAllowance: 500, lineOfBusiness: job.department.name }
  },
  {
    id: "candidate-hired", version: 3, jobId: job.id, name: "Salem Driver", email: "salem@example.invalid", phone: "+974 5000 3000",
    stage: "HIRED", rating: "5", notes: "", appliedOn: "2026-07-30", employeeId: "employee-driver"
  }
];

function envelope(data: unknown) { return { success: true, data }; }

async function installApi(page: Page) {
  await page.addInitScript(value => sessionStorage.setItem("medtech-hr-erp-backend-session-v2", JSON.stringify(value)), session);
  await page.route("**/api/v1/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    if (path === "/recruitment/jobs") return route.fulfill({ contentType: "application/json", body: JSON.stringify(envelope([job])) });
    if (path === "/recruitment/candidates" && request.method() === "GET") return route.fulfill({ contentType: "application/json", body: JSON.stringify(envelope(candidates)) });
    if (/^\/recruitment\/candidates\/[^/]+\/(interview-assessment|offer-letter|nda)\.pdf$/.test(path)) {
      const name = path.split("/").at(-1) || "document.pdf";
      return route.fulfill({ contentType: "application/pdf", headers: { "content-disposition": `attachment; filename*=UTF-8''${name}` }, body: "%PDF-1.3\n%%EOF" });
    }
    if (/^\/recruitment\/candidates\/[^/]+$/.test(path) && request.method() === "PATCH") return route.fulfill({ contentType: "application/json", body: JSON.stringify(envelope({})) });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(envelope(path === "/organization-settings" ? null : [])) });
  });
}

test("recruitment stage editors auto-fill candidate data and expose exact PDF downloads", async ({ page }) => {
  await installApi(page);
  await page.goto("/recruitment");

  const jobRow = page.getByRole("region", { name: "Job openings" }).getByRole("row").filter({ hasText: job.title });
  await expect(jobRow.getByRole("cell").nth(3)).toHaveText("1");
  await expect(jobRow.getByRole("cell").nth(4)).toHaveText("0");
  await expect(jobRow).toContainText("Filled");
  await expect(page.locator(".settlement-preview").getByText("Remaining", { exact: true }).locator("..")).toContainText("0");

  await page.getByRole("button", { name: "Assessment", exact: true }).click();
  const assessment = page.getByRole("dialog", { name: "Interview assessment" });
  await expect(assessment.getByLabel("Candidate name")).toHaveValue("Amina Saleh");
  await expect(assessment.getByLabel("Vacancy title")).toHaveValue(job.title);
  await expect(assessment.getByLabel("Department", { exact: true })).toHaveValue(job.department.name);
  await expect(assessment.getByLabel("Interview date")).toHaveValue("2026-08-06");
  await assessment.getByLabel("Overall rating").selectOption("4");
  await assessment.getByLabel("Interviewer comments").fill("Recommended for offer review.");
  const assessmentSave = page.waitForRequest(request => request.url().endsWith("/api/v1/recruitment/candidates/candidate-interview") && request.method() === "PATCH");
  await assessment.getByRole("button", { name: "Save assessment" }).click();
  expect((await assessmentSave).postDataJSON()).toMatchObject({ interviewAssessment: { overallRating: 4, interviewerComments: "Recommended for offer review." } });
  const assessmentDownload = page.waitForEvent("download");
  await assessment.getByRole("button", { name: "Download PDF" }).click();
  await expect((await assessmentDownload).suggestedFilename()).toBe("interview-assessment.pdf");
  await assessment.getByRole("button", { name: "Close", exact: true }).click();

  await page.getByRole("button", { name: "Offer documents" }).click();
  const offer = page.getByRole("dialog", { name: "Offer stage documents" });
  await expect(offer.getByLabel("Candidate name")).toHaveValue("Noor Ahmed");
  await expect(offer.getByLabel("Line of Business")).toHaveValue(job.department.name);
  await offer.getByLabel("Other allowance").fill("750.75");
  await expect(offer.getByLabel("Contractual monthly pay")).toHaveValue("QAR 15,750.75");
  const offerSave = page.waitForRequest(request => request.url().endsWith("/api/v1/recruitment/candidates/candidate-offer") && request.method() === "PATCH");
  await offer.getByRole("button", { name: "Save offer details" }).click();
  expect((await offerSave).postDataJSON()).toMatchObject({ offerDetails: { basic: 10000, hra: 4000, conveyance: 1000, otherAllowance: 750.75 } });

  for (const [button, endpoint] of [["Assessment PDF", "interview-assessment"], ["Offer Letter PDF", "offer-letter"], ["NDA PDF", "nda"]] as const) {
    const requested = page.waitForRequest(request => request.url().endsWith(`/api/v1/recruitment/candidates/candidate-offer/${endpoint}.pdf`));
    const download = page.waitForEvent("download");
    await offer.getByRole("button", { name: button }).click();
    await requested;
    await expect((await download).suggestedFilename()).toBe(`${endpoint}.pdf`);
  }
});
