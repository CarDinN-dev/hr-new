import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Archive, ArrowLeft, Download, FileText, ImagePlus, Mail, Megaphone, Paperclip, Pencil, Trash2 } from "lucide-react";
import { apiBaseUrl, apiDownload, apiList, apiPage, apiRequest, hasPermission, type BackendSession } from "../api";
import { Dialog, useDialogCloseGuard } from "../dialog";
import { Pagination } from "../pagination";
import { displayDate, displayTitle, saveDownload, workflowKey } from "./workflow-utils";

type Notify = (message: string) => void;
type EmployeeSummary = { id: string; firstName: string; lastName: string };
type Department = { id: string; name: string };
type PageMeta = { total: number; page: number; limit: number; totalPages: number };
type ParagraphBlock = { id: string; type: "paragraph"; text: string };
type ImageBlock = { id: string; type: "image"; attachmentKey: string; altText: string };
type ContentBlock = ParagraphBlock | ImageBlock;
type Attachment = {
  id: string;
  uploadKey: string;
  kind: "INLINE_IMAGE" | "FILE";
  fileName: string;
  contentType: string;
  sizeBytes: number;
  altText?: string | null;
  sortOrder: number;
  scanStatus: string;
};
type Announcement = {
  id: string;
  title: string;
  content: string;
  contentBlocks?: ContentBlock[] | null;
  audienceRoleCodes: string[];
  departmentId?: string | null;
  department?: Department | null;
  createdBy: EmployeeSummary;
  publishedAt?: string | null;
  expiresAt?: string | null;
  isActive: boolean;
  emailEnabled: boolean;
  emailQueuedAt?: string | null;
  attachments: Attachment[];
};
type DeliveryStatus = { emailEnabled: boolean; queuedAt?: string | null; total: number; sent: number; pending: number; failed: number };
type EditorImage = ImageBlock & { attachmentId?: string; file?: File; previewUrl: string; sizeBytes: number };
type EditorBlock = ParagraphBlock | EditorImage;
type EditorFile = { uploadKey: string; attachmentId?: string; file?: File; fileName: string; sizeBytes: number };

const roles = ["EMPLOYEE", "LINE_MANAGER", "MANAGER", "HR", "CPO", "COO", "ADMIN"];
const imageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const fileTypes = new Set([
  "application/pdf", "image/jpeg", "image/png", "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
const inlineByteLimit = 2 * 1024 * 1024;

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return [...bytes].map((byte, index) => `${[4, 6, 8, 10].includes(index) ? "-" : ""}${byte.toString(16).padStart(2, "0")}`).join("");
}

function errorMessage(error: unknown) { return error instanceof Error ? error.message : "Something went wrong."; }
function attachmentUrl(announcementId: string, attachmentId: string) { return `${apiBaseUrl}/announcements/${announcementId}/attachments/${attachmentId}/download`; }
function localDateTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
function serialiseBlocks(blocks: EditorBlock[]): ContentBlock[] {
  return blocks.map(block => block.type === "paragraph"
    ? { id: block.id, type: "paragraph", text: block.text }
    : { id: block.id, type: "image", attachmentKey: block.attachmentKey, altText: block.altText.trim() });
}
function plainText(blocks: EditorBlock[]) { return blocks.filter((block): block is ParagraphBlock => block.type === "paragraph").map(block => block.text).join("\n\n").trim(); }
function normaliseBlocks(value?: Announcement): EditorBlock[] {
  const source = value?.contentBlocks?.length ? value.contentBlocks : [{ id: uuid(), type: "paragraph" as const, text: value?.content ?? "" }];
  const blocks = source.flatMap<EditorBlock>(block => {
    if (block.type === "paragraph") return [{ id: block.id || uuid(), type: "paragraph", text: String(block.text ?? "") }];
    if (block.type !== "image") return [];
    const attachment = value?.attachments.find(item => item.kind === "INLINE_IMAGE" && item.uploadKey === block.attachmentKey);
    if (!attachment || !value) return [];
    return [{ ...block, id: block.id || uuid(), altText: block.altText || attachment.altText || "", attachmentId: attachment.id, previewUrl: attachmentUrl(value.id, attachment.id), sizeBytes: attachment.sizeBytes }];
  });
  if (!blocks.length) return [{ id: uuid(), type: "paragraph", text: value?.content ?? "" }];
  if (blocks[0].type === "image") blocks.unshift({ id: uuid(), type: "paragraph", text: "" });
  if (blocks.at(-1)?.type === "image") blocks.push({ id: uuid(), type: "paragraph", text: "" });
  return blocks;
}

async function canvasBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("The picture could not be compressed.")), "image/webp", quality));
}

