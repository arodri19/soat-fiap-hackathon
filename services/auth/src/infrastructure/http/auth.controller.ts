import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import type { Session } from '../../application/session-issuer';
import type { GetCurrentUser } from '../../application/use-cases/get-current-user';
import type { Login } from '../../application/use-cases/login';
import type { Logout } from '../../application/use-cases/logout';
import type { RefreshSession } from '../../application/use-cases/refresh-session';
import type { RegisterUser } from '../../application/use-cases/register-user';
import {
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  TooManyLoginAttemptsError,
} from '../../domain/errors';
import { ENV, type Env } from '../../config/env';
import { loginAttempts, refreshes, registrations } from '../observability/metrics';
import {
  LoginDto,
  RegisterDto,
  toLoginResponse,
  toUserResponse,
  type LoginResponse,
  type UserResponse,
} from './dtos';
import { JwtAuthGuard, type AuthenticatedRequest } from './jwt-auth.guard';

export const REFRESH_COOKIE = 'refresh_token';

export const USE_CASES = {
  register: Symbol('RegisterUser'),
  login: Symbol('Login'),
  refresh: Symbol('RefreshSession'),
  logout: Symbol('Logout'),
  me: Symbol('GetCurrentUser'),
};

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(USE_CASES.register) private readonly registerUser: RegisterUser,
    @Inject(USE_CASES.login) private readonly login: Login,
    @Inject(USE_CASES.refresh) private readonly refreshSession: RefreshSession,
    @Inject(USE_CASES.logout) private readonly logoutSession: Logout,
    @Inject(USE_CASES.me) private readonly currentUser: GetCurrentUser,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterDto): Promise<UserResponse> {
    try {
      const user = await this.registerUser.execute(dto);
      registrations.inc({ result: 'success' });
      return toUserResponse(user);
    } catch (error) {
      registrations.inc({
        result: error instanceof EmailAlreadyRegisteredError ? 'email_taken' : 'invalid',
      });
      throw error;
    }
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async signIn(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    try {
      const session = await this.login.execute({ ...dto, ip: req.ip ?? 'unknown' });
      loginAttempts.inc({ result: 'success' });
      return this.respondWithSession(res, session);
    } catch (error) {
      if (error instanceof InvalidCredentialsError)
        loginAttempts.inc({ result: 'invalid_credentials' });
      if (error instanceof TooManyLoginAttemptsError) loginAttempts.inc({ result: 'rate_limited' });
      throw error;
    }
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    try {
      const session = await this.refreshSession.execute(this.readRefreshCookie(req));
      refreshes.inc({ result: 'success' });
      return this.respondWithSession(res, session);
    } catch (error) {
      refreshes.inc({ result: 'invalid' });
      res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.logoutSession.execute(this.readRefreshCookie(req));
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@Req() req: AuthenticatedRequest): Promise<UserResponse> {
    return toUserResponse(await this.currentUser.execute(req.auth.sub));
  }

  private readRefreshCookie(req: Request): string | undefined {
    const value = (req.cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.env.COOKIE_SECURE,
      sameSite: 'strict',
      path: this.env.COOKIE_PATH,
    };
  }

  private respondWithSession(res: Response, session: Session): LoginResponse {
    res.cookie(REFRESH_COOKIE, session.refreshToken, {
      ...this.cookieOptions(),
      expires: session.refreshTokenExpiresAt,
    });
    res.setHeader('Cache-Control', 'no-store');
    return toLoginResponse(session);
  }
}
