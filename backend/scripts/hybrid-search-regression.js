const assert = require('node:assert/strict');
const test = require('node:test');
const { PrismaClient } = require('@prisma/client');
const { plainToInstance } = require('class-transformer');
const { validateSync } = require('class-validator');
const { PaginationQueryDto } = require('../dist/common/dto/pagination-query.dto');
const { hybridListRecords, rankSearchCandidates } = require('../dist/common/utils/hybrid-search.util');

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