async function compressInlineImage(file: File) {
  if (!imageTypes.has(file.type)) throw new Error("Pictures must be JPEG, PNG or WebP.");
  if (file.size > 20 * 1024 * 1024) throw new Error("Choose a source picture under 20 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    if (!bitmap.width || !bitmap.height) throw new Error("The picture could not be decoded.");
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Picture processing is unavailable in this browser.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let blob = await canvasBlob(canvas, 0.82);
    if (blob.size > inlineByteLimit) blob = await canvasBlob(canvas, 0.65);
    if (blob.size > inlineByteLimit) throw new Error("This picture is still over 2 MB after compression. Choose a smaller picture.");
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "announcement-picture"}.webp`, { type: "image/webp", lastModified: Date.now() });
  } finally {
    bitmap.close();
  }
}

export function AnnouncementsPage({ session, notify }: { session: BackendSession; notify: Notify }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: state => state.location.pathname });
  const detailId = pathname.match(/^\/announcements\/([^/]+)\/?$/)?.[1];
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Announcement | "new" | null>(() => window.location.hash === "#new" ? "new" : null);
  const canManage = hasPermission(session, "announcement.manage");
  const announcements = useQuery({ queryKey: [...workflowKey(session, "announcements"), page], queryFn: () => apiPage<Announcement, PageMeta>(`/announcements?page=${page}&limit=20`), enabled: !detailId });
  const departments = useQuery({ queryKey: workflowKey(session, "announcement-departments"), queryFn: () => apiList<Department>("/departments"), enabled: canManage && !detailId });
  const archive = useMutation({
    mutationFn: (id: string) => apiRequest(`/announcements/${id}`, { method: "DELETE", csrfToken: session.csrfToken }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: workflowKey(session, "announcements") }); notify("Announcement archived."); },
    onError: error => notify(errorMessage(error)),
  });

  useEffect(() => {
    if (pathname === "/announcements" && window.location.hash === "#new" && canManage) setEditing("new");
  }, [canManage, pathname]);

  if (detailId) return <AnnouncementDetail id={detailId} session={session} notify={notify} canManage={canManage} />;

  return <div className="experience-page">
    <section className="feature-heading"><div><span className="eyebrow">Communication · Announcements</span><h2>Company news</h2><p>Pictures, secure files and scheduled updates for the right audience.</p></div>{canManage && <button className="primary" type="button" onClick={() => setEditing("new")}><Megaphone size={16} aria-hidden="true" /> New announcement</button>}</section>
    {announcements.isPending ? <PageState label="Loading announcements…" /> : announcements.isError ? <PageState error={announcements.error.message} /> : <div className="announcement-grid">{announcements.data?.data.map(item => <article className="announcement-card" key={item.id}>
      <div className="announcement-card__meta"><span className={`status-dot ${item.isActive ? "is-active" : ""}`} />{item.isActive ? (item.publishedAt && new Date(item.publishedAt) > new Date() ? "Scheduled" : "Published") : "Draft"}<span>·</span>{item.department?.name ?? "All departments"}</div>
      <h3>{item.title}</h3><p>{item.content}</p>
      <div className="announcement-card__delivery"><Mail size={14} aria-hidden="true" /> {item.emailQueuedAt ? "Email queued" : item.emailEnabled ? "Email enabled" : "Website only"}{item.attachments.length ? <span><Paperclip size={14} aria-hidden="true" /> {item.attachments.length}</span> : null}</div>
      <footer><button type="button" onClick={() => void navigate({ to: "/announcements/$announcementId", params: { announcementId: item.id } })}>Read announcement</button>{canManage && <div className="row-actions"><button type="button" onClick={() => setEditing(item)}><Pencil size={14} aria-hidden="true" /> Edit</button><button type="button" className="danger-outline" disabled={archive.isPending} onClick={() => window.confirm("Archive this announcement?") && archive.mutate(item.id)}><Archive size={14} aria-hidden="true" /> Archive</button></div>}</footer>
    </article>)}{!announcements.data?.data.length && <PageState label="No announcements are available." />}</div>}
    <Pagination total={announcements.data?.meta?.total ?? 0} page={page} limit={20} totalPages={announcements.data?.meta?.totalPages ?? 1} label="announcements" onPage={setPage} />
    {editing && <AnnouncementDialog value={editing === "new" ? undefined : editing} departments={departments.data ?? []} session={session} close={() => setEditing(null)} done={async message => { setEditing(null); await client.invalidateQueries({ queryKey: workflowKey(session, "announcements") }); notify(message); }} />}
  </div>;
}

function AnnouncementDetail({ id, session, notify, canManage }: { id: string; session: BackendSession; notify: Notify; canManage: boolean }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [downloading, setDownloading] = useState("");
  const [editing, setEditing] = useState(false);
  const announcement = useQuery({ queryKey: workflowKey(session, "announcement", id), queryFn: () => apiRequest<Announcement>(`/announcements/${id}`) });
  const delivery = useQuery({ queryKey: workflowKey(session, "announcement-delivery", id), queryFn: () => apiRequest<DeliveryStatus>(`/announcements/${id}/delivery-status`), enabled: canManage && Boolean(announcement.data) });
  const departments = useQuery({ queryKey: workflowKey(session, "announcement-departments"), queryFn: () => apiList<Department>("/departments"), enabled: canManage && editing });
  async function download(attachment: Attachment) {
    setDownloading(attachment.id);
    try { const file = await apiDownload(`/announcements/${id}/attachments/${attachment.id}/download`); saveDownload(file.blob, file.fileName); }
    catch (error) { notify(errorMessage(error)); }
    finally { setDownloading(""); }
  }
  if (announcement.isPending) return <PageState label="Loading announcement…" />;
  if (announcement.isError || !announcement.data) return <div className="announcement-detail-page"><button type="button" onClick={() => void navigate({ to: "/announcements" })}><ArrowLeft size={16} aria-hidden="true" /> Back to announcements</button><PageState error={announcement.error?.message ?? "Announcement not found."} /></div>;
  const item = announcement.data;
  const files = item.attachments.filter(attachment => attachment.kind === "FILE");
  return <div className="experience-page announcement-detail-page">
    <div className="announcement-detail-toolbar"><button type="button" onClick={() => void navigate({ to: "/announcements" })}><ArrowLeft size={16} aria-hidden="true" /> Back to announcements</button>{canManage && <button type="button" onClick={() => setEditing(true)}><Pencil size={15} aria-hidden="true" /> Edit</button>}</div>
    <article className="announcement-detail-card"><header><span className="eyebrow">{item.department?.name ?? "All departments"}{item.audienceRoleCodes.length ? ` · ${item.audienceRoleCodes.map(displayTitle).join(", ")}` : " · All authorized employees"}</span><h2>{item.title}</h2><p>Published by {item.createdBy.firstName} {item.createdBy.lastName}{item.publishedAt ? ` · ${displayDate(item.publishedAt)}` : ""}</p></header>
      <AnnouncementContent announcement={item} />
      {files.length > 0 && <section className="announcement-files" aria-labelledby="announcement-files-title"><h3 id="announcement-files-title">Attachments</h3>{files.map(file => <div className="announcement-file" key={file.id}><span><FileText size={18} aria-hidden="true" /><span><strong>{file.fileName}</strong><small>{formatBytes(file.sizeBytes)}</small></span></span><button type="button" disabled={downloading === file.id} onClick={() => void download(file)}><Download size={16} aria-hidden="true" /> {downloading === file.id ? "Downloading…" : "Download"}</button></div>)}</section>}
      {canManage && <footer className="announcement-delivery-status"><Mail size={17} aria-hidden="true" /><span>{delivery.isPending ? "Checking email delivery…" : delivery.isError ? "Email delivery status is unavailable." : delivery.data?.queuedAt ? `${delivery.data.sent} sent · ${delivery.data.pending} pending · ${delivery.data.failed} failed` : item.emailEnabled ? "Email will queue at publication time." : "Email disabled for this announcement."}</span></footer>}
    </article>
    {editing && <AnnouncementDialog value={item} departments={departments.data ?? []} session={session} close={() => setEditing(false)} done={async message => { setEditing(false); await Promise.all([client.invalidateQueries({ queryKey: workflowKey(session, "announcement", id) }), client.invalidateQueries({ queryKey: workflowKey(session, "announcements") })]); notify(message); }} />}
  </div>;
}

function AnnouncementContent({ announcement }: { announcement: Announcement }) {
  const blocks = announcement.contentBlocks?.length ? announcement.contentBlocks : [{ id: "legacy", type: "paragraph" as const, text: announcement.content }];
  return <div className="announcement-content">{blocks.map(block => block.type === "paragraph" ? <p key={block.id}>{block.text}</p> : (() => {
    const picture = announcement.attachments.find(item => item.kind === "INLINE_IMAGE" && item.uploadKey === block.attachmentKey);
    return picture ? <figure key={block.id}><img src={attachmentUrl(announcement.id, picture.id)} alt={block.altText} loading="lazy" /></figure> : null;
  })())}</div>;
}

function AnnouncementDialog({ value, departments, session, close, done }: { value?: Announcement; departments: Department[]; session: BackendSession; close: () => void; done: (message: string) => Promise<void> }) {
  const createdUrls = useRef(new Set<string>());
  const errorRef = useRef<HTMLParagraphElement>(null);
  const [blocks, setBlocks] = useState<EditorBlock[]>(() => normaliseBlocks(value));
  const [files, setFiles] = useState<EditorFile[]>(() => value?.attachments.filter(item => item.kind === "FILE").map(item => ({ uploadKey: item.uploadKey, attachmentId: item.id, fileName: item.fileName, sizeBytes: item.sizeBytes })) ?? []);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [draftId, setDraftId] = useState(value?.id ?? "");
  const [form, setForm] = useState({ title: value?.title ?? "", audienceRoles: value?.audienceRoleCodes ?? [] as string[], departmentId: value?.departmentId ?? "", publishedAt: localDateTime(value?.publishedAt), expiresAt: localDateTime(value?.expiresAt), emailEnabled: value?.emailEnabled ?? true });
  const [busy, setBusy] = useState(false);
  const [processingImages, setProcessingImages] = useState(false);
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState("");
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [retryPublish, setRetryPublish] = useState(false);
  const [focusBlockId, setFocusBlockId] = useState("");
  const locked = Boolean(value?.emailQueuedAt);
  const inlineCount = blocks.filter(block => block.type === "image").length;
  const inlineBytes = blocks.reduce((total, block) => total + (block.type === "image" ? block.sizeBytes : 0), 0);
  const hasMessage = plainText(blocks).length > 0;
  const validAltText = blocks.every(block => block.type === "paragraph" || block.altText.trim().length > 0);

  useDialogCloseGuard(() => !busy && (!changed || window.confirm("Discard unsaved announcement changes?")));
  useEffect(() => () => { for (const url of createdUrls.current) URL.revokeObjectURL(url); }, []);
  useEffect(() => {
    if (!focusBlockId) return;
    const textarea = document.querySelector<HTMLTextAreaElement>(`[data-announcement-block="${focusBlockId}"]`);
    textarea?.focus();
    textarea?.setSelectionRange(0, 0);
    setFocusBlockId("");
  }, [blocks, focusBlockId]);

  function fail(message: string) { setError(message); window.setTimeout(() => errorRef.current?.focus(), 0); }
  function updateForm<K extends keyof typeof form>(key: K, value: typeof form[K]) { setChanged(true); setForm(current => ({ ...current, [key]: value })); }
  function updateParagraph(id: string, text: string) { setChanged(true); setBlocks(current => current.map(block => block.id === id && block.type === "paragraph" ? { ...block, text } : block)); }

  async function insertImages(index: number, selectionStart: number, selectionEnd: number, selected: File[]) {
    if (locked) return fail("Pictures are locked because the announcement email is already queued.");
    if (!selected.length) return;
    if (inlineCount + selected.length > 5) return fail("Announcements support up to five inline pictures.");
    setProcessingImages(true); setError("");
    try {
      const prepared = [] as File[];
      for (const file of selected) prepared.push(await compressInlineImage(file));
      if (inlineBytes + prepared.reduce((total, file) => total + file.size, 0) > inlineByteLimit) throw new Error("Inline pictures must total 2 MB or less for reliable email delivery.");
      const current = blocks[index];
      if (!current || current.type !== "paragraph") return;
      const afterId = uuid();
      const images = prepared.map<EditorImage>(file => {
        const previewUrl = URL.createObjectURL(file); createdUrls.current.add(previewUrl);
        return { id: uuid(), type: "image", attachmentKey: uuid(), altText: "", file, previewUrl, sizeBytes: file.size };
      });
      setBlocks(existing => [...existing.slice(0, index), { ...current, text: current.text.slice(0, selectionStart) }, ...images, { id: afterId, type: "paragraph", text: current.text.slice(selectionEnd) }, ...existing.slice(index + 1)]);
      setChanged(true); setFocusBlockId(afterId);
    } catch (caught) { fail(errorMessage(caught)); }
    finally { setProcessingImages(false); }
  }

  function pastePicture(event: ClipboardEvent<HTMLTextAreaElement>, index: number) {
    const selected = Array.from(event.clipboardData.files).filter(file => file.type.startsWith("image/"));
    if (!selected.length) return;
    event.preventDefault();
    void insertImages(index, event.currentTarget.selectionStart, event.currentTarget.selectionEnd, selected);
  }

  function addPictures(selected: File[]) {
    const lastParagraph = [...blocks].map((block, index) => ({ block, index })).reverse().find(item => item.block.type === "paragraph");
    if (lastParagraph?.block.type === "paragraph") void insertImages(lastParagraph.index, lastParagraph.block.text.length, lastParagraph.block.text.length, selected);
  }

  function removePicture(index: number) {
    const target = blocks[index];
    if (target?.type !== "image" || locked) return;
    if (target.attachmentId) setRemovedIds(current => [...new Set([...current, target.attachmentId!])]);
    if (target.previewUrl.startsWith("blob:")) URL.revokeObjectURL(target.previewUrl);
    setBlocks(current => {
      const before = current[index - 1]; const after = current[index + 1];
      if (before?.type === "paragraph" && after?.type === "paragraph") return [...current.slice(0, index - 1), { ...before, text: before.text + after.text }, ...current.slice(index + 2)];
      const next = current.filter((_, itemIndex) => itemIndex !== index);
      return next.length ? next : [{ id: uuid(), type: "paragraph", text: "" }];
    });
    setChanged(true);
  }

  function addFiles(selected: File[]) {
    if (locked) return fail("Attachments are locked because the announcement email is already queued.");
    const accepted: EditorFile[] = [];
    for (const file of selected) {
      if (!fileTypes.has(file.type)) return fail(`${file.name}: choose a PDF, image, DOCX or XLSX file.`);
      if (file.size > 10 * 1024 * 1024) return fail(`${file.name}: attachments must be 10 MB or less.`);
      accepted.push({ uploadKey: uuid(), file, fileName: file.name, sizeBytes: file.size });
    }
    if (files.length + accepted.length > 5) return fail("Announcements support up to five file attachments.");
    setFiles(current => [...current, ...accepted]); setChanged(true); setError("");
  }

  function removeFile(index: number) {
    if (locked) return;
    const target = files[index];
    if (target.attachmentId) setRemovedIds(current => [...new Set([...current, target.attachmentId!])]);
    setFiles(current => current.filter((_, itemIndex) => itemIndex !== index)); setChanged(true);
  }

  async function save(publish: boolean) {
    const content = plainText(blocks);
    if (!form.title.trim()) return fail("Enter an announcement title.");
    if (!content) return fail("Enter announcement message text.");
    if (content.length > 10_000) return fail("Announcement message text must be 10,000 characters or less.");
    if (!validAltText) return fail("Add alt text for every picture before saving.");
    setBusy(true); setError(""); setRetryPublish(publish);
    try {
      const settings = locked ? {} : {
        audienceRoles: form.audienceRoles,
        departmentId: form.departmentId || null,
        publishedAt: form.publishedAt ? new Date(form.publishedAt).toISOString() : null,
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
        emailEnabled: form.emailEnabled,
      };
      const payload = { title: form.title.trim(), content, contentBlocks: serialiseBlocks(blocks), ...settings };
      let id = draftId;
      if (!id) {
        const created = await apiRequest<Announcement>("/announcements", { method: "POST", csrfToken: session.csrfToken, body: JSON.stringify({ ...payload, isActive: false }) });
        id = created.id; setDraftId(id);
      }
      const pending = [
        ...blocks.filter((block): block is EditorImage => block.type === "image" && Boolean(block.file) && !block.attachmentId).map((block, sortOrder) => ({ kind: "INLINE_IMAGE", uploadKey: block.attachmentKey, altText: block.altText.trim(), sortOrder, file: block.file!, label: block.file!.name })),
        ...files.filter(file => Boolean(file.file) && !file.attachmentId).map((file, sortOrder) => ({ kind: "FILE", uploadKey: file.uploadKey, altText: "", sortOrder, file: file.file!, label: file.file!.name })),
      ];
      for (let index = 0; index < pending.length; index += 1) {
        const item = pending[index]; setUploadProgress({ done: index, total: pending.length, label: `Uploading ${item.label}` });
        const body = new FormData(); body.set("file", item.file); body.set("uploadKey", item.uploadKey); body.set("kind", item.kind); body.set("sortOrder", String(item.sortOrder)); if (item.altText) body.set("altText", item.altText);
        const uploaded = await apiRequest<Attachment>(`/announcements/${id}/attachments`, { method: "POST", csrfToken: session.csrfToken, body });
        if (item.kind === "INLINE_IMAGE") setBlocks(current => current.map(block => block.type === "image" && block.attachmentKey === item.uploadKey ? { ...block, attachmentId: uploaded.id, file: undefined, sizeBytes: uploaded.sizeBytes } : block));
        else setFiles(current => current.map(file => file.uploadKey === item.uploadKey ? { ...file, attachmentId: uploaded.id, file: undefined, sizeBytes: uploaded.sizeBytes } : file));
        setUploadProgress({ done: index + 1, total: pending.length, label: `${index + 1} of ${pending.length} uploads complete` });
      }
      await apiRequest<Announcement>(`/announcements/${id}`, { method: "PATCH", csrfToken: session.csrfToken, body: JSON.stringify({ ...payload, isActive: value?.isActive ?? false }) });
      for (const attachmentId of removedIds) {
        await apiRequest(`/announcements/${id}/attachments/${attachmentId}`, { method: "DELETE", csrfToken: session.csrfToken });
        setRemovedIds(current => current.filter(item => item !== attachmentId));
      }
      if (publish) await apiRequest(`/announcements/${id}/publish`, { method: "POST", csrfToken: session.csrfToken });
      setChanged(false);
      const scheduled = publish && form.publishedAt && new Date(form.publishedAt) > new Date();
      await done(publish ? scheduled ? "Announcement scheduled." : "Announcement published." : value?.isActive ? "Announcement updated on the website." : "Announcement draft saved.");
    } catch (caught) { fail(`${draftId || value?.id ? "The draft is safe. " : ""}${errorMessage(caught)}`); }
    finally { setBusy(false); setUploadProgress(null); }
  }

  const publishLabel = form.publishedAt && new Date(form.publishedAt) > new Date() ? "Schedule announcement" : "Publish announcement";
  return <Dialog title={value ? "Edit announcement" : "New announcement"} description="Paste pictures directly into the message, or attach secure files." onClose={close} wide>
    <form className="announcement-editor" onSubmit={event => { event.preventDefault(); void save(false); }} aria-busy={busy || processingImages}>
      {locked && <div className="announcement-editor__warning" role="status"><Mail size={17} aria-hidden="true" /><span>Email was queued on {displayDate(value?.emailQueuedAt)}. Text edits update the website only; pictures, files, audience, schedule and email settings are locked. Create a replacement announcement to send another email.</span></div>}
      <label>Title<input autoFocus maxLength={200} value={form.title} onChange={event => updateForm("title", event.target.value)} /></label>
      <fieldset className="announcement-block-editor"><legend>Message</legend><p className="field-hint">Paste a picture at the text cursor to place it exactly there. Every picture needs alt text.</p>
      <div className="announcement-block-list">{blocks.map((block, index) => block.type === "paragraph" ? <label className="announcement-paragraph" key={block.id}><span className="sr-only">Message paragraph {index + 1}</span><textarea data-announcement-block={block.id} rows={Math.max(3, Math.min(8, block.text.split("\n").length + 2))} maxLength={10000} disabled={processingImages} value={block.text} onPaste={event => pastePicture(event, index)} onChange={event => updateParagraph(block.id, event.target.value)} /></label> : <figure className="announcement-picture-editor" key={block.id}><img src={block.previewUrl} alt="" /><figcaption><label>Picture alt text<input maxLength={300} disabled={locked} value={block.altText} aria-invalid={!block.altText.trim()} onChange={event => { setChanged(true); setBlocks(current => current.map(item => item.id === block.id && item.type === "image" ? { ...item, altText: event.target.value } : item)); }} /></label><span>{formatBytes(block.sizeBytes)}</span><button type="button" className="danger-outline" disabled={locked || busy} onClick={() => removePicture(index)}><Trash2 size={15} aria-hidden="true" /> Remove picture</button></figcaption></figure>)}</div>
        <label className="button-like announcement-upload-button"><ImagePlus size={16} aria-hidden="true" /> Add pictures<input type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={locked || busy || processingImages || inlineCount >= 5} onChange={event => { addPictures(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = ""; }} /></label><small>{inlineCount}/5 pictures · {formatBytes(inlineBytes)} of 2 MB</small>
      </fieldset>
      <fieldset className="announcement-attachments"><legend>Secure file attachments</legend><p className="field-hint">PDF, image, DOCX or XLSX · up to 10 MB each. Email recipients receive protected links.</p>
        {files.length > 0 && <div className="announcement-file-list">{files.map((file, index) => <div className="announcement-file" key={file.uploadKey}><span><Paperclip size={17} aria-hidden="true" /><span><strong>{file.fileName}</strong><small>{formatBytes(file.sizeBytes)}{file.attachmentId ? " · Uploaded" : " · Ready to upload"}</small></span></span><button type="button" className="danger-outline" disabled={locked || busy} onClick={() => removeFile(index)} aria-label={`Remove ${file.fileName}`}><Trash2 size={15} aria-hidden="true" /> Remove</button></div>)}</div>}
        <label className="button-like announcement-upload-button"><Paperclip size={16} aria-hidden="true" /> Attach files<input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx,application/pdf,image/jpeg,image/png,image/webp,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={locked || busy || files.length >= 5} onChange={event => { addFiles(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = ""; }} /></label><small>{files.length}/5 attachments</small>
      </fieldset>
      <div className="form-grid"><label>Department<select disabled={locked} value={form.departmentId} onChange={event => updateForm("departmentId", event.target.value)}><option value="">All departments</option>{departments.map(department => <option value={department.id} key={department.id}>{department.name}</option>)}</select></label><label>Publish at<input type="datetime-local" disabled={locked} value={form.publishedAt} onChange={event => updateForm("publishedAt", event.target.value)} /></label><label>Expires at<input type="datetime-local" disabled={locked} value={form.expiresAt} onChange={event => updateForm("expiresAt", event.target.value)} /></label><label className="announcement-email-toggle"><span>Email delivery</span><span><input type="checkbox" disabled={locked} checked={form.emailEnabled} onChange={event => updateForm("emailEnabled", event.target.checked)} /> Send by email when published</span></label></div>
      <fieldset disabled={locked}><legend>Audience roles <small>(none means everyone with access)</small></legend><div className="checkbox-grid">{roles.map(role => <label key={role}><input type="checkbox" checked={form.audienceRoles.includes(role)} onChange={event => updateForm("audienceRoles", event.target.checked ? [...form.audienceRoles, role] : form.audienceRoles.filter(item => item !== role))} /> {displayTitle(role)}</label>)}</div></fieldset>
      {uploadProgress && <div className="announcement-upload-progress" aria-live="polite"><span>{uploadProgress.label}</span><progress max={uploadProgress.total || 1} value={uploadProgress.done} /></div>}
      {error && <p className="form-error" role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}
      <div className="modal-actions"><button type="button" disabled={busy} onClick={close}>Cancel</button>{error && draftId && <button type="button" disabled={busy} onClick={() => void save(retryPublish)}>Retry upload/save</button>}<button type="submit" disabled={!form.title.trim() || !hasMessage || !validAltText || busy || processingImages}>{busy ? "Saving…" : value?.isActive ? "Save website changes" : "Save draft"}</button>{!locked && <button className="primary" type="button" disabled={!form.title.trim() || !hasMessage || !validAltText || busy || processingImages} onClick={() => void save(true)}>{busy ? "Publishing…" : publishLabel}</button>}</div>
    </form>
  </Dialog>;
}

function formatBytes(bytes: number) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function PageState({ label, error }: { label?: string; error?: string }) { return <div className={`page-state${error ? " is-error" : ""}`} role={error ? "alert" : "status"}>{error ?? label}</div>; }
