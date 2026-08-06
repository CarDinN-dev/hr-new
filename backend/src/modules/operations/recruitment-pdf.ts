import { jsPDF } from 'jspdf';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type CandidateDocumentData = {
  name: string;
  job: { title: string; department?: { name: string } | null };
  interviewAssessment?: Record<string, unknown> | null;
  offerDetails?: Record<string, unknown> | null;
};

const assetDirectory = resolve(process.cwd(), 'assets', 'recruitment-templates');
const imageCache = new Map<string, string>();
const pageLayouts = new WeakMap<jsPDF, { x: number; y: number; scale: number }>();
const templateMargin = 26;

function pageMaster(name: string) {
  let image = imageCache.get(name);
  if (!image) {
    image = `data:image/png;base64,${readFileSync(resolve(assetDirectory, name)).toString('base64')}`;
    imageCache.set(name, image);
  }
  return image;
}

function text(value: unknown, maximum = 500) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maximum);
}

function date(value: unknown) {
  const parsed = new Date(String(value ?? ''));
  return Number.isNaN(parsed.getTime()) ? '' : new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(parsed);
}

function money(value: unknown) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00';
}

function addBrandMark(doc: jsPDF, x: number, y: number, width: number, height: number) {
  doc.addImage(pageMaster('brand-mark.png'), 'PNG', x, y, width, height, undefined, 'FAST');
}

function addPageMaster(doc: jsPDF, name: string, sourceWidth: number, sourceHeight: number) {
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const scale = Math.min((width - templateMargin * 2) / sourceWidth, (height - templateMargin * 2) / sourceHeight);
  const layout = { x: (width - sourceWidth * scale) / 2, y: (height - sourceHeight * scale) / 2, scale };
  pageLayouts.set(doc, layout);
  doc.addImage(pageMaster(name), 'PNG', layout.x, layout.y, sourceWidth * scale, sourceHeight * scale, undefined, 'FAST');
  if (name === 'interview.png') {
    const xScale = sourceWidth * scale / 1275;
    const yScale = sourceHeight * scale / 1650;
    doc.setFillColor(255, 255, 255);
    doc.rect(layout.x + 48 * xScale, layout.y + 24 * yScale, 95 * xScale, 64 * yScale, 'F');
    addBrandMark(doc, layout.x + 55 * xScale, layout.y + 25 * yScale, 80 * xScale, 64 * yScale);
  } else {
    addBrandMark(doc, width - templateMargin - 25, (layout.y - 20) / 2, 25, 20);
  }
}

function pageLayout(doc: jsPDF) {
  return pageLayouts.get(doc) ?? { x: 0, y: 0, scale: 1 };
}

function fitted(doc: jsPDF, value: unknown, x: number, y: number, maxWidth: number, options: { bold?: boolean; align?: 'left' | 'center' | 'right'; size?: number; minSize?: number } = {}) {
  const content = text(value, 300);
  if (!content) return;
  const layout = pageLayout(doc);
  const width = maxWidth * layout.scale;
  doc.setFont('helvetica', options.bold ? 'bold' : 'normal');
  let size = (options.size ?? 11) * layout.scale;
  doc.setFontSize(size);
  while (size > (options.minSize ?? 7) * layout.scale && doc.getTextWidth(content) > width) { size -= 0.5 * layout.scale; doc.setFontSize(size); }
  doc.setFontSize(size);
  const output = doc.getTextWidth(content) <= width ? content : `${content.slice(0, Math.max(1, Math.floor(content.length * width / doc.getTextWidth(content)) - 3))}...`;
  doc.text(output, layout.x + x * layout.scale, layout.y + y * layout.scale, { align: options.align ?? 'left' });
}

function wrapped(doc: jsPDF, value: unknown, x: number, y: number, maxWidth: number, maxLines: number, size = 8) {
  const layout = pageLayout(doc);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(size * layout.scale);
  const lines = doc.splitTextToSize(text(value, 2_000), maxWidth * layout.scale).slice(0, maxLines) as string[];
  if (lines.length === maxLines && text(value, 2_000).length > lines.join(' ').length) lines[maxLines - 1] = `${lines[maxLines - 1].replace(/\.{0,3}$/, '')}...`;
  if (lines.length) doc.text(lines, layout.x + x * layout.scale, layout.y + y * layout.scale, { lineHeightFactor: 1.1 });
}

function rating(doc: jsPDF, value: unknown, y: number) {
  const score = Number(value);
  const x = ({ 5: 127, 4: 150.5, 3: 172, 2: 194.5, 1: 218.5 } as Record<number, number>)[score];
  if (!x) return;
  const layout = pageLayout(doc);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7 * layout.scale); doc.text('X', layout.x + x * layout.scale, layout.y + y * layout.scale, { align: 'center' });
}

