import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export type MoneyInput = Prisma.Decimal.Value;
export const ZERO_MONEY = new Prisma.Decimal(0);

export function money(value: MoneyInput, field = 'amount') {
  let parsed: Prisma.Decimal;
  try {
    parsed = new Prisma.Decimal(value);
  } catch {
    throw new BadRequestException(`${field} must be a valid decimal amount`);
  }
  if (!parsed.isFinite()) throw new BadRequestException(`${field} must be a finite decimal amount`);
  return parsed.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export function nonNegativeMoney(value: MoneyInput, field = 'amount', maximum?: MoneyInput) {
  const parsed = money(value, field);
  if (parsed.isNegative()) throw new BadRequestException(`${field} cannot be negative`);
  if (maximum !== undefined && parsed.gt(maximum)) throw new BadRequestException(`${field} exceeds the allowed maximum`);
  return parsed;
}

export function sumMoney(values: MoneyInput[]) {
  return money(
    values.reduce<Prisma.Decimal>((sum, value) => sum.plus(value), ZERO_MONEY),
  );
}

export function percentageMoney(value: MoneyInput, percent: MoneyInput) {
  return money(new Prisma.Decimal(value).times(percent).div(100));
}

export function moneyString(value: MoneyInput) {
  return money(value).toFixed(2);
}
