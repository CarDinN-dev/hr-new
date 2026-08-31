import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { KeyObject } from 'node:crypto';
import {
  createMicrosoftClientAssertion,
  loadMicrosoftRsaPrivateKey,
  microsoftCertificateThumbprint,
} from './common/microsoft-client-assertion';

const graphOrigin = 'https://graph.microsoft.com';
const requestTimeoutMs = 15_000;
const maxBodyBytes = 2_048;
const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type GraphUser = { id: string; userPrincipalName: string; mail?: string | null; accountEnabled: boolean };
type GraphCollection<T> = { value: T[]; '@odata.nextLink'?: string };
type GraphRoleAssignment = { id: string; principalId: string; resourceId: string; appRoleId: string };
type BrokerConfig = {
  tenantId: string;
  clientId: string;
  certificateThumbprint: string;
  privateKey: KeyObject;
  enterpriseAppObjectId: string;
  userAppRoleId: string;
};

export type MicrosoftProvisioningResult = {
  objectId: string;
  userPrincipalName: string;
  assignmentCreated: boolean;
};

export class ProvisioningError extends Error {
  constructor(readonly status: 400 | 502 | 503, message: string) {
    super(message);
  }
}

export class MicrosoftGraphProvisioner {
  private token?: { value: string; expiresAt: number };

  constructor(private readonly config: BrokerConfig) {}

  async provisionUser(email: string): Promise<MicrosoftProvisioningResult> {
    const user = await this.getUser(email);
    const directoryEmails = [user.userPrincipalName, user.mail]
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim().toLowerCase());
    if (!directoryEmails.includes(email)) throw new ProvisioningError(400, 'The Microsoft Entra account does not match the requested email address.');
    if (!user.accountEnabled) throw new ProvisioningError(400, 'The Microsoft Entra account is disabled.');

    if (await this.findAssignment(user.id)) {
      return { objectId: user.id, userPrincipalName: user.userPrincipalName, assignmentCreated: false };
    }

    const response = await this.graphFetch(`/v1.0/servicePrincipals/${this.config.enterpriseAppObjectId}/appRoleAssignedTo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ principalId: user.id, resourceId: this.config.enterpriseAppObjectId, appRoleId: this.config.userAppRoleId }),
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
    if (response.status === 404) throw new ProvisioningError(400, 'No Microsoft Entra user exists for this email address. Create the Microsoft account first.');
    if (!response.ok) throw this.graphFailure(response.status);
    const user = await this.parseJson<GraphUser>(response);
    if (!guidPattern.test(user.id) || !user.userPrincipalName || typeof user.accountEnabled !== 'boolean') {
      throw new ProvisioningError(502, 'Microsoft Entra returned an invalid user record.');
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
      if (!Array.isArray(assignments.value)) throw new ProvisioningError(502, 'Microsoft directory returned an invalid response.');
      const match = assignments.value.find((assignment) => assignment.principalId === userId
        && assignment.resourceId === this.config.enterpriseAppObjectId
        && assignment.appRoleId === this.config.userAppRoleId);
      if (match) return match;
      nextPage = assignments['@odata.nextLink'];
    }
    if (nextPage) throw new ProvisioningError(502, 'Microsoft directory returned too many assignment pages.');
    return undefined;
  }

  private async graphFetch(path: string, init: RequestInit = {}) {
    const token = await this.accessToken();
    const url = new URL(path, graphOrigin);
    if (url.origin !== graphOrigin) throw new ProvisioningError(502, 'Microsoft directory returned an invalid page link.');
    try {
      return await fetch(url, {
        ...init,
        headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...init.headers },
        redirect: 'error',
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch {
      throw new ProvisioningError(502, 'Microsoft directory provisioning could not be reached.');
    }
  }

  private async accessToken() {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    let response: Response;
    try {
      response = await fetch(`https://login.microsoftonline.com/${this.config.tenantId}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.config.clientId,
          client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
          client_assertion: createMicrosoftClientAssertion(this.config),
          scope: `${graphOrigin}/.default`,
          grant_type: 'client_credentials',
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch {
      throw new ProvisioningError(502, 'Microsoft directory authentication could not be reached.');
    }
    if (!response.ok) throw this.graphFailure(response.status);
    const data = await this.parseJson<{ access_token?: string; expires_in?: number }>(response);
    if (!data.access_token || !Number.isFinite(data.expires_in) || Number(data.expires_in) <= 0) {
      throw new ProvisioningError(502, 'Microsoft directory authentication returned an invalid response.');
    }
    this.token = { value: data.access_token, expiresAt: Date.now() + Number(data.expires_in) * 1000 };
    return this.token.value;
  }

