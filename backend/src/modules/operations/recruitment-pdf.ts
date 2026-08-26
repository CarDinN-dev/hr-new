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
let brandMark: string | undefined;
const pageWidth = 595.28;
const pageHeight = 841.89;
const margin = 38;
const letterheadTop = 110;
const footerY = pageHeight - 28;

function logo() {
  brandMark ??= `data:image/png;base64,${readFileSync(resolve(assetDirectory, 'brand-mark.png')).toString('base64')}`;
  return brandMark;
}

function text(value: unknown, maximum = 2_000) {
  return [...String(value ?? '')].map((character) => { const code = character.charCodeAt(0); return code <= 31 || code === 127 ? ' ' : character; }).join('').trim().slice(0, maximum);
}

function date(value: unknown) {
  const parsed = new Date(String(value ?? ''));
  return Number.isNaN(parsed.getTime()) ? '' : new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(parsed);
}

function money(value: unknown) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00';
}

function document() {
  return new jsPDF({ unit: 'pt', format: 'a4', compress: true });
}

function write(doc: jsPDF, value: unknown, x: number, y: number, width: number, size = 10, bold = false, align: 'left' | 'center' | 'right' = 'left') {
  const content = text(value);
  if (!content) return y;
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  doc.setFontSize(size);
  const lines = doc.splitTextToSize(content, width) as string[];
  doc.text(lines, x, y, { align, lineHeightFactor: 1.17 });
  return y + lines.length * size * 1.17;
}

function rule(doc: jsPDF, y: number) {
  doc.setDrawColor(185, 185, 185);
  doc.setLineWidth(.55);
  doc.line(margin, y, pageWidth - margin, y);
}

function offerHeader(doc: jsPDF, issueDate: unknown, showDate: boolean) {
  if (!showDate) return;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text('Date', margin, letterheadTop);
  doc.line(margin, letterheadTop + 2, margin + 24, letterheadTop + 2);
  doc.setFont('helvetica', 'normal'); doc.text(date(issueDate), margin + 33, letterheadTop);
}

function section(doc: jsPDF, number: string, title: string, y: number) {
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
  doc.text(number, margin, y);
  doc.text(title, margin + 34, y);
  return y + 24;
}

