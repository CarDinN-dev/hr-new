import { Body, Controller, Get, HttpCode, HttpStatus, Logger, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Request, Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequestUser } from '../../common/types/request-user.type';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { MicrosoftAuthService } from './microsoft-auth.service';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly microsoftAuthService: MicrosoftAuthService,
  ) {}

  @ApiBearerAuth()
  @Roles(Role.SUPER_ADMIN, Role.HR_ADMIN)
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.authService.login(dto, request.ip);
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
      this.logger.warn('Microsoft sign-in failed');
      response.redirect(HttpStatus.SEE_OTHER, this.microsoftAuthService.failureUrl());
    }
  }

  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser() user: RequestUser) {
    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        sessionVersion: user.sessionVersion,
      },
      csrfToken: user.csrfToken,
    };
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@CurrentUser() user: RequestUser, @Res({ passthrough: true }) response: Response) {
    this.authService.clearSessionCookie(response);
    return this.authService.logout(user.id);
  }
}
