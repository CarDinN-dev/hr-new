import { createPrivateKey, createSign, randomUUID, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';

const certificateThumbprintPattern = /^[0-9a-f]{40}$/i;

export function microsoftCertificateThumbprint(value: string, name: string) {
  const normalized = value.replace(/[\s:]/g, '');
  if (!certificateThumbprintPattern.test(normalized)) throw new Error(`${name} must be a SHA-1 certificate thumbprint.`);
  return Buffer.from(normalized, 'hex').toString('base64url');
}

export function loadMicrosoftRsaPrivateKey(path: string, name: string) {
  try {
    const key = createPrivateKey(readFileSync(path, 'utf8'));
    if (key.asymmetricKeyType !== 'rsa') throw new Error('not RSA');
    return key;
  } catch {
    throw new Error(`${name} must point to a readable RSA private key.`);
  }
}

export function createMicrosoftClientAssertion(options: {
  tenantId: string;
  clientId: string;
  certificateThumbprint: string;
  privateKey: KeyObject;
  now?: number;
}) {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const audience = `https://login.microsoftonline.com/${options.tenantId}/oauth2/v2.0/token`;
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', x5t: options.certificateThumbprint })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({
    aud: audience,
    iss: options.clientId,
    sub: options.clientId,
    jti: randomUUID(),
    nbf: now - 60,
    exp: now + 600,
  })).toString('base64url');
  const input = `${header}.${claims}`;
  const signer = createSign('RSA-SHA256');
  signer.update(input);
  signer.end();
  return `${input}.${signer.sign(options.privateKey).toString('base64url')}`;
}
