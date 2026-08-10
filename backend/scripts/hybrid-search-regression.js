const assert = require('node:assert/strict');
const test = require('node:test');
const { Prisma, PrismaClient } = require('@prisma/client');
const { plainToInstance } = require('class-transformer');
const { validateSync } = require('class-validator');
const { PaginationQueryDto } = require('../dist/common/dto/pagination-query.dto');
const { QuerySystemSessionsDto, QuerySystemUsersDto } = require('../dist/modules/system/dto/system.dto');
const { hybridListRecords, rankSearchCandidates } = require('../dist/common/utils/hybrid-search.util');
const { LoansService } = require('../dist/modules/loans/loans.service');
const { AuditService } = require('../dist/modules/audit/audit.service');
const { SearchController } = require('../dist/search.controller');

function candidatesFrom(sql) {
  return JSON.parse(sql.values.find(value => typeof value === 'string' && value.startsWith('[{')));
}

test('search input is trimmed and constrained to 2-100 characters', () => {
  const valid = plainToInstance(PaginationQueryDto, { search: '  Alice Smith  ' });
  assert.equal(validateSync(valid).length, 0);
  assert.equal(valid.search, 'Alice Smith');
  for (const search of ['x', 'x'.repeat(101)]) {
    assert.ok(validateSync(plainToInstance(PaginationQueryDto, { search })).some(error => error.property === 'search'));
  }
  const empty = plainToInstance(PaginationQueryDto, { search: '   ' });
  assert.equal(validateSync(empty).length, 0);
  assert.equal(empty.search, undefined);
});

test('system section search is trimmed and constrained to 2-100 characters', () => {
  for (const QueryDto of [QuerySystemUsersDto, QuerySystemSessionsDto]) {
    const valid = plainToInstance(QueryDto, { filterSearch: '  Alice Smith  ' });
    assert.equal(validateSync(valid).length, 0);
    assert.equal(valid.filterSearch, 'Alice Smith');
    for (const filterSearch of ['x', 'x'.repeat(101)]) {
      assert.ok(validateSync(plainToInstance(QueryDto, { filterSearch })).some(error => error.property === 'filterSearch'));
    }
  }
});

test('hybrid pagination resolves the authorized scope before ranking', async () => {
  const records = [
    { id: 'scope-1', name: 'Alice Smith' },
    { id: 'scope-2', name: 'Alicia Smyth' },
    { id: 'scope-3', name: 'Bob Jones' },
  ];
  const delegate = {
    async findMany(args) {
      assert.deepEqual(args.where.AND, [{ deletedAt: null }, { tenantId: 'authorized' }]);
      assert.equal(args.take, undefined);
      return records;
    },
  };
  const prisma = { async $queryRaw(sql) {
    assert.ok(sql.values.includes('alice'));
    assert.ok(!sql.strings.join('').includes('alice'));
    return [{ id: 'scope-1', score: 10 }, { id: 'scope-2', score: 5 }];
  } };
  const result = await hybridListRecords(prisma, delegate, { page: 2, limit: 1, search: 'alice' }, {
    where: { tenantId: 'authorized' },
    searchDocument: record => record.name,
  });
  assert.deepEqual(result.data.map(record => record.id), ['scope-2']);
  assert.deepEqual(result.meta, { total: 2, page: 2, limit: 1, totalPages: 2 });
});

test('additional search intersects authorized matches before pagination and preserves primary rank', async () => {
  const records = [
    { id: 'scope-1', name: 'Alice Smith' },
    { id: 'scope-2', name: 'Alice Jones' },
    { id: 'scope-3', name: 'Bob Smith' },
  ];
  const delegate = {
    async findMany(args) {
      assert.deepEqual(args.where.AND, [{ deletedAt: null }, { tenantId: 'authorized' }]);
      return records;
    },
  };
  const searches = [];
  const prisma = { async $queryRaw(sql) {
    const search = sql.values.find(value => typeof value === 'string' && !value.startsWith('['));
    searches.push(search);
    return search === 'alice'
      ? [{ id: 'scope-2', score: 10 }, { id: 'scope-1', score: 9 }]
      : [{ id: 'scope-3', score: 10 }, { id: 'scope-1', score: 9 }];
  } };
  const result = await hybridListRecords(prisma, delegate, { page: 1, limit: 1, search: 'alice' }, {
    where: { tenantId: 'authorized' }, additionalSearch: 'smith', searchDocument: record => record.name,
  });
  assert.deepEqual(searches, ['alice', 'smith']);
  assert.deepEqual(result.data.map(record => record.id), ['scope-1']);
  assert.deepEqual(result.meta, { total: 1, page: 1, limit: 1, totalPages: 1 });
});

