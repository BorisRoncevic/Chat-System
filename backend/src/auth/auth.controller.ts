import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { AuthGuard } from './auth.guard';
import { OriginGuard } from './origin.guard';
import type { AuthRequest, LoginInput, RegisterInput } from './auth.types';
import { AUTH_COOKIE, SESSION_SECONDS } from './auth.constants';
import { AuthService } from './auth.service';

@Controller('auth')
@UseGuards(OriginGuard)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  private cookieOptions() {
    return {
      httpOnly: true,
      secure: this.config.get('NODE_ENV') === 'production',
      sameSite: 'lax' as const,
      path: '/',
    };
  }

  @Post('register')
  async register(
    @Body() data: RegisterInput,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.auth.register(data);
    response.cookie(AUTH_COOKIE, session.token, {
      ...this.cookieOptions(),
      maxAge: SESSION_SECONDS * 1000,
    });
    response.setHeader('Cache-Control', 'no-store');
    return { user: session.user };
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() data: LoginInput,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.auth.login(data);
    response.cookie(AUTH_COOKIE, session.token, {
      ...this.cookieOptions(),
      maxAge: SESSION_SECONDS * 1000,
    });
    response.setHeader('Cache-Control', 'no-store');
    return { user: session.user };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return { user: request.user };
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie(AUTH_COOKIE, this.cookieOptions());
    return { success: true };
  }
}
