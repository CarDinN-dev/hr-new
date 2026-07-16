import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AnnouncementsModule } from './modules/announcements/announcements.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuthorizationModule } from './modules/authorization/authorization.module';
import { PermissionsGuard } from './modules/authorization/permissions.guard';
import { CsrfGuard } from './modules/auth/guards/csrf.guard';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { DepartmentsModule } from './modules/departments/departments.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { EmploymentContractsModule } from './modules/employment-contracts/employment-contracts.module';
import { JobPositionsModule } from './modules/job-positions/job-positions.module';
import { LeaveModule } from './modules/leave/leave.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { PerformanceReviewsModule } from './modules/performance-reviews/performance-reviews.module';
import { PrismaModule } from './prisma/prisma.module';
import { HealthController } from './health.controller';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { AuditModule } from './modules/audit/audit.module';
import { LoansModule } from './modules/loans/loans.module';
import { OperationsModule } from './modules/operations/operations.module';
import { SystemModule } from './modules/system/system.module';
import { ServiceRequestsModule } from './modules/service-requests/service-requests.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuditModule,
    AuthorizationModule,
    AuthModule,
    EmployeesModule,
    DepartmentsModule,
    JobPositionsModule,
    EmploymentContractsModule,
    AttendanceModule,
    LeaveModule,
    LoansModule,
    OperationsModule,
    SystemModule,
    ServiceRequestsModule,
    NotificationsModule,
    ApprovalsModule,
    PayrollModule,
    PerformanceReviewsModule,
    DocumentsModule,
    AnnouncementsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
