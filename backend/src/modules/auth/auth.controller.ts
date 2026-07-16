import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Logger, Param, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequestUser } from '../../common/types/request-user.type';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { MicrosoftAuthService } from './microsoft-auth.service';
import { StepUpDto } from './dto/step-up.dto';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly microsoftAuthService: MicrosoftAuthService,
  ) {}

  @Public()
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.authService.login(dto, request);
    this.authService.setSessionCookie(response, session.accessToken);
    return this.authService.browserSession(session);
  }

  @Public()
  @Get('microsoft/start')
  async microsoftStart(@Req() request: Request, @Res() response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    response.redirect(HttpStatus.FOUND, await this.microsoftAuthService.begin(request, response));
  }

  @Public()
  @Get('microsoft/callback')
  async microsoftCallback(@Req() request: Request, @Res() response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    try {
      const session = await this.microsoftAuthService.complete(request, response);
      this.authService.setSessionCookie(response, session.accessToken);
      response.redirect(HttpStatus.SEE_OTHER, this.microsoftAuthService.successUrl());
    } catch {
      this.microsoftAuthService.clearTransactionCookie(response);
      await this.authService.recordProviderLoginFailure('microsoft', request).catch(() => undefined);
      this.logger.warn('Microsoft sign-in failed');
      response.redirect(HttpStatus.SEE_OTHER, this.microsoftAuthService.failureUrl());
    }
  }

  @ApiBearerAuth()
  @Permissions('session.self.read')
  @Get('me')
  me(@CurrentUser() user: RequestUser) {
    return {
      user: {
        id: user.id,
        email: user.email,
        employeeId: user.employeeId ?? null,
        displayName: user.displayName,
        roles: user.roles,
        permissions: user.permissions,
        departmentScopeIds: user.departmentScopeIds,
        sessionId: user.sessionId,
        authProvider: user.authProvider,
        authorizationVersion: user.authorizationVersion,
      },
      csrfToken: user.csrfToken,
    };
  }

  @ApiBearerAuth()
  @Permissions('session.self.read')
  @Get('sessions')
  sessions(@CurrentUser() user: RequestUser) {
    return this.authService.listOwnSessions(user);
  }

  @ApiBearerAuth()
  @Permissions('session.self.read')
  @Post('step-up/local')
  @HttpCode(HttpStatus.OK)
  stepUpLocal(@Body() dto: StepUpDto, @CurrentUser() user: RequestUser) {
    return this.authService.stepUpLocal(dto, user);
  }

  @ApiBearerAuth()
  @Permissions('session.self.read')
  @Get('microsoft/step-up')
  async microsoftStepUp(@CurrentUser() user: RequestUser, @Req() request: Request, @Res() response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    response.redirect(HttpStatus.FOUND, await this.microsoftAuthService.beginStepUp(request, response, user));
  }

  @ApiBearerAuth()
  @Permissions('session.self.revoke')
  @Delete('sessions/:id')
  async revokeSession(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.revokeOwnSession(user, id);
    if (result.current) this.authService.clearSessionCookie(response);
    return result;
  }

  @ApiBearerAuth()
  @Permissions('session.self.revoke')
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@CurrentUser() user: RequestUser, @Res({ passthrough: true }) response: Response) {
    this.authService.clearSessionCookie(response);
    return this.authService.logout(user);
  }

  @ApiBearerAuth()
  @Permissions('session.self.revoke')
  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  logoutAll(@CurrentUser() user: RequestUser, @Res({ passthrough: true }) response: Response) {
    this.authService.clearSessionCookie(response);
    return this.authService.logoutAll(user);
  }
}
