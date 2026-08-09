import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FileText } from "lucide-react";
import { apiDownload, apiPage, hasAnyPermission, hasPermission, type BackendSession } from "../api";
import { displayMoney, displayTitle, saveDownload, workflowKey } from "./workflow-utils";
import { usePageSearch, usePageSearchStatus } from "../page-search";

type PaginationMeta = { total: number; page: number; limit: number; totalPages: number };
type EmployeeDocument = { id: string; documentType: string; fileName: string; documentNumber: string; createdAt: string; scanStatus: string; employee: { employeeCode: string; firstName: string; lastName: string } };
type Payslip = { id: string; year: number; month: number; grossPay: string; deductions: string; taxAmount: string; netPay: string; employee: { employeeCode: string; firstName: string; lastName: string } };

export function DocumentsLibraryPanel({ session, notify }: { session: BackendSession; notify: (message: string) => void }) {
  const { search } = usePageSearch();
  const [documentsPage, setDocumentsPage] = useState(1);
  const [payslipsPage, setPayslipsPage] = useState(1);
  const canReadPayslips = hasAnyPermission(session, "payroll.self.read_payslip", "payroll.payslip.read_all");
  useEffect(() => { setDocumentsPage(1); setPayslipsPage(1); }, [search]);
  const documents = useQuery({ queryKey: [...workflowKey(session, "documents-library", documentsPage), search], queryFn: () => apiPage<EmployeeDocument, PaginationMeta>(`/documents?page=${documentsPage}&limit=15${search ? `&search=${encodeURIComponent(search)}` : ""}`) });
  const payslips = useQuery({ queryKey: [...workflowKey(session, "documents-payslips", payslipsPage), search], queryFn: () => apiPage<Payslip, PaginationMeta>(`${hasPermission(session, "payroll.payslip.read_all") ? "/payroll/payslips" : "/payroll/payslips/me"}?page=${payslipsPage}&limit=15${search ? `&search=${encodeURIComponent(search)}` : ""}`), enabled: canReadPayslips });
  usePageSearchStatus("documents-library", { count: documents.data?.meta?.total, loading: documents.isFetching, error: documents.error?.message });
  usePageSearchStatus("document-payslips", { count: payslips.data?.meta?.total, loading: payslips.isFetching, error: payslips.error?.message });
  async function downloadDocument(id: string) { const file = await apiDownload(`/documents/${id}/content`); saveDownload(file.blob, file.fileName); }
  async function downloadPayslip(id: string) { const file = await apiDownload(`/payroll/payslips/${id}/download`); saveDownload(file.blob, file.fileName); }

  return <section className="stack">
    <div className="panel"><div className="panel-head"><div><h3>Document library</h3><span>Files available to you, including HR-issued documents.</span></div><FileText size={20} aria-hidden="true" /></div>
      {documents.isPending ? <p className="muted">Loading documents…</p> : documents.isError ? <p className="sync-alert">{documents.error.message}</p> : <><div className="table-wrap table-wide" role="region" aria-label="Document library" tabIndex={0}><span className="table-scroll-hint" aria-hidden="true">Scroll horizontally for more columns</span><table><thead><tr><th>Document</th><th>Employee</th><th>Issued</th><th>Status</th><th></th></tr></thead><tbody>{documents.data?.data.map(document => <tr key={document.id}><td><strong>{displayTitle(document.documentType)}</strong><small><br />{document.documentNumber} · {document.fileName}</small></td><td>{document.employee.employeeCode} — {document.employee.firstName} {document.employee.lastName}</td><td>{new Date(document.createdAt).toLocaleDateString()}</td><td><span className={`badge ${document.scanStatus === "CLEAN" ? "good" : document.scanStatus === "REJECTED" ? "bad" : "warn"}`}>{displayTitle(document.scanStatus)}</span></td><td><button disabled={document.scanStatus !== "CLEAN"} onClick={() => void downloadDocument(document.id).catch(error => notify(error.message))}><Download size={15} /> Download</button></td></tr>)}</tbody></table></div><Pagination meta={documents.data?.meta} loading={documents.isFetching} onPage={setDocumentsPage} label="documents" />{!documents.data?.data.length && <div className="empty">No documents are available yet.</div>}</>}
    </div>
    {canReadPayslips && <div className="panel"><div className="panel-head"><div><h3>{hasPermission(session, "payroll.payslip.read_all") ? "Payslips" : "My payslips"}</h3><span>Published payslips are available here.</span></div></div>
      {payslips.isPending ? <p className="muted">Loading payslips…</p> : payslips.isError ? <p className="sync-alert">{payslips.error.message}</p> : <><div className="table-wrap table-wide" role="region" aria-label="Payslips" tabIndex={0}><span className="table-scroll-hint" aria-hidden="true">Scroll horizontally for more columns</span><table><thead><tr><th>Period</th><th>Employee</th><th>Gross</th><th>Deductions</th><th>Net</th><th></th></tr></thead><tbody>{payslips.data?.data.map(item => <tr key={item.id}><td>{item.year}-{String(item.month).padStart(2, "0")}</td><td>{item.employee.employeeCode} — {item.employee.firstName} {item.employee.lastName}</td><td>{displayMoney(item.grossPay)}</td><td>{displayMoney(Number(item.deductions) + Number(item.taxAmount))}</td><td>{displayMoney(item.netPay)}</td><td><button onClick={() => void downloadPayslip(item.id).catch(error => notify(error.message))}><Download size={15} /> PDF</button></td></tr>)}</tbody></table></div><Pagination meta={payslips.data?.meta} loading={payslips.isFetching} onPage={setPayslipsPage} label="payslips" />{!payslips.data?.data.length && <div className="empty">No published payslips yet.</div>}</>}
    </div>}
  </section>;
}

function Pagination({ meta, loading, onPage, label }: { meta?: PaginationMeta; loading: boolean; onPage: (page: number) => void; label: string }) {
  const page = meta?.page ?? 1;
  const totalPages = meta?.totalPages ?? 1;
  return <div className="audit-pagination"><span className="muted" aria-live="polite">Page {page} of {totalPages} · {meta?.total ?? 0} {label}</span><div className="inline-controls"><button disabled={page <= 1 || loading} onClick={() => onPage(page - 1)}>Previous</button><button disabled={page >= totalPages || loading} onClick={() => onPage(page + 1)}>Next</button></div></div>;
}
