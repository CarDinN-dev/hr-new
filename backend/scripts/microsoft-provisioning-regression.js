const assert = require('node:assert/strict');
const test = require('node:test');
const { ConfigService } = require('@nestjs/config');
const {
  MicrosoftDirectoryProvisioningService,
} = require('../dist/modules/system/microsoft-directory-provisioning.service');

const ids = {
  tenant: '11111111-1111-4111-8111-111111111111',
  client: '22222222-2222-4222-8222-222222222222',
  enterpriseApp: '33333333-3333-4333-8333-333333333333',
  role: '44444444-4444-4444-8444-444444444444',
  user: '55555555-5555-4555-8555-555555555555',
};

function service(overrides = {}) {
  return new MicrosoftDirectoryProvisioningService(new ConfigService({
    MICROSOFT_PROVISIONING_ENABLED: 'true',
    MICROSOFT_PROVISIONING_TENANT_ID: ids.tenant,
    MICROSOFT_PROVISIONING_CLIENT_ID: ids.client,
    MICROSOFT_PROVISIONING_CLIENT_SECRET: 'test-provisioning-secret-value',
    MICROSOFT_ENTERPRISE_APP_OBJECT_ID: ids.enterpriseApp,
    MICROSOFT_USER_APP_ROLE_ID: ids.role,
    ...overrides,
  }));
}

function response(status, body) {
  return new Response(body === undefined ? undefined : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function token() {
  return response(200, { access_token: 'graph-token', expires_in: 3600, token_type: 'Bearer' });
}

test('Microsoft provisioning fails closed when it is not configured', async () => {
  const disabled = new MicrosoftDirectoryProvisioningService(new ConfigService({}));
  await assert.rejects(() => disabled.provisionUser('person@example.com'), (error) => error.getStatus() === 503);
});

test('Microsoft provisioning verifies the account, grants the app role, and returns the object ID', async (t) => {
  const calls = [];
  t.mock.method(global, 'fetch', async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body });
    if (calls.length === 1) return token();
    if (calls.length === 2) return response(200, {
      id: ids.user,
      userPrincipalName: 'person@med-tech.com',
      mail: 'person@med-tech.com',
      accountEnabled: true,
      userType: 'Member',
    });
    if (calls.length === 3) return response(200, { value: [] });
    return response(201, { id: 'assignment-id', principalId: ids.user, appRoleId: ids.role });
  });

  const result = await service().provisionUser('Person@med-tech.com');
  assert.deepEqual(result, {
    objectId: ids.user,
    userPrincipalName: 'person@med-tech.com',
    assignmentCreated: true,
  });
  assert.equal(calls.length, 4);
  assert.match(calls[3].url, /appRoleAssignedTo$/);
  assert.deepEqual(JSON.parse(calls[3].body), {
    principalId: ids.user,
    resourceId: ids.enterpriseApp,
    appRoleId: ids.role,
  });
  assert.doesNotMatch(calls.map((call) => call.url).join('\n'), /test-provisioning-secret-value/);
});

test('Microsoft provisioning is idempotent when the app role already exists', async (t) => {
  const calls = [];
  t.mock.method(global, 'fetch', async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET' });
    if (calls.length === 1) return token();
    if (calls.length === 2) return response(200, {
      id: ids.user,
      userPrincipalName: 'person@med-tech.com',
      accountEnabled: true,
    });
    return response(200, { value: [{ id: 'assignment-id', principalId: ids.user, resourceId: ids.enterpriseApp, appRoleId: ids.role }] });
  });

  const result = await service().provisionUser('person@med-tech.com');
  assert.equal(result.assignmentCreated, false);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.method === 'GET' || calls.indexOf(call) === 0));
});

test('Microsoft provisioning rejects missing and disabled Entra users', async (t) => {
  let scenario = 'missing';
  t.mock.method(global, 'fetch', async (_url, _init = {}) => {
    if (String(_url).includes('/token')) return token();
    if (scenario === 'missing') return response(404, { error: { code: 'Request_ResourceNotFound' } });
    return response(200, {
      id: ids.user,
      userPrincipalName: 'person@med-tech.com',
      accountEnabled: false,
    });
  });

  await assert.rejects(() => service().provisionUser('person@med-tech.com'), (error) => error.getStatus() === 400);
  scenario = 'disabled';
  await assert.rejects(() => service().provisionUser('person@med-tech.com'), (error) => error.getStatus() === 400);
});
