import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const graphOrigin = 'https://graph.microsoft.com';
const requestTimeoutMs = 15_000;

type GraphUser = {
  id: string;
  userPrincipalName: string;
  mail?: string | null;
  accountEnabled: boolean;
  userType?: string | null;
};

type GraphCollection<T> = { value: T[]; '@odata.nextLink'?: string };
type GraphRoleAssignment = { id: string; principalId: string; resourceId: string; appRoleId: string };
type TokenResponse = { access_token: string; expires_in: number; token_type: string };

export type MicrosoftProvisioningResult = {
  objectId: string;
  userPrincipalName: string;
  assignmentCreated: boolean;
};

@Injectable()
export class MicrosoftDirectoryProvisioningService {
  private readonly enabled: boolean;
  private readonly tenantId?: string;
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly enterpriseAppObjectId?: string;
  private readonly userAppRoleId?: string;
  private token?: { value: string; expiresAt: number };

  constructor(private readonly config: ConfigService) {
    this.enabled = this.config.get<string>('MICROSOFT_PROVISIONING_ENABLED', 'false').toLowerCase() === 'true';
    if (!this.enabled) return;

    this.tenantId = this.requiredGuid('MICROSOFT_PROVISIONING_TENANT_ID');
    this.clientId = this.requiredGuid('MICROSOFT_PROVISIONING_CLIENT_ID');
    this.clientSecret = this.config.getOrThrow<string>('MICROSOFT_PROVISIONING_CLIENT_SECRET');
    this.enterpriseAppObjectId = this.requiredGuid('MICROSOFT_ENTERPRISE_APP_OBJECT_ID');
    this.userAppRoleId = this.requiredGuid('MICROSOFT_USER_APP_ROLE_ID');
    if (this.clientSecret.length < 16) throw new Error('MICROSOFT_PROVISIONING_CLIENT_SECRET is invalid.');
  }

  async provisionUser(emailValue: string): Promise<MicrosoftProvisioningResult> {
    if (!this.enabled) {
      throw new ServiceUnavailableException('Automatic Microsoft access provisioning is not configured.');
    }

    const email = emailValue.trim().toLowerCase();
    const user = await this.getUser(email);
    const directoryEmails = [user.userPrincipalName, user.mail]
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim().toLowerCase());
    if (!directoryEmails.includes(email)) {
      throw new BadRequestException('The Microsoft Entra account does not match the requested email address.');
    }
    if (!user.accountEnabled) throw new BadRequestException('The Microsoft Entra account is disabled.');

    const existing = await this.findAssignment(user.id);
    if (existing) {
      return { objectId: user.id, userPrincipalName: user.userPrincipalName, assignmentCreated: false };
    }

    const response = await this.graphFetch(`/v1.0/servicePrincipals/${this.enterpriseAppObjectId}/appRoleAssignedTo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        principalId: user.id,
        resourceId: this.enterpriseAppObjectId,
        appRoleId: this.userAppRoleId,
      }),
    });
    if (response.status !== 201) {
      if (response.status === 400 && await this.findAssignment(user.id)) {
        return { objectId: user.id, userPrincipalName: user.userPrincipalName, assignmentCreated: false };
      }
      throw this.graphFailure(response.status);
    }
    return { objectId: user.id, userPrincipalName: user.userPrincipalName, assignmentCreated: true };
  }

  private async getUser(email: string) {
    const select = encodeURIComponent('id,userPrincipalName,mail,accountEnabled,userType');
    const response = await this.graphFetch(`/v1.0/users/${encodeURIComponent(email)}?$select=${select}`);
    if (response.status === 404) {
      throw new BadRequestException('No Microsoft Entra user exists for this email address. Create the Microsoft account first.');
    }
    if (!response.ok) throw this.graphFailure(response.status);
    const user = await this.parseJson<GraphUser>(response);
    if (!guidPattern.test(user.id) || !user.userPrincipalName || typeof user.accountEnabled !== 'boolean') {
      throw new BadGatewayException('Microsoft Entra returned an invalid user record.');
    }
    return user;
  }

  private async findAssignment(userId: string) {
    const select = encodeURIComponent('id,principalId,resourceId,appRoleId');
    let nextPage: string | undefined = `/v1.0/users/${userId}/appRoleAssignments?$select=${select}`;
    for (let page = 0; nextPage && page < 20; page += 1) {
      const response = await this.graphFetch(nextPage);
      if (!response.ok) throw this.graphFailure(response.status);
      const assignments = await this.parseJson<GraphCollection<GraphRoleAssignment>>(response);
      const match = assignments.value.find(
        (assignment) => assignment.principalId === userId
          && assignment.resourceId === this.enterpriseAppObjectId
          && assignment.appRoleId === this.userAppRoleId,
      );
      if (match) return match;
      nextPage = assignments['@odata.nextLink'];
    }
    if (nextPage) throw new BadGatewayException('Microsoft directory returned too many assignment pages.');
    return undefined;
  }

  private async graphFetch(path: string, init: RequestInit = {}) {
    const token = await this.accessToken();
    const url = new URL(path, graphOrigin);
    if (url.origin !== graphOrigin) throw new BadGatewayException('Microsoft directory returned an invalid page link.');
    try {
      return await fetch(url, {
        ...init,
        headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...init.headers },
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch {
      throw new BadGatewayException('Microsoft directory provisioning could not be reached.');
    }
  }

  private async accessToken() {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const body = new URLSearchParams({
      client_id: this.clientId!,
      client_secret: this.clientSecret!,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });
    let response: Response;
    try {
      response = await fetch(`https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch {
      throw new BadGatewayException('Microsoft directory authentication could not be reached.');
    }
    if (!response.ok) throw this.graphFailure(response.status);
    const token = await this.parseJson<TokenResponse>(response);
    if (!token.access_token || !Number.isFinite(token.expires_in) || token.expires_in <= 0) {
      throw new BadGatewayException('Microsoft directory authentication returned an invalid response.');
    }
    this.token = { value: token.access_token, expiresAt: Date.now() + token.expires_in * 1000 };
    return this.token.value;
  }

  private async parseJson<T>(response: Response): Promise<T> {
    try {
      return await response.json() as T;
    } catch {
      throw new BadGatewayException('Microsoft directory returned an invalid response.');
    }
  }

  private graphFailure(status: number) {
    if (status === 401 || status === 403) {
      return new ServiceUnavailableException('Microsoft directory provisioning is not authorized.');
    }
    if (status === 429 || status >= 500) {
      return new ServiceUnavailableException('Microsoft directory provisioning is temporarily unavailable.');
    }
    return new BadGatewayException('Microsoft directory provisioning failed.');
  }

  private requiredGuid(name: string) {
    const value = this.config.getOrThrow<string>(name);
    if (!guidPattern.test(value)) throw new Error(`${name} must be a valid GUID.`);
    return value;
  }
}
