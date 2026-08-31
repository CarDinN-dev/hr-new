const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');
const express = require('express');

const repository = resolve(__dirname, '../..');

test('one trusted proxy preserves distinct client IPs for throttling and audit attribution', async (t) => {
  const app = express();
  app.set('trust proxy', 1);
  app.get('/', (request, response) => response.json({ ip: request.ip }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolveListen) => server.once('listening', resolveListen));
  t.after(() => server.close());
  const { port } = server.address();
  const client = async (ip) => (await (await fetch(`http://127.0.0.1:${port}/`, { headers: { 'x-forwarded-for': ip } })).json()).ip;
  assert.equal(await client('198.51.100.10'), '198.51.100.10');
  assert.equal(await client('203.0.113.20'), '203.0.113.20');
});

test('the public Nginx boundary overwrites spoofable forwarding headers and bypasses the Docker proxy', () => {
  const config = readFileSync(resolve(repository, 'ops/hr-med-tech-http.conf'), 'utf8');
  const apiLocation = config.match(/location \/api\/ \{[^}]*\}/)?.[0] ?? '';
  assert.match(apiLocation, /proxy_pass http:\/\/127\.0\.0\.1:3100;/);
  assert.doesNotMatch(apiLocation, /127\.0\.0\.1:8080/);
  assert.ok((config.match(/proxy_set_header X-Real-IP \$remote_addr;/g) ?? []).length >= 2);
  assert.ok((config.match(/proxy_set_header X-Forwarded-For \$remote_addr;/g) ?? []).length >= 2);
  assert.doesNotMatch(config, /proxy_set_header X-Forwarded-For \$http_x_forwarded_for/);
  assert.match(config, /return 301 https:\/\/hr\.med-tech\.com\$request_uri;/);
  assert.doesNotMatch(config, /return 301 https:\/\/\$host/);
  assert.match(config, /listen 80 default_server;[\s\S]*?return 444;/);
  assert.match(config, /listen 443 ssl default_server;[\s\S]*?ssl_reject_handshake on;/);
});

test('the Microsoft callback access log omits query arguments', () => {
  const config = readFileSync(resolve(repository, 'ops/hr-med-tech-http.conf'), 'utf8');
  const format = config.match(/log_format hr_erp_callback_safe[\s\S]*?;/)?.[0] ?? '';
  const callback = config.match(/location = \/api\/v1\/auth\/microsoft\/callback \{[\s\S]*?\n  \}/)?.[0] ?? '';
  assert.match(format, /\$uri/);
  assert.doesNotMatch(format, /\$request(?:_uri)?\b/);
  assert.match(callback, /access_log \/var\/log\/nginx\/access\.log hr_erp_callback_safe;/);
});