  private async parseJson<T>(response: Response): Promise<T> {
    try {
      return await response.json() as T;
    } catch {
      throw new ProvisioningError(502, 'Microsoft directory returned an invalid response.');
    }
  }

  private graphFailure(status: number) {
    if (status === 401 || status === 403) return new ProvisioningError(503, 'Microsoft directory provisioning is not authorized.');
    if (status === 429 || status >= 500) return new ProvisioningError(503, 'Microsoft directory provisioning is temporarily unavailable.');
    return new ProvisioningError(502, 'Microsoft directory provisioning failed.');
  }
}

export function createProvisioningBrokerServer(provisioner: Pick<MicrosoftGraphProvisioner, 'provisionUser'>) {
  return createServer(async (request, response) => {
    setSecurityHeaders(response);
    const url = new URL(request.url ?? '/', 'http://broker.invalid');
    if (request.method === 'GET' && url.pathname === '/health' && !url.search) return json(response, 200, { status: 'ok' });
    if (url.pathname !== '/provision' || url.search) return json(response, 404, { statusCode: 404, message: 'Not found.' });
    if (request.method !== 'POST') return json(response, 405, { statusCode: 405, message: 'Method not allowed.' }, { allow: 'POST' });
    if (!/^application\/json(?:\s*;|$)/i.test(String(request.headers['content-type'] ?? ''))) {
      return json(response, 415, { statusCode: 415, message: 'Content-Type must be application/json.' });
    }
    try {
      const body = await readJsonBody(request);
      const keys = Object.keys(body);
      const email = body.email;
      if (keys.length !== 1 || keys[0] !== 'email' || typeof email !== 'string'
        || email.length > 254 || email !== email.trim().toLowerCase() || !emailPattern.test(email)) {
        throw new ProvisioningError(400, 'A normalized email address is required.');
      }
      return json(response, 200, await provisioner.provisionUser(email));
    } catch (error) {
      if (error instanceof ProvisioningError) return json(response, error.status, { statusCode: error.status, message: error.message });
      return json(response, 502, { statusCode: 502, message: 'Microsoft directory provisioning failed.' });
    }
  });
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBodyBytes) throw new ProvisioningError(400, 'Request body is too large.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maxBodyBytes) throw new ProvisioningError(400, 'Request body is too large.');
    chunks.push(bytes);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
    return parsed as Record<string, unknown>;
  } catch {
    throw new ProvisioningError(400, 'Request body must be valid JSON.');
  }
}

function setSecurityHeaders(response: ServerResponse) {
  response.setHeader('cache-control', 'private, no-store, max-age=0');
  response.setHeader('pragma', 'no-cache');
  response.setHeader('x-content-type-options', 'nosniff');
}

function json(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  response.end(JSON.stringify(body));
}

function requiredGuid(name: string) {
  const value = required(name);
  if (!guidPattern.test(value)) throw new Error(`${name} must be a valid GUID.`);
  return value;
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export function brokerConfigFromEnvironment(): BrokerConfig {
  return {
    tenantId: requiredGuid('MICROSOFT_PROVISIONING_TENANT_ID'),
    clientId: requiredGuid('MICROSOFT_PROVISIONING_CLIENT_ID'),
    certificateThumbprint: microsoftCertificateThumbprint(required('MICROSOFT_PROVISIONING_CERT_THUMBPRINT'), 'MICROSOFT_PROVISIONING_CERT_THUMBPRINT'),
    privateKey: loadMicrosoftRsaPrivateKey(required('MICROSOFT_PROVISIONING_CERT_PATH'), 'MICROSOFT_PROVISIONING_CERT_PATH'),
    enterpriseAppObjectId: requiredGuid('MICROSOFT_ENTERPRISE_APP_OBJECT_ID'),
    userAppRoleId: requiredGuid('MICROSOFT_USER_APP_ROLE_ID'),
  };
}

if (require.main === module) {
  const port = Number(process.env.PROVISIONING_BROKER_PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('PROVISIONING_BROKER_PORT must be a valid port.');
  const provisioner = new MicrosoftGraphProvisioner(brokerConfigFromEnvironment());
  if (process.getuid?.() === 0) {
    if (!process.setgid || !process.setuid) throw new Error('The broker could not drop root privileges.');
    process.setgid(1000);
    process.setuid(1000);
  }
  createProvisioningBrokerServer(provisioner)
    .listen(port, '0.0.0.0', () => process.stdout.write(`Microsoft provisioning broker listening on ${port}\n`));
}
