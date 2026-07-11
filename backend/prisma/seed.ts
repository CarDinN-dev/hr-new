import { PrismaClient, Role, Permission, Gender, EmploymentStatus, ContractType, ContractStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS ?? 12);
  const passwordFor = (envName: string) => {
    const value = process.env[envName];
    if (!value) throw new Error(`${envName} must be set before seeding.`);
    return value;
  };
  const allPermissions = Object.values(Permission);
  const loginUsers = [
    { email: 'hr@med-tech.com', password: passwordFor('HR_ADMIN_PASSWORD'), role: Role.SUPER_ADMIN },
    { email: 'zahira@med-tech.com', password: passwordFor('ZAHIRA_ADMIN_PASSWORD'), role: Role.HR_ADMIN },
    { email: 'kashif@med-tech.com', password: passwordFor('KASHIF_ADMIN_PASSWORD'), role: Role.HR_ADMIN },
    { email: 'athul@med-tech.com', password: passwordFor('ATHUL_ADMIN_PASSWORD'), role: Role.HR_ADMIN },
  ];
  const [superAdminLogin, ...hrLogins] = loginUsers;
  const passwordHash = await bcrypt.hash(superAdminLogin.password, saltRounds);

  const superAdminUser = await prisma.user.upsert({
    where: { email: superAdminLogin.email },
    update: {
      passwordHash,
      role: superAdminLogin.role,
      permissions: allPermissions,
      isActive: true,
      deletedAt: null,
    },
    create: {
      email: superAdminLogin.email,
      passwordHash,
      role: superAdminLogin.role,
      permissions: allPermissions,
    },
  });

  for (const loginUser of hrLogins) {
    await prisma.user.upsert({
      where: { email: loginUser.email },
      update: {
        passwordHash: await bcrypt.hash(loginUser.password, saltRounds),
        role: loginUser.role,
        permissions: allPermissions,
        isActive: true,
        deletedAt: null,
      },
      create: {
        email: loginUser.email,
        passwordHash: await bcrypt.hash(loginUser.password, saltRounds),
        role: loginUser.role,
        permissions: allPermissions,
      },
    });
  }

  const managerPasswordHash = await bcrypt.hash(passwordFor('MANAGER_PASSWORD'), saltRounds);
  const managerUser = await prisma.user.upsert({
    where: { email: 'manager@example.com' },
    update: {
      passwordHash: managerPasswordHash,
      role: Role.MANAGER,
      permissions: [Permission.ATTENDANCE_READ_ALL, Permission.LEAVE_APPROVE],
      isActive: true,
      deletedAt: null,
    },
    create: {
      email: 'manager@example.com',
      passwordHash: managerPasswordHash,
      role: Role.MANAGER,
      permissions: [Permission.ATTENDANCE_READ_ALL, Permission.LEAVE_APPROVE],
    },
  });

  const employeePasswordHash = await bcrypt.hash(passwordFor('EMPLOYEE_PASSWORD'), saltRounds);
  const employeeUser = await prisma.user.upsert({
    where: { email: 'employee@example.com' },
    update: {
      passwordHash: employeePasswordHash,
      role: Role.EMPLOYEE,
      permissions: [],
      isActive: true,
      deletedAt: null,
    },
    create: {
      email: 'employee@example.com',
      passwordHash: employeePasswordHash,
      role: Role.EMPLOYEE,
      permissions: [],
    },
  });

  const hrDepartment = await prisma.department.upsert({
    where: { code: 'HR' },
    update: { name: 'Human Resources', deletedAt: null },
    create: { code: 'HR', name: 'Human Resources', description: 'People operations and compliance' },
  });
  const engineeringDepartment = await prisma.department.upsert({
    where: { code: 'ENG' },
    update: { name: 'Engineering', deletedAt: null },
    create: { code: 'ENG', name: 'Engineering', description: 'Product engineering team' },
  });
  const financeDepartment = await prisma.department.upsert({
    where: { code: 'FIN' },
    update: { name: 'Finance', deletedAt: null },
    create: { code: 'FIN', name: 'Finance', description: 'Finance and accounting' },
  });

  const hrAdminPosition = await prisma.jobPosition.upsert({
    where: { code: 'HR-ADMIN' },
    update: { title: 'HR Administrator', departmentId: hrDepartment.id, deletedAt: null },
    create: {
      code: 'HR-ADMIN',
      title: 'HR Administrator',
      departmentId: hrDepartment.id,
      level: 'L4',
    },
  });
  const managerPosition = await prisma.jobPosition.upsert({
    where: { code: 'ENG-MGR' },
    update: { title: 'Engineering Manager', departmentId: engineeringDepartment.id, deletedAt: null },
    create: {
      code: 'ENG-MGR',
      title: 'Engineering Manager',
      departmentId: engineeringDepartment.id,
      level: 'L5',
    },
  });
  const engineerPosition = await prisma.jobPosition.upsert({
    where: { code: 'SWE' },
    update: { title: 'Software Engineer', departmentId: engineeringDepartment.id, deletedAt: null },
    create: {
      code: 'SWE',
      title: 'Software Engineer',
      departmentId: engineeringDepartment.id,
      level: 'L3',
    },
  });
  await prisma.jobPosition.upsert({
    where: { code: 'FIN-ANL' },
    update: { title: 'Finance Analyst', departmentId: financeDepartment.id, deletedAt: null },
    create: {
      code: 'FIN-ANL',
      title: 'Finance Analyst',
      departmentId: financeDepartment.id,
      level: 'L3',
    },
  });

  const adminEmployee = await prisma.employee.upsert({
    where: { employeeCode: 'EMP-0001' },
    update: {
      userId: superAdminUser.id,
      departmentId: hrDepartment.id,
      positionId: hrAdminPosition.id,
      deletedAt: null,
    },
    create: {
      userId: superAdminUser.id,
      employeeCode: 'EMP-0001',
      firstName: 'Super',
      lastName: 'Admin',
      email: superAdminLogin.email,
      phone: '+10000000001',
      dateOfBirth: new Date('1988-01-01'),
      gender: Gender.PREFER_NOT_TO_SAY,
      address: 'HQ Office',
      hireDate: new Date('2024-01-01'),
      employmentStatus: EmploymentStatus.ACTIVE,
      departmentId: hrDepartment.id,
      positionId: hrAdminPosition.id,
      salary: 120000,
      emergencyContactName: 'Admin Contact',
      emergencyContactPhone: '+10000000002',
    },
  });

  const managerEmployee = await prisma.employee.upsert({
    where: { employeeCode: 'EMP-0002' },
    update: {
      userId: managerUser.id,
      departmentId: engineeringDepartment.id,
      positionId: managerPosition.id,
      managerId: adminEmployee.id,
      deletedAt: null,
    },
    create: {
      userId: managerUser.id,
      employeeCode: 'EMP-0002',
      firstName: 'Maya',
      lastName: 'Manager',
      email: 'manager@example.com',
      phone: '+10000000003',
      dateOfBirth: new Date('1990-03-15'),
      gender: Gender.FEMALE,
      address: 'Engineering Floor',
      hireDate: new Date('2024-02-01'),
      employmentStatus: EmploymentStatus.ACTIVE,
      departmentId: engineeringDepartment.id,
      positionId: managerPosition.id,
      managerId: adminEmployee.id,
      salary: 95000,
      emergencyContactName: 'Maya Contact',
      emergencyContactPhone: '+10000000004',
    },
  });

  const sampleEmployee = await prisma.employee.upsert({
    where: { employeeCode: 'EMP-0003' },
    update: {
      userId: employeeUser.id,
      departmentId: engineeringDepartment.id,
      positionId: engineerPosition.id,
      managerId: managerEmployee.id,
      deletedAt: null,
    },
    create: {
      userId: employeeUser.id,
      employeeCode: 'EMP-0003',
      firstName: 'Omar',
      lastName: 'Employee',
      email: 'employee@example.com',
      phone: '+10000000005',
      dateOfBirth: new Date('1996-09-21'),
      gender: Gender.MALE,
      address: 'Remote',
      hireDate: new Date('2025-01-15'),
      employmentStatus: EmploymentStatus.ACTIVE,
      departmentId: engineeringDepartment.id,
      positionId: engineerPosition.id,
      managerId: managerEmployee.id,
      salary: 70000,
      emergencyContactName: 'Omar Contact',
      emergencyContactPhone: '+10000000006',
    },
  });

  await prisma.department.update({ where: { id: hrDepartment.id }, data: { managerId: adminEmployee.id } });
  await prisma.department.update({ where: { id: engineeringDepartment.id }, data: { managerId: managerEmployee.id } });

  const annualLeave = await prisma.leaveType.upsert({
    where: { code: 'ANNUAL' },
    update: { name: 'Annual Leave', annualAllowanceDays: 21, isPaid: true, deletedAt: null },
    create: {
      code: 'ANNUAL',
      name: 'Annual Leave',
      description: 'Paid annual vacation leave',
      annualAllowanceDays: 21,
      isPaid: true,
    },
  });
  await prisma.leaveType.upsert({
    where: { code: 'SICK' },
    update: { name: 'Sick Leave', annualAllowanceDays: 10, isPaid: true, deletedAt: null },
    create: {
      code: 'SICK',
      name: 'Sick Leave',
      description: 'Paid sick leave',
      annualAllowanceDays: 10,
      isPaid: true,
      requiresAttachment: true,
    },
  });
  await prisma.leaveType.upsert({
    where: { code: 'UNPAID' },
    update: { name: 'Unpaid Leave', annualAllowanceDays: 0, isPaid: false, deletedAt: null },
    create: {
      code: 'UNPAID',
      name: 'Unpaid Leave',
      description: 'Unpaid leave of absence',
      annualAllowanceDays: 0,
      isPaid: false,
    },
  });

  const currentYear = new Date().getFullYear();
  for (const employee of [adminEmployee, managerEmployee, sampleEmployee]) {
    await prisma.leaveBalance.upsert({
      where: {
        employeeId_leaveTypeId_year: {
          employeeId: employee.id,
          leaveTypeId: annualLeave.id,
          year: currentYear,
        },
      },
      update: { totalDays: 21, deletedAt: null },
      create: {
        employeeId: employee.id,
        leaveTypeId: annualLeave.id,
        year: currentYear,
        totalDays: 21,
      },
    });

    await prisma.salaryRecord.upsert({
      where: { id: `${employee.employeeCode}-salary-${currentYear}` },
      update: {
        baseSalary: employee.salary,
        effectiveFrom: new Date(`${currentYear}-01-01`),
        deletedAt: null,
      },
      create: {
        id: `${employee.employeeCode}-salary-${currentYear}`,
        employeeId: employee.id,
        baseSalary: employee.salary,
        allowances: 2500,
        deductions: 0,
        bonuses: 0,
        taxRate: 0,
        effectiveFrom: new Date(`${currentYear}-01-01`),
      },
    });
  }

  await prisma.employmentContract.upsert({
    where: { id: 'sample-contract-emp-0003' },
    update: { employeeId: sampleEmployee.id, deletedAt: null },
    create: {
      id: 'sample-contract-emp-0003',
      employeeId: sampleEmployee.id,
      contractType: ContractType.FULL_TIME,
      startDate: new Date('2025-01-15'),
      salary: 70000,
      status: ContractStatus.ACTIVE,
      terms: 'Standard full-time employment contract.',
    },
  });

  console.log('Seed completed.');
  console.log(`Super admin: ${superAdminLogin.email}`);
  for (const loginUser of loginUsers) {
    console.log(`${loginUser.role}: ${loginUser.email}`);
  }
  console.log('Manager: manager@example.com');
  console.log('Employee: employee@example.com');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
