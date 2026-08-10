import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { AnyPermission } from './common/decorators/permissions.decorator';
import { rankSearchCandidates } from './common/utils/hybrid-search.util';
import { PrismaService } from './prisma/prisma.service';

const sections = {
  dashboard: [
    ['headcount', 'Headcount by department workforce employees'],
    ['leave-approvals', 'Leave approvals pending requests workflow'],
    ['birthdays', 'Upcoming birthdays employees'],
    ['recent-joiners', 'Recent joiners new employees'],
  ],
  reports: [
    ['employee_directory', 'Employee Directory full staff employment contact and status'],
    ['attendance_report', 'Monthly Attendance present half-day leave absence percentage'],
    ['leave_report', 'Leave Register applications duration reason and approval state'],
    ['payroll_register', 'Payroll Register gross additions deductions loss of pay and net salary'],
    ['headcount_report', 'Department Headcount active workforce split by department'],
  ],
  settings: [
    ['company', 'Company profile legal name contact address'],
    ['sessions', 'Signed-in sessions devices security'],
    ['departments', 'Departments organization structure'],
    ['leave-types', 'Leave types allowance policies'],
    ['payroll-policy', 'Payroll policy proration attendance bank details'],
    ['loan-policy', 'Loan policy caps deductions'],
  ],
} as const;

class SectionsSearchQuery {
  @IsIn(Object.keys(sections)) page: keyof typeof sections;
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(2) @MaxLength(100) search: string;
}

@ApiTags('Search')
@ApiBearerAuth()
@Controller('search')
export class SearchController {
  constructor(private readonly prisma: PrismaService) {}

  @AnyPermission(
    'employee.self.read', 'employee.team.read', 'employee.hr.read', 'attendance.self.read', 'attendance.hr.read',
    'leave.self.read', 'leave.team.read', 'leave.hr.read', 'loan.self.read', 'loan.hr.read',
    'payroll.self.read_payslip', 'payroll.read', 'recruitment.read', 'eos.read', 'document.self.read',
    'document.hr.read', 'audit.read', 'system.configure', 'organization.read', 'session.self.read',
  )
  @Get('sections')
  async searchSections(@Query() query: SectionsSearchQuery) {
    const data = await rankSearchCandidates(
      this.prisma,
      query.search,
      sections[query.page].map(([id, document], ordinal) => ({ id, document, ordinal })),
    );
    return { data };
  }
}