function offerPage(doc: jsPDF, offer: Record<string, unknown>, candidate: CandidateDocumentData, page: number) {
  const name = text(offer.candidateName) || candidate.name;
  const designation = text(offer.designation) || candidate.job.title;
  const lineOfBusiness = text(offer.lineOfBusiness) || candidate.job.department?.name || '';
  const total = Number(offer.basic ?? 0) + Number(offer.hra ?? 0) + Number(offer.conveyance ?? 0) + Number(offer.otherAllowance ?? 0);
  let y = 0;
  offerHeader(doc, offer.issueDate, page === 1);
  if (page === 1) {
    y = letterheadTop + 45;
    y = write(doc, 'Strictly Private & Confidential', margin, y, 240, 11, true); doc.line(margin, y - 8, margin + 150, y - 8); y += 20;
    y = write(doc, name, margin, y, 300, 10); y = write(doc, 'Doha-Qatar', margin, y + 4, 200, 11, true); y += 31;
    y = write(doc, 'Contract of Employment', margin, y, 250, 12, true); doc.line(margin, y - 8, margin + 145, y - 8); y += 18;
    y = write(doc, 'We are delighted to extend to you our offer of employment with Medtech Corporation.', margin, y, 510, 10.5); y += 11;
    y = write(doc, 'Medtech Corporation acting on its own, is pleased to offer you this Contract of Employment on the following terms and conditions, provided you can comply with Qatar immigration requirements:', margin, y, 510, 10.5); y += 16;
    y = section(doc, '1.', 'DATE OF COMMENCEMENT AND TERM', y);
    y = write(doc, 'This Contract of Employment will come into effect from the date of commencement of duties.', margin + 50, y, 460, 10.5); y += 18;
    y = section(doc, '2.', 'JOB DETAILS', y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5);
    doc.text('2.1.    Your Job Title will be', margin, y); doc.text(`- ${designation}`, 275, y); y += 27;
    doc.text('2.2.    Your Employee Group will be', margin, y); doc.text(`- ${lineOfBusiness}`, 275, y); y += 32;
    y = section(doc, '3.', 'CONTRACTUAL PAY', y);
    y = write(doc, 'Contractual Pay consists of Basic Salary and all other allowances payable to cover your living expenses such as housing, local conveyance, education, utilities, leisure/ club membership and annual leave fare. However, 21 days of your monthly Basic salary shall be treated as Gratuity Pay (as per Qatar labor Law) for the purpose of computing Gratuity Payment.', margin + 34, y, 475, 10); y += 15;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.text('3.1.    Your Contractual Pay will be QAR', margin, y); doc.text(`${money(total)}/-`, 235, y); doc.text('per month.', 330, y); y += 28;
    for (const [label, value] of [['3.1.1.    Basic Salary', offer.basic], ['3.1.2.    HRA', offer.hra], ['3.1.3.    Conveyance', offer.conveyance], ['3.1.4.    Other Allowance', offer.otherAllowance]] as const) {
      doc.setFont('helvetica', 'normal'); doc.text(label, margin + 67, y); doc.text(`- QAR ${money(value)}`, 274, y); y += 26;
    }
    write(doc, 'Your Performance may be reviewed annually based on your performance.', margin + 60, y + 10, 420, 10.5);
  } else if (page === 2) {
    y = letterheadTop;
    y = section(doc, '4.', 'VARIABLE PAY', y);
    y = write(doc, 'Subject to the Company’s sole discretion, you may be eligible for Bonus and / or incentive (short or long term) as the case may be in accordance with the Company’s approved policies and plans. The amount payable will be subject to the Group’s performance, or your unit’s performance, or your own performance or a combination of the above.', margin + 34, y, 475, 10); y += 18;
    y = section(doc, '5.', 'BENEFITS', y);
    y = write(doc, 'Various Loans and Financial Facilities shall be provided as per company’s decision.', margin + 34, y, 475, 10); y += 10;
    y = write(doc, 'You will be entitled for medical benefits provided by Medtech Corporation subject to the company’s policy and condition.', margin + 34, y, 475, 10); y += 10;
    y = write(doc, 'Leave benefits of various types will be extended to employees as indicated below:', margin + 34, y, 475, 10); y += 16;
    y = write(doc, 'Annual Leave (Calendar days per annum)', margin + 34, y, 475, 10, true); y += 5;
    for (const item of ['You will be entitled to 30 Calendar days per annum. Annual leave to be taken at such times may be mutually agreed upon.', 'You will be provided with an economy class ticket for the first leave availed to the home country annually.', 'Any unused leaves will not be carried forward to the next year and is not entitled towards leave encashment.', 'All your leaves shall be available before 31st of December every year.']) { y = write(doc, `• ${item}`, margin + 42, y, 467, 9.5); y += 4; }
    y += 8; y = write(doc, 'Sick Leave (Calendar days per annum)', margin + 34, y, 475, 10, true); y += 5;
    for (const item of ['First 15 days with full pay', 'Next 30 days with half pay', 'Other 45 days with no pay', 'Sick leave including leave for 1 day must be supported by medical certificate.']) { y = write(doc, `• ${item}`, margin + 42, y, 467, 9.5); y += 3; }
    y += 8; y = write(doc, 'Compassionate leave (Calendar Days)', margin + 34, y, 475, 10, true); y += 4;
    for (const item of ['3 Days within Qatar', '5 Days outside Qatar', 'Provided in the event of death of immediate family member (parent, spouse, child or sibling)']) { y = write(doc, `• ${item}`, margin + 42, y, 467, 9.5); y += 3; }
    y += 8; y = write(doc, 'Maternity Leave (Calendar Years)', margin + 34, y, 475, 10, true); y += 4;
    for (const item of ['50 Days', 'This leave shall be granted only after the employee completes one full year with the company.', 'This leave shall be granted subject to a medical certificate issued by a licensed physician stating the probable date of delivery.']) { y = write(doc, `• ${item}`, margin + 42, y, 467, 9.5); y += 3; }
  } else if (page === 3) {
    y = letterheadTop;
    y = write(doc, 'Additional Leave:', margin + 34, y, 475, 10, true); y += 6;
    for (const item of ['Eid El- Fitr — 3 working days', 'Eid El- Adha — 3 working days', 'National Day — 1 working day', 'Three working days to be specified by the employer.']) { y = write(doc, `• ${item}`, margin + 42, y, 467, 9.5); y += 3; }
    y += 10; y = write(doc, 'Note:', margin + 34, y, 475, 10, true); y += 5;
    y = write(doc, 'The worker shall not, during any of his/her leaves, work for another employer and if it has been proved to the employer that the worker has contravened this provision, he may deprive him of his wage for the period of the leave and recover what he has already paid of that wage.', margin + 34, y, 475, 9.5); y += 8;
    y = write(doc, 'Employees are entitled to their leave after completing one full year with the company.', margin + 34, y, 475, 9.5); y += 20;
    y = section(doc, '6.', 'WORKING DAYS AND HOURS', y);
    y = write(doc, 'Employees of the Company will follow standardized working days and hours as follows:', margin + 34, y, 475, 10); y += 14;
    for (const [label, value] of [['Weekly Working Days', '5 days (Sunday to Thursday)'], ['Weekly Working Hours', '44 hours'], ['Work Timings', '07:30-16:30']] as const) { doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.text(label, margin + 34, y); doc.text(`- ${value}`, 276, y); y += 24; }
    y = write(doc, 'During the period of Ramadan, the timings shall be notified.', margin + 34, y + 5, 475, 10); y += 18;
    y = write(doc, 'You would be required to perform your duties as per the requirement and nature of your work. As your activity is involved in customer service in Healthcare Industry, Day and time is subjective and whenever needed to be present to perform your duties.', margin + 34, y, 475, 10); y += 20;
    y = section(doc, '7.', 'MEDICAL AND RESIDENCE VISAS', y);
    y = write(doc, 'Your employment is expressly dependent upon you being medically fit to reside and work in the State of Qatar as per the Qatari Labor Law and upon the same being permitted by the competent authorities in the Qatar and upon your holding and continuing to hold a valid residence visa and / or work permit and other requisite consents, approvals and authorizations arising out of your employment with Medtech Corporation.', margin + 34, y, 475, 9.5); y += 10;
    write(doc, 'Medtech Corporation will sponsor your visa by providing you with an employment visa. Thereafter, it will be your responsibility to apply for resident visas and sponsor your family and dependents.', margin + 34, y, 475, 9.5);
  } else {
    y = letterheadTop;
    y = section(doc, '8.', 'PROBATION AND NOTICE PERIOD', y);
    y = write(doc, 'You will be on probation for a period of Six months during which period your services may be terminated by the company on giving one day’s notice. Your confirmation in the service will be subject to satisfactory performance in the job and receipt of favorable reference letter from your previous employers.', margin + 34, y, 475, 10); y += 10;
    y = write(doc, 'Subsequent to your confirmation, you or the Company may terminate this Contract of Employment upon giving one month’s notice or any in lieu of notice.', margin + 34, y, 475, 10); y += 21;
    y = section(doc, '9.', 'END OF SERVICE BENEFITS', y);
    for (const item of ['On termination of your service, you will be entitled to Gratuity Pay which is an end of service benefit, after you complete one year of service with Medtech Corporation which is as per the Qatar labor law. Under this scheme you will be paid a lump sum benefit at the time of leaving the service for the completed years of service from the date of joining Medtech or its subsidiaries. The worker shall be entitled to Gratuity for the fractions of the year in proportion to the duration of the employment. Gratuity payment is computed on your Gratuity Pay that is set at 21 days of your Basic Salary.', 'If you decide to leave the services of Medtech Corporation for any reason whatsoever, within your first year of employment, the Company reserves the right to recover one month’s contractual pay salary towards expenses/ costs incurred on your behalf for joining the service such as recruitment fees, etc.', 'Any amounts due by the employee to the employer at the time of end of service shall be deducted from the service gratuity.']) { y = write(doc, item, margin + 34, y, 475, 9.5); y += 10; }
    y += 5; y = section(doc, '10.', 'CONTRACT ACCEPTANCE', y);
    y = write(doc, 'By accepting this Contract of Employment, you agree to be an employee of the Company and to accept and abide by applicable laws of Qatar which will govern this contract and the company’s internal policies as may be amended from time to time, as well as the transfer requests within the Company’s network.', margin + 34, y, 475, 10); y += 10;
    y = write(doc, 'Please sign your acceptance of this Contract of Employment and return the copy of this letter in acceptance of the above within 1 week of the date of this contract.', margin + 34, y, 475, 10); y += 24;
    write(doc, 'Yours sincerely,', margin + 34, y, 475, 10); y += 51;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text('Hafiz Hassan Kunhi', margin + 34, y); y += 28;
    doc.text('Chief Operating Officer', margin + 34, y); doc.setFont('helvetica', 'normal'); doc.text('I accept the above terms & conditions ____________________', 244, y); doc.text('(Signature)', 415, y + 25); doc.setFont('helvetica', 'bold'); doc.text('Date:', 275, y + 54);
  }
}

