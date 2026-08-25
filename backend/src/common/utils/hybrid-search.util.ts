import { Prisma } from '@prisma/client';
import { PaginationQueryDto } from '../dto/pagination-query.dto';
import { paginationMeta, listArgs } from './crud.util';
import { PrismaService } from '../../prisma/prisma.service';

const separator = '\u001f';

type SearchableRecord = { id: string };
type SearchDelegate<T extends SearchableRecord> = {
  findMany(args?: unknown): Promise<T[]>;
};

type HybridListOptions<T extends SearchableRecord> = Parameters<typeof listArgs>[1] & {
  additionalSearch?: string;
  searchDocument(record: T): string;
};

export function searchText(...values: unknown[]) {
  return values
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter((value) => value !== null && value !== undefined && value !== '')
    .map((value) => value instanceof Date ? value.toISOString() : String(value))
    .join(separator);
}

export async function rankSearchCandidates(
  prisma: PrismaService,
  search: string,
  candidates: Array<{ id: string; document: string; ordinal?: number }>,
) {
  if (!candidates.length) return [];

  return prisma.$queryRaw<Array<{ id: string; score: number }>>(Prisma.sql`
    WITH input AS (
      SELECT ${search}::text AS query
    ), candidates AS (
      SELECT id, document, ordinal
      FROM jsonb_to_recordset(${JSON.stringify(candidates)}::jsonb)
        AS candidate(id text, document text, ordinal integer)
    ), ranked AS (
      SELECT
        candidate.id,
        candidate.ordinal,
        (
          CASE WHEN EXISTS (
            SELECT 1 FROM unnest(string_to_array(candidate.document, ${separator})) AS field(value)
            WHERE lower(trim(field.value)) = lower(input.query)
          ) THEN 8 ELSE 0 END
          + CASE WHEN EXISTS (
            SELECT 1 FROM unnest(string_to_array(candidate.document, ${separator})) AS field(value)
            WHERE lower(trim(field.value)) LIKE lower(input.query) || '%'
          ) THEN 4 ELSE 0 END
          + CASE WHEN lower(candidate.document) LIKE '%' || lower(input.query) || '%' THEN 2 ELSE 0 END
          + ts_rank_cd(
              to_tsvector('simple', coalesce(candidate.document, '')),
              websearch_to_tsquery('simple', input.query)
            ) * 3
          + greatest(
              similarity(lower(candidate.document), lower(input.query)),
              word_similarity(lower(input.query), lower(candidate.document))
            )
        )::double precision AS score
      FROM candidates candidate
      CROSS JOIN input
      WHERE
        to_tsvector('simple', coalesce(candidate.document, '')) @@ websearch_to_tsquery('simple', input.query)
        OR lower(candidate.document) LIKE '%' || lower(input.query) || '%'
        OR similarity(lower(candidate.document), lower(input.query)) >= 0.18
        OR word_similarity(lower(input.query), lower(candidate.document)) >= 0.35
    )
    SELECT id, score
    FROM ranked
    ORDER BY score DESC, ordinal ASC, id ASC
  `);
}

export async function rankSearchRecords<T extends SearchableRecord>(
  prisma: PrismaService,
  search: string | undefined,
  records: T[],
  searchDocument: (record: T) => string,
) {
  if (!search) return records;
  const ranked = await rankSearchCandidates(
    prisma,
    search,
    records.map((record, ordinal) => ({ id: record.id, document: searchDocument(record), ordinal })),
  );
  const byId = new Map(records.map((record) => [record.id, record]));
  return ranked.map(({ id }) => byId.get(id)).filter((record): record is T => Boolean(record));
}

export async function hybridListRecords<T extends SearchableRecord>(
  prisma: PrismaService,
  delegate: SearchDelegate<T>,
  query: PaginationQueryDto,
  options: HybridListOptions<T>,
) {
  const primarySearch = query.search || options.additionalSearch;
  const additionalSearch = query.search ? options.additionalSearch : undefined;
  if (!primarySearch) {
    const { page, limit, ...args } = listArgs(query, options);
    const [data, total] = await Promise.all([
      delegate.findMany(args),
      (delegate as SearchDelegate<T> & { count(args?: unknown): Promise<number> }).count({ where: args.where }),
    ]);
    return { data, meta: paginationMeta(total, page, limit) };
  }

  const page = query.page || 1;
  const limit = query.limit || 20;
  const authorizedArgs = listArgs(
    { ...query, search: undefined },
    options,
  );
  delete authorizedArgs.page;
  delete authorizedArgs.limit;
  delete authorizedArgs.skip;
  delete authorizedArgs.take;
  const authorized = await delegate.findMany(authorizedArgs);
  const ranked = await rankSearchCandidates(
    prisma,
    primarySearch,
    authorized.map((record, ordinal) => ({ id: record.id, document: options.searchDocument(record), ordinal })),
  );
  const additionalIds = additionalSearch
    ? new Set((await rankSearchCandidates(
      prisma,
      additionalSearch,
      authorized.map((record, ordinal) => ({ id: record.id, document: options.searchDocument(record), ordinal })),
    )).map(({ id }) => id))
    : null;
  const matches = additionalIds ? ranked.filter(({ id }) => additionalIds.has(id)) : ranked;
  const records = new Map(authorized.map((record) => [record.id, record]));
  const data = matches
    .slice((page - 1) * limit, page * limit)
    .map(({ id }) => records.get(id))
    .filter((record): record is T => Boolean(record));

  return { data, meta: paginationMeta(matches.length, page, limit) };
}