test('loan search uses department name and code instead of its UUID', async () => {
  let candidates;
  const loan = {
    id: 'loan-1', principal: new Prisma.Decimal(1000), repayments: [], employeeId: 'employee-1',
    employee: { id: 'employee-1', employeeCode: 'MTC001', firstName: 'Alice', lastName: 'Smith', department: { id: 'department-id', name: 'Finance', code: 'FIN' } },
    type: 'Advance', reference: 'REF-1', notes: 'Relocation', status: 'ACTIVE', startYear: 2026, startMonth: 8,
  };
  const prisma = {
    employeeLoan: { findMany: async () => [loan] },
    $queryRaw: async sql => { candidates = candidatesFrom(sql); return [{ id: loan.id, score: 1 }]; },
  };
  const authorization = { scopeRule: () => ({ unrestricted: true, includeIds: [], excludeIds: [] }) };
  await new LoansService(prisma, {}, authorization).list({ page: 1, limit: 20, search: 'Finance' }, { employeeId: null });
  assert.match(candidates[0].document, /Finance/);
  assert.match(candidates[0].document, /FIN/);
  assert.doesNotMatch(candidates[0].document, /department-id/);
});

test('audit search document includes the event summary', async () => {
  let candidates;
  const event = {
    id: 'audit-1', sequence: 1n, summary: 'Unique employee import completed', reason: 'Approved',
    actorNameSnapshot: 'Search Admin', actorEmailSnapshot: 'admin@example.invalid', actorRoleCodesSnapshot: ['SUPER_ADMIN'],
    module: 'employees', action: 'IMPORT', outcome: 'SUCCESS', resourceType: 'Employee', resourceId: 'employee-1',
    permissionCode: 'employee.hr.create', requestId: 'request-1', correlationId: null, workflowId: null,
    workflowStage: null, workflowStatus: null, payrollPeriod: null, requestType: null, changedFields: [],
  };
  const prisma = {
    auditEvent: { findMany: async () => [event] },
    $queryRaw: async sql => { candidates = candidatesFrom(sql); return [{ id: event.id, score: 1 }]; },
  };
  const authorization = { scopeRule: () => ({ unrestricted: true, includeIds: [], excludeIds: [] }) };
  const config = { get: () => 'test-secret', getOrThrow: () => 'test-secret' };
  await new AuditService(prisma, config, {}, authorization).list({ page: 1, limit: 20, search: 'Unique employee import' }, {});
  assert.match(candidates[0].document, /Unique employee import completed/);
});

test('dashboard section search exposes only rendered filterable panels', async () => {
  let candidates;
  const controller = new SearchController({ $queryRaw: async sql => { candidates = candidatesFrom(sql); return []; } });
  await controller.searchSections({ page: 'dashboard', search: 'payroll' });
  assert.deepEqual(candidates.map(candidate => candidate.id), ['headcount', 'leave-approvals', 'birthdays', 'recent-joiners']);
});

const integrationUrl = process.env.INTEGRATION_DATABASE_URL;
test('PostgreSQL ranks exact, prefix, full-text and misspelled matches', { skip: !integrationUrl }, async () => {
  const prisma = new PrismaClient({ datasources: { db: { url: integrationUrl } } });
  try {
    await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    const candidates = [
      { id: 'exact', document: 'Alice Smith\u001fFinance manager', ordinal: 0 },
      { id: 'prefix', document: 'Alicia Stone\u001fFinance', ordinal: 1 },
      { id: 'full-text', document: 'Bob Jones\u001fSenior finance manager', ordinal: 2 },
      { id: 'unrelated', document: 'Carol Brown\u001fEngineering', ordinal: 3 },
    ];
    assert.equal((await rankSearchCandidates(prisma, 'Alice Smith', candidates))[0].id, 'exact');
    assert.ok((await rankSearchCandidates(prisma, 'Alic', candidates)).some(item => item.id === 'prefix'));
    assert.ok((await rankSearchCandidates(prisma, 'finance manager', candidates)).some(item => item.id === 'full-text'));
    assert.ok((await rankSearchCandidates(prisma, 'Alcie Smith', candidates)).some(item => item.id === 'exact'));
    assert.equal((await rankSearchCandidates(prisma, 'unfindable phrase', candidates)).length, 0);
  } finally {
    await prisma.$disconnect();
  }
});