const ndaArticleOne = 'A. The terms "Confidential Information" and "Proprietary Data" means information and data not generally known outside the company concerning Employer or its businesses and the Employer\'s business and technical information, including but not limited to, patent applications, information relating to inventions, discoveries, products, plans, calculations, concepts, design sheets, design data, system design, blueprints, computer programs, algorithms, software, firmware, hardware, manuals, drawings, photographs, devices, samples, models, processes, specifications, instructions, research, test procedures and results, equipment, identity and description of computerized records, customer lists, supplier identity, marketing and sales plans, financial information, business plans, costs, pricing information, and all other concepts or ideas involving or reasonably related to the business or prospective business of Employer, or information received by the Employer as to which there is a bona fide obligation, contractual or otherwise, on Employer\'s part, not to disclose same.';

function ndaSection(doc: jsPDF, title: string, y: number) {
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); doc.text(title, margin, y); return y + 25;
}

function ndaParagraph(doc: jsPDF, value: string, y: number) {
  return write(doc, value, margin, y, pageWidth - margin * 2, 10, false) + 15;
}

function ndaPage(doc: jsPDF, offer: Record<string, unknown>, candidate: CandidateDocumentData, page: number) {
  const name = text(offer.candidateName) || candidate.name;
  const signedDate = date(offer.issueDate);
  let y = 0;
  if (page === 1) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text('EMPLOYEE NON-DISCLOSURE AGREEMENT', pageWidth / 2, letterheadTop + 30, { align: 'center' });
    y = letterheadTop + 83; doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.text('This Non-Disclosure Agreement is entered between', margin, y); doc.setFont('helvetica', 'bold'); doc.text(name, 337, y); doc.text('and Medtech', 343 + doc.getTextWidth(name), y); doc.text('Corporation Trading as of', margin, y + 20); doc.setFont('helvetica', 'normal'); doc.text(signedDate, 172, y + 20); y += 55;
    y = ndaSection(doc, 'RECITALS:', y);
    for (const value of ["A. The success of an Employer’s business depends on the Employer’s possession of confidential, proprietary information, not generally known to others, including specialized information about research, development, production, marketing, and management in Employer's chosen fields.", 'B. Employer wishes to protect its confidential proprietary information and ensure that all employees agree to maintain the confidentiality of this information.', 'C. Employee acknowledges that the Employer desires to protect his confidential proprietary information, that his/her employment creates a duty of trust and confidentiality to Employer with respect to its confidential proprietary information and, as a condition of employment or continued employment with Employer, Employee agrees to be bound by the terms of this Agreement.']) y = ndaParagraph(doc, value, y);
    y += 20; y = ndaSection(doc, 'AGREEMENT:', y); y = ndaParagraph(doc, 'The Employer and Employee agree as follows:', y + 2); y += 28; y = ndaSection(doc, 'ARTICLE I: CONFIDENTIAL INFORMATION', y); ndaParagraph(doc, ndaArticleOne, y);
  } else if (page === 2) {
    y = letterheadTop + 20;
    for (const value of ['B. Employee understands and agrees that the Confidential Information and Proprietary Data always constitute trade secrets of the Employer and that material to this Agreement, Employer has taken all reasonable steps to protect the confidentiality of this information.', 'C. Employee agrees not to use Confidential Information and/or Proprietary Data for the benefit of any other person, corporation or entity, other than the Employer, during the term of employee\'s employment with Employer, or any time thereafter. For purposes of this Agreement, the period of Employee\'s employment shall include any time during which Employee was retained as a consultant by Employer.', 'D. Employee agrees that the Confidential Information and Proprietary Data shall be and remains the exclusive property of Employer and shall not be removed from the premises of Employer under any circumstances whatsoever without the prior written consent of Employer, and if removed, shall be immediately returned to Employer upon any termination of Employee\'s employment, and no copies thereof may be kept by Employee.', 'E. All notes, notebooks, memorandums, computer disks and other similar repositories of information containing or relating in any way to Confidential Information and/or Proprietary Data shall be the property of Employer. All such items made or compiled by Employee or made available to Employee during the period of employment, including all copies thereof, shall be held by Employee in trust and solely for the benefit of Employer and shall be delivered to the Employer by Employee upon termination of employment with Employer, or at any other time upon the request of the Employer.', 'F. Employee agrees that Employee shall not disclose to any other person or entity, either directly or indirectly, the Confidential Information and/or Proprietary Data. Employee understands that the use or disclosure of any of the Confidential Information and/or Proprietary Data may be cause for an action at law or in equity in an appropriate court of the State of Qatar or of any State of the United States, or in any federal court, and that without waiving the right to collect damages from Employee, Employer shall be entitled to an injunction prohibiting the use or disclosure of the Confidential Information and Proprietary Data.']) y = ndaParagraph(doc, value, y);
    y += 5; y = ndaSection(doc, 'ARTICLE II: INVENTIONS', y); ndaParagraph(doc, 'A. Employee shall promptly disclose to Employer, in writing, all inventions, ideas, discoveries, and improvements whether patentable or registrable under Copyright or similar statutes, made or conceived or reduced to practice or learned by Employee, either alone or jointly with others, during the period of employment with Employer. Employees agree that all such inventions (intellectual, visual or material) are the sole property of Employer.', y);
  } else if (page === 3) {
    y = letterheadTop + 20;
    for (const value of ['B. Employee assigns to Employer all right, title and interest in and to all inventions, ideas, discoveries, and improvements, with the exception of inventions, ideas, discoveries, and improvements that qualify for protection under Section C below.', 'C. This Agreement does not require assignment of an invention that is fully qualified for protection under relevant state labor code(s), which may provide as follows:', 'Any provision in an employment agreement which provides that an employee shall assign or offer to assign any of his or her rights in an invention to his or her employer shall not apply to an invention for which no equipment, supplies, facility or trade secret information of the employer was used and which was developed entirely on the employee’s time, and (a) which does not relate (1) to the business of the employer or (2) to the employer’s actual or demonstrably anticipated research or development, or (b) which does not result from any work performed by the employee for the employer.', 'D. Any inventions, ideas, discoveries, and improvements conceived or made by employee prior to the execution of this Agreement and not intended to be included within its provisions are listed or described on Exhibit "A" attached to this Agreement, and the absence of any such list or description indicates that there are no such inventions, ideas, discoveries, or improvements not covered by this Agreement.']) y = ndaParagraph(doc, value, y);
    y += 8; y = ndaSection(doc, 'ARTICLE III: NATURE OF RELATIONSHIP', y); y = ndaParagraph(doc, 'It is expressly understood and agreed that this Agreement does not create or define the terms of any contract of employment, whether expressed or implied, nor does this Agreement create any guarantee of continuing employment between Employer and Employee. The parties understand and agree that Employee\'s relationship with Employer is terminable "at will," such that either Employer or Employee may terminate the relationship with or without cause or prior notice to the other party.', y); y += 8;
    y = ndaSection(doc, 'ARTICLE IV: MISCELLANEOUS PROVISIONS', y);
    for (const value of ['A. This Agreement shall inure to the benefit of the successors and assigns of the Employer, and shall be binding upon the Employee\'s heirs, assigns, administrators and representatives.', 'B. All provisions of this Agreement shall be severable for purposes of enforcement. If any provision or clause of this Agreement is unenforceable at law or in equity, such clause or provision shall be severed from the remainder of this Agreement, and the remainder of this Agreement shall continue to be enforceable, according to its terms.', 'C. This Agreement shall be interpreted under and governed by the laws of the State of Qatar as applied to an agreement made and wholly performed within said State.']) y = ndaParagraph(doc, value, y);
  } else {
    y = letterheadTop + 20;
    y = write(doc, 'ARTICLE IV: MISCELLANEOUS PROVISIONS (CONTINUED)', margin, y, pageWidth - margin * 2, 11.5, true) + 10;
    for (const value of ['D. This Agreement sets forth the entire Agreement as to its subject matter. No modification, amendment, termination or waiver of this Agreement shall be binding unless in writing and signed by a duly authorized officer of Employer. Failure of Employer to insist upon strict compliance with any of the terms, covenants or conditions of this Agreement shall not be deemed a waiver of such terms, covenants or conditions.', 'E. This Agreement constitutes the entire agreement between the parties hereto relating to the subject matter hereof and supersedes any previous agreements between the parties relating to inventions and confidentiality.', 'F. In the event of any dispute related to this Agreement, the prevailing party in that dispute shall recover its attorney fees.', 'G. This Agreement shall be effective on the date last written below.']) y = ndaParagraph(doc, value, y);
    y += 24; rule(doc, y); y += 27; doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text('Signature of Employee', margin, y); doc.text('Signature of Employer', 294, y); y += 32; doc.setFontSize(10.5); doc.text(name, margin, y); doc.text('Hafiz Hassan Kunhi - COO', 284, y); y += 32; rule(doc, y); y += 28; doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.text(signedDate, margin, y); doc.text(signedDate, 300, y);
  }
}

