import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { Request, Response } from 'express';
import * as oidc from 'openid-client';
import { UsersService } from '../users/users.service';
import { AuthService, IssuedSession } from './auth.service';

const requiredAppRole = 'HR.User';
const callbackPath = '/api/v1/auth/microsoft/callback';
const transactionPath = '/api/v1/auth/microsoft';
const transactionLifetimeMs = 10 * 60 * 1000;
const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Transaction = {
  version: 1;
  state: string;
  nonce: string;
  codeVerifier: string;
  expiresAt: number;
};

@Injectable()
export class MicrosoftAuthService {
  private readonly tenantId: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly applicationOrigin: string;
  private readonly production: boolean;
  private readonly transactionKey: Buffer;
  private configurationPromise?: Promise<oidc.Configuration>;

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly authService: AuthService,
  ) {
    this.tenantId = this.requiredGuid('MICROSOFT_TENANT_ID');
    this.clientId = this.requiredGuid('MICROSOFT_CLIENT_ID');
    this.clientSecret = this.configService.getOrThrow<string>('MICROSOFT_CLIENT_SECRET');
    if (this.clientSecret.length < 16) throw new Error('MICROSOFT_CLIENT_SECRET is invalid.');

    const redirect = new URL(this.configService.getOrThrow<string>('MICROSOFT_REDIRECT_URI'));
    this.production = this.configService.get<string>('NODE_ENV') === 'production';
    if (redirect.pathname !== callbackPath || redirect.search || redirect.hash) {
      throw new Error(`MICROSOFT_REDIRECT_URI must end with ${callbackPath} and contain no query or fragment.`);
    }
    if (this.production && redirect.protocol !== 'https:') {
      throw new Error('MICROSOFT_REDIRECT_URI must use HTTPS in production.');
    }
    this.redirectUri = redirect.href;
    this.applicationOrigin = redirect.origin;
    this.transactionKey = createHash('sha256')
      .update(this.configService.getOrThrow<string>('JWT_SECRET'))
      .update('\0medtech-microsoft-oidc-transaction-v1')
      .digest();
  }

  async begin(request: Request, response: Response) {
    await this.authService.consumeMicrosoftLoginStart(request.ip);
    const configuration = await this.configuration();
    const transaction: Transaction = {
      version: 1,
      state: oidc.randomState(),
      nonce: oidc.randomNonce(),
      codeVerifier: oidc.randomPKCECodeVerifier(),
      expiresAt: Date.now() + transactionLifetimeMs,
    };
    const codeChallenge = await oidc.calculatePKCECodeChallenge(transaction.codeVerifier);
    const authorizationUrl = oidc.buildAuthorizationUrl(configuration, {
      redirect_uri: this.redirectUri,
      scope: 'openid profile email',
      response_mode: 'query',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state: transaction.state,
      nonce: transaction.nonce,
      prompt: 'select_account',
    });

    response.cookie(this.transactionCookieName(), this.encryptTransaction(transaction), {
      httpOnly: true,
      secure: this.production,
      sameSite: 'lax',
      path: transactionPath,
      maxAge: transactionLifetimeMs,
    });
    return authorizationUrl.href;
  }

  async complete(request: Request, response: Response): Promise<IssuedSession> {
    const encryptedTransaction = this.cookie(request, this.transactionCookieName());
    this.clearTransactionCookie(response);
    const transaction = this.decryptTransaction(encryptedTransaction);
    const code = this.queryValue(request, 'code', 4096);
    const state = this.queryValue(request, 'state', 512);
    if (!code || !state) throw new UnauthorizedException('Microsoft sign-in was not completed.');

    const callbackUrl = new URL(this.redirectUri);
    callbackUrl.searchParams.set('code', code);
    callbackUrl.searchParams.set('state', state);
    const tokens = await oidc.authorizationCodeGrant(
      await this.configuration(),
      callbackUrl,
      {
        pkceCodeVerifier: transaction.codeVerifier,
        expectedState: transaction.state,
        expectedNonce: transaction.nonce,
        idTokenExpected: true,
      },
    );
    const claims = tokens.claims();
    if (!claims) throw new UnauthorizedException('Microsoft identity token was not returned.');

    const { objectId, email } = this.validateIdentityClaims(claims as Record<string, unknown>);

    const user = await this.usersService.findOrBindMicrosoftUser(objectId, email);
    if (
      !user
      || !user.isActive
      || user.deletedAt
      || user.employee?.deletedAt
    ) {
      throw new UnauthorizedException('Microsoft account is not authorized for this application.');
    }
    return this.authService.issueSession(user, request, 'microsoft');
  }

  private validateIdentityClaims(claims: Record<string, unknown>) {
    const tenantId = this.stringClaim(claims.tid);
    const objectId = this.stringClaim(claims.oid);
    const email = this.stringClaim(claims.preferred_username) || this.stringClaim(claims.email);
    const roles = Array.isArray(claims.roles) ? claims.roles.filter((role): role is string => typeof role === 'string') : [];
    const expectedIssuer = `https://login.microsoftonline.com/${this.tenantId}/v2.0`;
    if (
      tenantId.toLowerCase() !== this.tenantId.toLowerCase()
      || this.stringClaim(claims.iss) !== expectedIssuer
      || this.stringClaim(claims.aud) !== this.clientId
      || !guidPattern.test(objectId)
      || !email
      || !roles.includes(requiredAppRole)
      || this.stringClaim(claims.idp).toLowerCase() === 'live.com'
    ) {
      throw new UnauthorizedException('Microsoft account is not authorized for this application.');
    }
    return { objectId, email: email.toLowerCase() };
  }

  successUrl() {
    return `${this.applicationOrigin}/?microsoft=success`;
  }

  failureUrl() {
    return `${this.applicationOrigin}/?microsoft=denied`;
  }

  clearTransactionCookie(response: Response) {
    response.clearCookie(this.transactionCookieName(), {
      httpOnly: true,
      secure: this.production,
      sameSite: 'lax',
      path: transactionPath,
    });
  }

  private configuration() {
    if (!this.configurationPromise) {
      const issuer = new URL(`https://login.microsoftonline.com/${this.tenantId}/v2.0`);
      this.configurationPromise = oidc.discovery(
        issuer,
        this.clientId,
        { client_secret: this.clientSecret, id_token_signed_response_alg: 'RS256' },
        oidc.ClientSecretPost(this.clientSecret),
      ).then((configuration) => {
        configuration.timeout = 15;
        return configuration;
      }).catch((error) => {
        this.configurationPromise = undefined;
        throw error;
      });
    }
    return this.configurationPromise;
  }

  private encryptTransaction(transaction: Transaction) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.transactionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(transaction), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
  }

  private decryptTransaction(value: string): Transaction {
    try {
      const data = Buffer.from(value, 'base64url');
      if (data.length < 29) throw new Error('Invalid transaction');
      const decipher = createDecipheriv('aes-256-gcm', this.transactionKey, data.subarray(0, 12));
      decipher.setAuthTag(data.subarray(12, 28));
      const transaction = JSON.parse(
        Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8'),
      ) as Partial<Transaction>;
      if (
        transaction.version !== 1
        || typeof transaction.state !== 'string'
        || typeof transaction.nonce !== 'string'
        || typeof transaction.codeVerifier !== 'string'
        || typeof transaction.expiresAt !== 'number'
        || transaction.expiresAt < Date.now()
      ) {
        throw new Error('Expired transaction');
      }
      return transaction as Transaction;
    } catch {
      throw new UnauthorizedException('Microsoft sign-in session is invalid or expired.');
    }
  }

  private queryValue(request: Request, name: string, maximumLength: number) {
    const value = request.query[name];
    return typeof value === 'string' && value.length <= maximumLength ? value : '';
  }

  private cookie(request: Request, name: string) {
    const match = request.headers.cookie
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name}=`));
    return match?.slice(name.length + 1) ?? '';
  }

  private transactionCookieName() {
    return this.production ? '__Secure-medtech_hr_oidc' : 'medtech_hr_oidc';
  }

  private requiredGuid(name: string) {
    const value = this.configService.getOrThrow<string>(name);
    if (!guidPattern.test(value)) throw new Error(`${name} must be a valid GUID.`);
    return value;
  }

  private stringClaim(value: unknown) {
    return typeof value === 'string' ? value : '';
  }
}
