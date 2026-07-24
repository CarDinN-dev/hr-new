import { Body, Controller, Get, Headers, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AnyPermission, PayrollRoles, Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/types/request-user.type';
import { GeneratePayrollDto } from './dto/generate-payroll.dto';
import { CreatePayrollAdjustmentDto, QueryPayrollAdjustmentsDto } from './dto/payroll-adjustment.dto';
import { MarkPayrollPaidDto, ReconcilePayrollPaymentsDto } from './dto/payment-reconciliation.dto';
import { PayrollReasonTransitionDto, PayrollTransitionDto } from './dto/payroll-workflow.dto';
import { QueryPayrollDto } from './dto/query-payroll.dto';
import { PayrollService } from './payroll.service';

@ApiTags('Payroll')
@ApiBearerAuth()
@PayrollRoles('HR', 'CPO', 'COO')
@Controller('payroll')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @PayrollRoles('HR') @Permissions('payroll.generate') @Get('preflight') preflight(@Query() dto: GeneratePayrollDto, @CurrentUser() user: RequestUser) { return this.payroll.preflight(dto, user); }
  @PayrollRoles('HR') @Permissions('payroll.generate') @Post('adjustments') createAdjustment(@Body() dto: CreatePayrollAdjustmentDto, @CurrentUser() user: RequestUser) { return this.payroll.createAdjustment(dto, user); }
  @Permissions('payroll.read') @Get('adjustments') adjustments(@Query() query: QueryPayrollAdjustmentsDto, @CurrentUser() user: RequestUser) { return this.payroll.listAdjustments(query, user); }
  @PayrollRoles('HR') @Permissions('payroll.generate') @Post('runs') generateRun(@Body() dto: GeneratePayrollDto, @Headers('idempotency-key') key: string | undefined, @CurrentUser() user: RequestUser) { return this.payroll.generate(dto, key, user); }
  @AnyPermission('payroll.read', 'payroll.audit.read') @Get('runs') runs(@Query() query: QueryPayrollDto, @CurrentUser() user: RequestUser) { return this.payroll.listRuns(query, user); }
  @AnyPermission('payroll.read', 'payroll.audit.read') @Get('runs/:id') run(@Param('id') id: string, @CurrentUser() user: RequestUser) { return this.payroll.findRun(id, user); }
  @PayrollRoles('HR') @Permissions('payroll.mark_paid') @Get('runs/:id/wps-preflight') wpsPreflight(@Param('id') id: string, @CurrentUser() user: RequestUser) { return this.payroll.wpsPreflight(id, user); }
  @Permissions('payroll.export') @Get('departments') departments(@CurrentUser() user: RequestUser) { return this.payroll.listExportDepartments(user); }
  @PayrollRoles('HR') @Permissions('payroll.generate') @Post('runs/:id/submit') submit(@Param('id') id: string, @Body() dto: PayrollTransitionDto, @Headers('idempotency-key') key: string | undefined, @CurrentUser() user: RequestUser) { return this.payroll.submit(id, dto, key, user); }
  @PayrollRoles('HR') @Permissions('payroll.approve') @Post('runs/:id/approve') approve(@Param('id') id: string, @Body() dto: PayrollTransitionDto, @Headers('idempotency-key') key: string | undefined, @CurrentUser() user: RequestUser) { return this.payroll.approve(id, dto, key, user); }
  @PayrollRoles('HR') @Permissions('payroll.publish') @Post('runs/:id/publish') publish(@Param('id') id: string, @Body() dto: PayrollTransitionDto, @Headers('idempotency-key') key: string | undefined, @CurrentUser() user: RequestUser) { return this.payroll.publish(id, dto, key, user); }
  @PayrollRoles('HR') @Permissions('payroll.mark_paid') @Post('runs/:id/mark-paid') markPaid(@Param('id') id: string, @Body() dto: MarkPayrollPaidDto, @Headers('idempotency-key') key: string | undefined, @CurrentUser() user: RequestUser) { return this.payroll.markPaid(id, dto, key, user); }
  @PayrollRoles('HR') @Permissions('payroll.mark_paid') @Post('runs/:id/reconcile-payments') reconcilePayments(@Param('id') id: string, @Body() dto: ReconcilePayrollPaymentsDto, @Headers('idempotency-key') key: string | undefined, @CurrentUser() user: RequestUser) { return this.payroll.reconcilePayments(id, dto, key, user); }
  @PayrollRoles('HR') @Permissions('payroll.generate') @Post('runs/:id/cancel') cancel(@Param('id') id: string, @Body() dto: PayrollReasonTransitionDto, @Headers('idempotency-key') key: string | undefined, @CurrentUser() user: RequestUser) { return this.payroll.cancel(id, dto, key, user); }
  @PayrollRoles('HR') @Permissions('payroll.override') @Post('runs/:id/correction') correction(@Param('id') id: string, @Body() dto: PayrollReasonTransitionDto, @Headers('idempotency-key') key: string | undefined, @CurrentUser() user: RequestUser) { return this.payroll.correct(id, dto, key, user); }

  @Permissions('payroll.self.read_payslip') @Get('payslips/me') myPayslips(@Query() query: QueryPayrollDto, @CurrentUser() user: RequestUser) { return this.payroll.listMyPayslips(query, user); }
  @Permissions('payroll.payslip.read_all') @Get('payslips') payslips(@Query() query: QueryPayrollDto, @CurrentUser() user: RequestUser) { return this.payroll.listPayslips(query, user); }
  @AnyPermission('payroll.self.read_payslip', 'payroll.pdf.download_all') @Get('payslips/:id/download') async download(@Param('id') id: string, @CurrentUser() user: RequestUser, @Res() response: Response) {
    const file = await this.payroll.downloadPayslip(id, user);
    response.setHeader('Content-Type', 'application/pdf'); response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`); response.send(file.buffer);
  }
  @Permissions('payroll.export') @Get('runs/:id/export') async exportRun(@Param('id') id: string, @Query('departmentId') departmentId: string | undefined, @CurrentUser() user: RequestUser, @Res() response: Response) {
    const file = await this.payroll.exportRun(id, departmentId, user);
    response.setHeader('Content-Type', 'text/csv; charset=utf-8'); response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`); response.send(file.buffer);
  }
  @PayrollRoles('HR') @Permissions('payroll.mark_paid') @Get('runs/:id/wps-export') async exportWps(@Param('id') id: string, @CurrentUser() user: RequestUser, @Res() response: Response) {
    const file = await this.payroll.exportWps(id, user);
    response.setHeader('Content-Type', 'text/csv; charset=utf-8'); response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`); response.send(file.buffer);
  }

}
