import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaginationQueryDto } from '../dto/pagination-query.dto';

type PrismaDelegate = {
  findMany(args?: unknown): Promise<unknown[]>;
  count(args?: unknown): Promise<number>;
  findFirst(args?: unknown): Promise<unknown | null>;
  findUnique(args?: unknown): Promise<unknown | null>;
  create(args: unknown): Promise<unknown>;
  update(args: unknown): Promise<unknown>;
};

type ListOptions = {
  searchFields?: string[];
  defaultSortBy?: string;
  allowedSortFields?: string[];
  where?: Record<string, unknown>;
  include?: Record<string, unknown>;
  select?: Record<string, unknown>;
};

export function paginationMeta(total: number, page: number, limit: number) {
  return {
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

export function listArgs(query: PaginationQueryDto, options: ListOptions = {}): any {
  const page = query.page || 1;
  const limit = query.limit || 20;
  const skip = (page - 1) * limit;
  const sortBy = query.sortBy || options.defaultSortBy || 'createdAt';

  if (options.allowedSortFields?.length && !options.allowedSortFields.includes(sortBy)) {
    throw new BadRequestException(`Unsupported sort field: ${sortBy}`);
  }

  const filters: Record<string, unknown>[] = [{ deletedAt: null }];
  if (options.where && Object.keys(options.where).length) {
    filters.push(options.where);
  }
  if (query.search && options.searchFields?.length) {
    filters.push({
      OR: options.searchFields.map((field) => ({
        [field]: { contains: query.search, mode: 'insensitive' },
      })),
    });
  }

  const where = filters.length ? { AND: filters } : {};

  return {
    where,
    skip,
    take: limit,
    orderBy: { [sortBy]: query.sortOrder || 'desc' },
    include: options.select ? undefined : options.include,
    select: options.select,
    page,
    limit,
  };
}

export async function listRecords(
  delegate: PrismaDelegate,
  query: PaginationQueryDto,
  options: ListOptions = {},
) {
  const { page, limit, ...args } = listArgs(query, options);
  const [data, total] = await Promise.all([delegate.findMany(args), delegate.count({ where: args.where })]);
  return { data, meta: paginationMeta(total, page, limit) };
}

export async function findActiveOrThrow(
  delegate: Pick<PrismaDelegate, 'findFirst'>,
  id: string,
  modelName: string,
  include?: Record<string, unknown>,
) {
  const record = await delegate.findFirst({ where: { id, deletedAt: null }, include });
  if (!record) {
    throw new NotFoundException(`${modelName} not found`);
  }
  return record;
}

export async function softDelete(
  delegate: Pick<PrismaDelegate, 'update'>,
  id: string,
  _modelName: string,
) {
  return delegate.update({ where: { id }, data: { deletedAt: new Date() } });
}