export function interviewAssessmentPdf(candidate: CandidateDocumentData) {
  const assessment = candidate.interviewAssessment ?? {};
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  addPageMaster(doc, 'interview.png', 612, 792);
  const small = { size: 5.5, minSize: 4 };
  fitted(doc, assessment.candidateName ?? candidate.name, 64, 61.5, 97, small);
  fitted(doc, date(assessment.date), 178, 61.5, 53, small);
  fitted(doc, `: ${text(assessment.position) || candidate.job.title}`, 49, 68.7, 112, small);
  fitted(doc, `: ${text(assessment.time)}`, 178, 68.7, 53, small);
  fitted(doc, assessment.venue, 250, 68.7, 71, small);
  fitted(doc, assessment.hiringName, 72, 87.2, 88, small);
  fitted(doc, assessment.hiringDepartment ?? candidate.job.department?.name, 192, 87.2, 94, small);
  fitted(doc, assessment.hiringPosition, 72, 94.5, 88, small);

  rating(doc, assessment.greetingRating, 178); wrapped(doc, assessment.greetingRemarks, 235, 165, 85, 9, 5);
  rating(doc, assessment.backgroundRating, 210); wrapped(doc, assessment.backgroundRemarks, 235, 206, 85, 4, 5);
  rating(doc, assessment.technicalRating, 235); wrapped(doc, assessment.technicalRemarks, 235, 233, 85, 5, 5);
  rating(doc, assessment.leadershipRating, 280); wrapped(doc, assessment.leadershipRemarks, 235, 271, 85, 8, 5);
  rating(doc, assessment.overallRating, 306);

  fitted(doc, assessment.visaStatus, 117, 319, 114, small);
  fitted(doc, assessment.drivingLicense, 117, 326, 114, small);
  fitted(doc, assessment.currentSalary, 117, 336, 114, small);
  fitted(doc, assessment.expectedSalary, 117, 343, 114, small);
  fitted(doc, date(assessment.expectedJoiningDate), 117, 350, 114, small);
  wrapped(doc, assessment.interviewerComments, 25, 361, 295, 2, 5);
  wrapped(doc, assessment.managerComments, 25, 379, 295, 4, 5);
  return Buffer.from(doc.output('arraybuffer'));
}

export function offerLetterPdf(candidate: CandidateDocumentData) {
  const offer = candidate.offerDetails ?? {};
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  for (let page = 1; page <= 4; page += 1) {
    if (page > 1) doc.addPage('a4', 'portrait');
    addPageMaster(doc, `offer-${page}.png`, 595.28, 841.89);
  }
  doc.setPage(1);
  fitted(doc, date(offer.issueDate), 36, 14, 80, { bold: true });
  fitted(doc, offer.candidateName ?? candidate.name, 0, 108, 185);
  fitted(doc, offer.designation ?? candidate.job.title, 246, 409, 170);
  fitted(doc, offer.lineOfBusiness ?? candidate.job.department?.name, 246, 436, 170);
  const total = Number(offer.basic ?? 0) + Number(offer.hra ?? 0) + Number(offer.conveyance ?? 0) + Number(offer.otherAllowance ?? 0);
  fitted(doc, `${money(total)}/-`, 234, 594, 74, { bold: true });
  fitted(doc, `QAR ${money(offer.basic)}`, 245, 620, 65);
  fitted(doc, `QAR ${money(offer.hra)}`, 245, 647, 65);
  fitted(doc, `QAR ${money(offer.conveyance)}`, 245, 674, 65);
  fitted(doc, `QAR ${money(offer.otherAllowance)}`, 245, 700, 65);
  return Buffer.from(doc.output('arraybuffer'));
}

export function ndaPdf(candidate: CandidateDocumentData) {
  const offer = candidate.offerDetails ?? {};
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  for (let page = 1; page <= 4; page += 1) {
    if (page > 1) doc.addPage('a4', 'portrait');
    addPageMaster(doc, `nda-${page}.png`, 595.28, 841.89);
  }
  doc.setPage(1);
  fitted(doc, offer.candidateName ?? candidate.name, 334, 94, 112);
  fitted(doc, date(offer.issueDate), 167, 113, 98);
  doc.setPage(4);
  fitted(doc, offer.candidateName ?? candidate.name, 0, 409, 108);
  fitted(doc, date(offer.issueDate), 0, 474, 88);
  fitted(doc, date(offer.issueDate), 293, 474, 92);
  return Buffer.from(doc.output('arraybuffer'));
}