function cell(doc: jsPDF, x: number, y: number, width: number, height: number, fill?: [number, number, number]) {
  if (fill) { doc.setFillColor(...fill); doc.rect(x, y, width, height, 'F'); }
  doc.setDrawColor(80, 80, 80); doc.setLineWidth(.45); doc.rect(x, y, width, height);
}

function cellText(doc: jsPDF, value: unknown, x: number, y: number, width: number, height: number, size = 6.5, bold = false, align: 'left' | 'center' | 'right' = 'left') {
  doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size);
  const lines = doc.splitTextToSize(text(value), width - 5) as string[];
  doc.text(lines.slice(0, Math.max(1, Math.floor(height / (size * 1.1)))), x + (align === 'left' ? 3 : align === 'right' ? width - 3 : width / 2), y + size + 2, { align, lineHeightFactor: 1.05 });
}

function interviewHeader(doc: jsPDF) {
  const x = 38; const y = 35; const width = 519;
  cell(doc, x, y, 80, 62); doc.addImage(logo(), 'PNG', x + 14, y + 10, 52, 42, undefined, 'FAST');
  cell(doc, x + 80, y, 290, 31); cell(doc, x + 80, y + 31, 290, 31); cell(doc, x + 370, y, 149, 15); cell(doc, x + 370, y + 15, 149, 15); cell(doc, x + 370, y + 30, 149, 16); cell(doc, x + 370, y + 46, 149, 16);
  cellText(doc, 'MedTech Corporation Trading', x + 80, y + 4, 290, 25, 8, true, 'center'); cellText(doc, 'INTERVIEW EVALUATION', x + 80, y + 35, 290, 25, 8, true, 'center');
  const meta = [['Document No.:', 'MTECH-HR-RF-011'], ['Classification:', 'Restricted'], ['Effective Date:', '29.03.2023'], ['Revision No:', '00']];
  meta.forEach(([label, value], index) => { const yy = y + index * 15; doc.line(x + 431, yy, x + 431, yy + 15); cellText(doc, label, x + 370, yy, 61, 15, 5.5); cellText(doc, value, x + 431, yy, 88, 15, 5.5, false, 'center'); if (index === 1) { doc.setFillColor(255, 242, 0); doc.rect(x + 431, yy, 88, 15, 'F'); cell(doc, x + 431, yy, 88, 15); cellText(doc, value, x + 431, yy, 88, 15, 5.5, false, 'center'); } });
  return { x, y: y + 62, width };
}

