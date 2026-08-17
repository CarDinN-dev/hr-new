import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaService } from '../../prisma/prisma.service';

const graphOrigin = 'https://graph.microsoft.com';
const senderEmail = 'no-reply@med-tech.com';
const requestTimeoutMs = 15_000;
const retryDelaysSeconds = [60, 300, 900, 3_600] as const;
const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type LeaveEmailKind = 'SUBMITTED' | 'APPROVAL_REQUIRED' | 'REASSIGNED' | 'RETURNED' | 'FINAL' | 'BLOCKED' | 'WORKFLOW_UPDATED';

export type LeaveEmailContext = {
  kind: LeaveEmailKind;
  recipientName: string;
  employeeName: string;
  employeeCode: string;
  leaveType: string;
  startDate: Date;
  endDate: Date;
  totalDays: string;
  stage?: string | null;
  previousStage?: string | null;
  status?: string | null;
  reason?: string;
};

class GraphMailError extends Error {
  constructor(message: string, readonly retryAfterSeconds?: number) {
    super(message);
  }
}

@Injectable()
export class EmailDeliveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailDeliveryService.name);
  private readonly emailEnabled: boolean;
  private readonly tenantId?: string;
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly leaveUrl?: string;
  private readonly logoBytes?: string;
  private token?: { value: string; expiresAt: number };
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(config: ConfigService, private readonly prisma: PrismaService) {
    this.emailEnabled = config.get<string>('LEAVE_EMAIL_ENABLED', 'false').toLowerCase() === 'true';
    if (!this.emailEnabled) return;

    this.tenantId = this.requiredGuid(config, 'MICROSOFT_TENANT_ID');
    this.clientId = this.requiredGuid(config, 'MICROSOFT_CLIENT_ID');
    this.clientSecret = config.getOrThrow<string>('MICROSOFT_CLIENT_SECRET');
    if (this.clientSecret.length < 16) throw new Error('MICROSOFT_CLIENT_SECRET is invalid.');
    const redirect = new URL(config.getOrThrow<string>('MICROSOFT_REDIRECT_URI'));
    this.leaveUrl = new URL('/leave', redirect.origin).href;
    this.logoBytes = readFileSync(resolve(process.cwd(), 'assets/recruitment-templates/brand-mark.png')).toString('base64');
  }

  enabled() {
    return this.emailEnabled;
  }

  onModuleInit() {
    if (!this.emailEnabled) return;
    this.timer = setInterval(() => void this.deliverPending(), 15_000);
    this.timer.unref();
    setTimeout(() => void this.deliverPending(), 0).unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  renderLeave(context: LeaveEmailContext) {
    const employeeName = this.subjectText(context.employeeName);
    const leaveType = this.subjectText(context.leaveType);
    const stage = this.label(context.stage);
    const previousStage = this.label(context.previousStage);
    const status = this.label(context.status).toLowerCase();
    let subject: string;
    let lead: string;
    let action = 'View leave request';

    if (context.kind === 'SUBMITTED') {
      subject = `Leave request submitted — ${leaveType}`;
      lead = `Your ${this.escape(context.leaveType)} request has been submitted${stage ? ` and is pending ${this.escape(stage)} review` : ''}. You will receive another email if a correction is required or when a final decision is made.`;
    } else if (context.kind === 'APPROVAL_REQUIRED') {
      subject = `Action required: ${employeeName}’s leave request`;
      lead = `${previousStage ? `The ${this.escape(previousStage)} review is complete. ` : ''}${this.escape(context.employeeName)} (${this.escape(context.employeeCode)}) has a leave request awaiting your ${this.escape(stage)} decision.`;
      action = 'Review leave request';
    } else if (context.kind === 'REASSIGNED') {
      subject = `Leave approval reassigned to you — ${employeeName}`;
      lead = `This request has been reassigned to you and now requires your ${this.escape(stage)} decision.`;
      action = 'Review leave request';
    } else if (context.kind === 'RETURNED') {
      subject = 'Action required: leave request returned for correction';
      lead = `Your leave request was returned for correction${stage ? ` by the ${this.escape(stage)} stage` : ''}. Update the request and resubmit it for approval.`;
      action = 'Update leave request';
    } else if (context.kind === 'FINAL') {
      subject = `Leave request ${status} — ${leaveType}`;
      lead = `Your ${this.escape(context.leaveType)} request has been ${this.escape(status)}.`;
    } else if (context.kind === 'BLOCKED') {
      subject = `Configuration required: missing ${stage} leave approver`;
      lead = `No qualified ${this.escape(stage)} approver could be resolved for this leave request. Update the reporting hierarchy or workflow policy, then reassign the active step.`;
      action = 'Open leave workflow';
    } else {
      subject = `Leave workflow updated — ${employeeName}`;
      lead = `This leave workflow has been updated and your approval is no longer required${status ? ` because the request is now ${this.escape(status)}` : ''}.`;
    }

    const reason = context.reason?.trim();
    const detailRows = [
      ['Employee', `${context.employeeName} (${context.employeeCode})`],
      ['Leave type', context.leaveType],
      ['Dates', `${this.date(context.startDate)} – ${this.date(context.endDate)}`],
      ['Duration', this.duration(context.totalDays)],
      ...(stage ? [['Stage', stage]] : []),
      ...(reason && ['RETURNED', 'FINAL', 'WORKFLOW_UPDATED'].includes(context.kind) ? [['Decision reason', reason]] : []),
    ].map(([label, value]) => `<tr><td style="padding:8px 12px;color:#667085;font-size:13px;border-bottom:1px solid #eaecf0;white-space:nowrap">${this.escape(label)}</td><td style="padding:8px 12px;color:#101828;font-size:13px;font-weight:600;border-bottom:1px solid #eaecf0">${this.escape(value)}</td></tr>`).join('');
    const safeUrl = this.escape(this.leaveUrl ?? '');

    return {
      subject: this.subjectText(subject).slice(0, 300),
      htmlBody: `<div style="margin:0;padding:24px;background:#f7f8fa;font-family:Arial,Helvetica,sans-serif;color:#101828"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #eaecf0;border-radius:12px"><tr><td style="padding:24px 28px;border-bottom:1px solid #eaecf0"><table role="presentation" cellspacing="0" cellpadding="0"><tr><td><img src="cid:medtech-logo" width="72" alt="MedTech logo" style="display:block;width:72px;height:auto"></td><td style="padding-left:14px;font-size:20px;font-weight:700;color:#24366f">MedTech HR ERP</td></tr></table></td></tr><tr><td style="padding:28px"><p style="margin:0 0 16px;font-size:16px;line-height:24px">Hi ${this.escape(context.recipientName || 'there')},</p><p style="margin:0 0 20px;font-size:15px;line-height:23px;color:#344054">${lead}</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 24px;border:1px solid #eaecf0;border-radius:8px;border-collapse:separate;border-spacing:0">${detailRows}</table><a href="${safeUrl}" style="display:inline-block;padding:11px 18px;background:#9e1b50;color:#ffffff;text-decoration:none;border-radius:7px;font-size:14px;font-weight:700">${this.escape(action)}</a><p style="margin:18px 0 0;font-size:12px;line-height:18px;color:#667085">If the button does not open, visit ${safeUrl}</p></td></tr><tr><td style="padding:18px 28px;background:#f9fafb;border-top:1px solid #eaecf0;font-size:12px;line-height:18px;color:#667085">This is an automated message from MedTech HR ERP. Replies to ${senderEmail} are not monitored.</td></tr></table></div>`,
    };
  }

  private async deliverPending() {
    if (!this.emailEnabled || this.running) return;
    this.running = true;
    try {
      const deliveries = await this.prisma.emailDelivery.findMany({
        where: { sentAt: null, nextAttemptAt: { lte: new Date() } },
        orderBy: { createdAt: 'asc' },
        take: 20,
      });
      for (const delivery of deliveries) {
        try {
          await this.send(delivery.recipientEmail, delivery.subject, delivery.htmlBody);
          await this.prisma.emailDelivery.update({ where: { id: delivery.id }, data: { sentAt: new Date(), lastError: null } });
        } catch (error) {
          const attempts = delivery.attempts + 1;
          const message = error instanceof Error ? error.message : 'Microsoft Graph email delivery failed';
          const requestedDelay = error instanceof GraphMailError ? error.retryAfterSeconds : undefined;
          const delay = requestedDelay ?? retryDelaysSeconds[Math.min(attempts - 1, retryDelaysSeconds.length - 1)];
          await this.prisma.emailDelivery.update({
            where: { id: delivery.id },
            data: { attempts, nextAttemptAt: new Date(Date.now() + delay * 1000), lastError: message.slice(0, 1000) },
          });
          this.logger.warn(`Email delivery ${delivery.id} failed; retry scheduled in ${delay}s: ${message}`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async send(recipientEmail: string, subject: string, htmlBody: string) {
    const token = await this.accessToken();
    let response: Response;
    try {
      response = await fetch(`${graphOrigin}/v1.0/users/${encodeURIComponent(senderEmail)}/sendMail`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          message: {
            subject,
            body: { contentType: 'HTML', content: htmlBody },
            toRecipients: [{ emailAddress: { address: recipientEmail } }],
            attachments: [{
              '@odata.type': '#microsoft.graph.fileAttachment',
              name: 'medtech-logo.png', contentType: 'image/png', contentId: 'medtech-logo', isInline: true, contentBytes: this.logoBytes,
            }],
          },
          saveToSentItems: false,
        }),
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch {
      throw new GraphMailError('Microsoft Graph email service could not be reached.');
    }
    if (response.status === 202) return;
    if (response.status === 401) this.token = undefined;
    const retryAfter = Number(response.headers.get('retry-after'));
    throw new GraphMailError(`Microsoft Graph email delivery returned HTTP ${response.status}.`, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined);
  }

  private async accessToken() {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    let response: Response;
    try {
      response = await fetch(`https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: this.clientId!, client_secret: this.clientSecret!, scope: `${graphOrigin}/.default`, grant_type: 'client_credentials' }),
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch {
      throw new GraphMailError('Microsoft Graph authentication could not be reached.');
    }
    if (!response.ok) throw new GraphMailError(`Microsoft Graph authentication returned HTTP ${response.status}.`);
    const data = await response.json() as { access_token?: string; expires_in?: number };
    if (!data.access_token || !Number.isFinite(data.expires_in) || Number(data.expires_in) <= 0) throw new GraphMailError('Microsoft Graph authentication returned an invalid response.');
    this.token = { value: data.access_token, expiresAt: Date.now() + Number(data.expires_in) * 1000 };
    return this.token.value;
  }

  private requiredGuid(config: ConfigService, name: string) {
    const value = config.getOrThrow<string>(name);
    if (!guidPattern.test(value)) throw new Error(`${name} must be a valid GUID.`);
    return value;
  }

  private escape(value: unknown) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
  }

  private subjectText(value: unknown) {
    return String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
  }

  private label(value: string | null | undefined) {
    return value ? value.toLowerCase().split('_').map((word) => `${word[0].toUpperCase()}${word.slice(1)}`).join(' ') : '';
  }

  private date(value: Date) {
    return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(value);
  }

  private duration(value: string) {
    const days = Number(value);
    return `${value} ${days === 1 ? 'day' : 'days'}`;
  }
}
