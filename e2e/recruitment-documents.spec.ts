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
  let assessmentLeaseToken = "";
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
    if (/^\/recruitment\/candidates\/[^/]+\/interview-assessment\/lease$/.test(path)) {
      const editorToken = request.postDataJSON().editorToken;
      if (request.method() === "POST") {
        if (assessmentLeaseToken && assessmentLeaseToken !== editorToken) return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ success: false, message: "Assessment is being edited by Recruitment HR" }) });
        assessmentLeaseToken = editorToken;
      }
      if (request.method() === "DELETE" && assessmentLeaseToken === editorToken) assessmentLeaseToken = "";
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(envelope({ ...candidates[0], version: 1 })) });
    }
    if (/^\/recruitment\/candidates\/[^/]+\/interview-assessment$/.test(path) && request.method() === "PATCH") {
      const assessment = request.postDataJSON().interviewAssessment;
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(envelope({ ...candidates[0], version: 2, rating: assessment.overallRating || 0, interviewAssessment: { ...candidates[0].interviewAssessment, ...assessment } })) });
    }
    if (/^\/recruitment\/candidates\/[^/]+$/.test(path) && request.method() === "PATCH") {
      const offerDetails = request.postDataJSON().offerDetails;
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(envelope({ ...candidates[1], offerDetails: { ...candidates[1].offerDetails, ...offerDetails } })) });
    }
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

  await page.getByRole("button", { name: "Open assessment", exact: true }).click();
  const assessment = page.getByRole("dialog", { name: "Interview assessment" });
  await expect(assessment.getByLabel("Candidate name")).toHaveValue("Amina Saleh");
  await expect(assessment.getByLabel("Vacancy title")).toHaveValue(job.title);
  await expect(assessment.getByLabel("Department", { exact: true })).toHaveValue(job.department.name);
  await expect(assessment.getByLabel("Interview date")).toHaveValue("2026-08-06");
  const assessmentSave = page.waitForRequest(request => request.url().endsWith("/api/v1/recruitment/candidates/candidate-interview/interview-assessment") && request.method() === "PATCH");
  await assessment.getByLabel("Interviewer comments").fill("Recommended for offer review.");
  expect((await assessmentSave).postDataJSON()).toMatchObject({ interviewAssessment: { interviewerComments: "Recommended for offer review." } });
  await expect(assessment.getByText("Saved", { exact: true })).toBeVisible();
  await expect(assessment.getByRole("button", { name: /save now|retry save|reload latest/i })).toHaveCount(0);
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
  expect((await offerSave).postDataJSON()).toMatchObject({ offerDetails: { otherAllowance: 750.75 } });
  await expect(offer.getByText("Saved", { exact: true })).toBeVisible();
  await expect(offer.getByRole("button", { name: /save offer details|retry save|reload latest/i })).toHaveCount(0);

  for (const [button, endpoint] of [["Assessment PDF", "interview-assessment"], ["Offer Letter PDF", "offer-letter"], ["NDA PDF", "nda"]] as const) {
    const requested = page.waitForRequest(request => request.url().endsWith(`/api/v1/recruitment/candidates/candidate-offer/${endpoint}.pdf`));
    const download = page.waitForEvent("download");
    await offer.getByRole("button", { name: button }).click();
    await requested;
    await expect((await download).suggestedFilename()).toBe(`${endpoint}.pdf`);
  }
});

test("recruitment keeps editors on demand and groups secondary actions", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installApi(page);
  await page.goto("/recruitment");

  await expect(page.getByLabel("Job title *")).toHaveCount(0);
  const addJob = page.getByRole("button", { name: "Add job" });
  await expect(addJob).toBeVisible();
  expect((await addJob.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await addJob.click();
  await page.getByRole("button", { name: "Add opening" }).click();
  const jobTitleError = page.locator("#recruitment-job-title-error");
  await expect(jobTitleError).toBeVisible();
  await page.getByLabel("Job title *").fill("Temporary vacancy");
  await expect(jobTitleError).toHaveCount(0);
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Cancel", exact: true }).first().click();
  await expect(page.getByLabel("Job title *")).toHaveCount(0);

  const jobRow = page.getByRole("region", { name: "Job openings" }).getByRole("row").filter({ hasText: job.title });
  await jobRow.locator("summary").click();
  await expect(jobRow.getByRole("button", { name: "Edit opening" })).toBeVisible();
  await expect(jobRow.getByRole("button", { name: "Delete opening" })).toBeVisible();

  const candidateCard = page.locator(".candidate-card").filter({ hasText: "Amina Saleh" });
  await candidateCard.locator("summary").click();
  await expect(candidateCard.getByRole("button", { name: "Edit candidate" })).toBeVisible();
  await expect(candidateCard.getByRole("button", { name: "Delete candidate" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("assessment autosaves on blur and releases its edit lease when closed", async ({ page }) => {
  await installApi(page);
  await page.goto("/recruitment");
  await page.getByRole("button", { name: "Open assessment", exact: true }).click();
  const assessment = page.getByRole("dialog", { name: "Interview assessment" });
  const autoSave = page.waitForRequest(request => request.url().endsWith("/api/v1/recruitment/candidates/candidate-interview/interview-assessment") && request.method() === "PATCH");
  await assessment.getByLabel("Interviewer comments").fill("Autosaved on blur.");
  await assessment.getByLabel("Venue").focus();
  expect((await autoSave).postDataJSON()).toMatchObject({ interviewAssessment: { interviewerComments: "Autosaved on blur." } });
  const release = page.waitForRequest(request => request.url().endsWith("/api/v1/recruitment/candidates/candidate-interview/interview-assessment/lease") && request.method() === "DELETE");
  await assessment.getByRole("button", { name: "Close", exact: true }).click();
  await release;
});

test("assessment reuses its edit lease after a page refresh", async ({ page }) => {
  await installApi(page);
  await page.goto("/recruitment");
  const firstLease = page.waitForRequest(request => request.url().endsWith("/api/v1/recruitment/candidates/candidate-interview/interview-assessment/lease") && request.method() === "POST");
  await page.getByRole("button", { name: "Open assessment", exact: true }).click();
  const firstToken = (await firstLease).postDataJSON().editorToken;

  await page.reload();
  const refreshedLease = page.waitForRequest(request => request.url().endsWith("/api/v1/recruitment/candidates/candidate-interview/interview-assessment/lease") && request.method() === "POST");
  await page.getByRole("button", { name: "Open assessment", exact: true }).click();
  expect((await refreshedLease).postDataJSON().editorToken).toBe(firstToken);
  await expect(page.getByRole("dialog", { name: "Interview assessment" })).toBeVisible();
});

test("interview assessment stays aligned and actionable across screen sizes", async ({ page }) => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await installApi(page);
    await page.goto("/recruitment");
    await page.getByRole("button", { name: "Open assessment", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: "Interview assessment" });
    const modal = dialog.locator(".modal");
    const actions = dialog.locator(".modal-actions");
    const [dialogBox, actionBox] = await Promise.all([dialog.boundingBox(), actions.boundingBox()]);
    expect(dialogBox).not.toBeNull();
    expect(actionBox).not.toBeNull();
    expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(dialogBox!.y).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(dialogBox!.y + dialogBox!.height + 1);
    expect(await modal.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    if (viewport.width >= 1024) expect(dialogBox!.width).toBeGreaterThanOrEqual(940);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
  }
});