function ratingsMark(doc: jsPDF, value: unknown, x: number, y: number, width: number) {
  if (!Number(value)) return;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text('X', x + width / 2, y, { align: 'center' });
}

export function interviewAssessmentPdf(candidate: CandidateDocumentData) {
  const assessment = candidate.interviewAssessment ?? {};
  const doc = document(); const header = interviewHeader(doc); const x = header.x; const w = header.width; let y = header.y + 14;
  const blue: [number, number, number] = [157, 195, 226]; const grey: [number, number, number] = [191, 191, 191];
  const assessmentTextSize = 6.4;
  cell(doc, x, y, w, 13, blue); cellText(doc, 'Applicant Details', x, y, w, 13, 6.5, true); y += 13;
  for (const [left, right, third] of [[`Name of Candidate : ${assessment.candidateName ?? candidate.name}`, `Date : ${date(assessment.date)}`, ''], [`Position : ${assessment.position ?? candidate.job.title}`, `Time : ${assessment.time ?? ''}`, `Venue: ${assessment.venue ?? ''}`]] as const) { cell(doc, x, y, 240, 15); cell(doc, x + 240, y, 145, 15); cell(doc, x + 385, y, 134, 15); cellText(doc, left, x, y, 240, 15); cellText(doc, right, x + 240, y, 145, 15); cellText(doc, third, x + 385, y, 134, 15); y += 15; }
  cell(doc, x, y, w, 13, blue); cellText(doc, 'Hiring Department', x, y, w, 13, 6.5, true); y += 13;
  for (const [left, right] of [[`Name: ${assessment.hiringName ?? ''}`, `Department : ${assessment.hiringDepartment ?? candidate.job.department?.name ?? ''}`], [`Position : ${assessment.hiringPosition ?? ''}`, '']] as const) { cell(doc, x, y, 260, 15); cell(doc, x + 260, y, 259, 15); cellText(doc, left, x, y, 260, 15); cellText(doc, right, x + 260, y, 259, 15); y += 15; }
  y += 8; cell(doc, x, y, w, 14, grey); cellText(doc, 'RATINGS:', x, y, w, 14, 6.5, true); y += 14;
  const ratingWidths = [84, 84, 132, 145, 74]; const ratingLabels = ['5 - Outstanding\n95 % - 100 %', '4 Exceeds Expectations\n87% - 94%', '3- Meets Expectations\n80% - 86%', '2-Below Expectations\n75% - 79%', '1-Does not Fit\n74% BELOW']; let rx = x;
  ratingWidths.forEach((width, index) => { cell(doc, rx, y, width, 28, index === 0 ? [169, 208, 142] : index === 1 ? [151, 173, 198] : index === 2 ? [248, 224, 212] : index === 3 ? [226, 239, 216] : [232, 232, 232]); cellText(doc, ratingLabels[index], rx, y, width, 28, 6.2, false, 'center'); rx += width; }); y += 34;
  const descriptionWidth = 170; const scoreWidth = 39; const remarksWidth = 154; cell(doc, x, y, descriptionWidth, 15, blue); cellText(doc, 'Interview Evaluation', x, y, descriptionWidth, 15, 6.5, true, 'center'); for (const label of ['5', '4', '3', '2', '1']) { cell(doc, x + descriptionWidth + ['5', '4', '3', '2', '1'].indexOf(label) * scoreWidth, y, scoreWidth, 15, blue); cellText(doc, label, x + descriptionWidth + ['5', '4', '3', '2', '1'].indexOf(label) * scoreWidth, y, scoreWidth, 15, 6.5, true, 'center'); } cell(doc, x + descriptionWidth + scoreWidth * 5, y, remarksWidth, 15, blue); cellText(doc, 'Remarks', x + descriptionWidth + scoreWidth * 5, y, remarksWidth, 15, 6.5, true, 'center'); y += 15;
  const evaluation = [
    ['Applicants Greeting, Appearance\nPersonality & Poise:\n• Proper Introduction\n• Positive first impression\n• Neat, well groomed\n• Appropriately attired\n• Positive, courteous, sincere, and confident\n• Good posture, gestures, and eye contact', assessment.greetingRating, assessment.greetingRemarks, 63],
    ['A. General Background\n• Assess Candidates on Experience\n• Employment History', assessment.backgroundRating, assessment.backgroundRemarks, 39],
    ['B. Technical Competency\n• Technical Knowledge and Prior Working Experience\n• Education, Training, Accomplishments and strengths', assessment.technicalRating, assessment.technicalRemarks, 49],
    ['C. People and Leadership Competency & Behaviours and Habits\n• Presentation/Communication Skills\n• Responses\n• Interpersonal/leadership Skills\n• Flexibility/Planning and Organizing\n• Motivation/Initiative\n• Professional Impressions and Enthusiasm', assessment.leadershipRating, assessment.leadershipRemarks, 66],
  ] as const;
  for (const [description, rating, remarks, height] of evaluation) { cell(doc, x, y, descriptionWidth, height); cellText(doc, description, x, y, descriptionWidth, height, assessmentTextSize); for (let score = 0; score < 5; score += 1) cell(doc, x + descriptionWidth + score * scoreWidth, y, scoreWidth, height); cell(doc, x + descriptionWidth + scoreWidth * 5, y, remarksWidth, height); ratingsMark(doc, rating, x + descriptionWidth + (5 - Number(rating || 0)) * scoreWidth, y + height / 2 + 3, scoreWidth); cellText(doc, remarks, x + descriptionWidth + scoreWidth * 5, y, remarksWidth, height, assessmentTextSize); y += height; }
  cell(doc, x, y, descriptionWidth, 15, blue); cellText(doc, 'Over all Rating', x, y, descriptionWidth, 15, 6, true, 'right'); for (let score = 0; score < 5; score += 1) cell(doc, x + descriptionWidth + score * scoreWidth, y, scoreWidth, 15, blue); cell(doc, x + descriptionWidth + scoreWidth * 5, y, remarksWidth, 15, blue); ratingsMark(doc, assessment.overallRating, x + descriptionWidth + (5 - Number(assessment.overallRating || 0)) * scoreWidth, y + 11, scoreWidth); y += 15;
  cell(doc, x, y, w, 14, grey); cellText(doc, 'Documents Availability:', x, y, w, 14, 6.5, true); y += 14; cell(doc, x, y, descriptionWidth, 28); cell(doc, x + descriptionWidth, y, w - descriptionWidth, 28); cellText(doc, `• Visa Status\n• Driving license`, x, y, descriptionWidth, 28, assessmentTextSize); cellText(doc, `${assessment.visaStatus ?? ''}\n${assessment.drivingLicense ?? ''}`, x + descriptionWidth, y, w - descriptionWidth, 28, assessmentTextSize); y += 28;
  cell(doc, x, y, descriptionWidth, 37); cell(doc, x + descriptionWidth, y, w - descriptionWidth, 37); cellText(doc, '• Current Salary\n• Expected Salary\n• Expected Date of Joining', x, y, descriptionWidth, 37, assessmentTextSize); cellText(doc, `${assessment.currentSalary ?? ''}\n${assessment.expectedSalary ?? ''}\n${date(assessment.expectedJoiningDate)}`, x + descriptionWidth, y, w - descriptionWidth, 37, assessmentTextSize); y += 37;
  for (const [label, value, height] of [['Interviewer Comments', assessment.interviewerComments, 30], ['Supervisor/Department Head/Manager Comment(s)', assessment.managerComments, 37]] as const) { cell(doc, x, y, w, 13, blue); cellText(doc, label, x, y, w, 13, 6.2, true); y += 13; cell(doc, x, y, w, height); cellText(doc, value, x, y, w, height, assessmentTextSize); y += height + 5; }
  // ponytail: reserve writing room without moving the fixed assessment sections.
  const signatureY = Math.min(y + 52, footerY - 50);
  doc.setDrawColor(90, 90, 90); doc.line(x + 45, signatureY, x + 190, signatureY); doc.line(x + 320, signatureY, x + 475, signatureY); cellText(doc, 'Zahira Hassan\nInterviewed by: CPO', x + 35, signatureY, 165, 28, 6.7, false, 'center'); cellText(doc, 'Hafiz Hassan Kunhi\nApproved by : COO', x + 308, signatureY, 180, 28, 6.7, false, 'center');
  doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5); doc.text('The printed copies of the document are not controlled. Document users are responsible for ensuring printed copies are valid prior to use. Documents are restricted for editing by Unauthorized Staff.', pageWidth / 2, footerY, { align: 'center' });
  return Buffer.from(doc.output('arraybuffer'));
}

export function offerLetterPdf(candidate: CandidateDocumentData) {
  const doc = document(); const offer = candidate.offerDetails ?? {};
  for (let page = 1; page <= 4; page += 1) { if (page > 1) doc.addPage('a4', 'portrait'); offerPage(doc, offer, candidate, page); }
  return Buffer.from(doc.output('arraybuffer'));
}

export function ndaPdf(candidate: CandidateDocumentData) {
  const doc = document(); const offer = candidate.offerDetails ?? {};
  for (let page = 1; page <= 4; page += 1) { if (page > 1) doc.addPage('a4', 'portrait'); ndaPage(doc, offer, candidate, page); }
  return Buffer.from(doc.output('arraybuffer'));
}
