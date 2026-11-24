import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthService } from './auth.service';
import type { AuthRequest } from './auth.types';
import { readToken } from './utils/read-token';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const session = await this.auth.authenticate(
      readToken(request.headers.cookie, request.headers.authorization),
    );
    request.user = session.user;
    return true;
  }
}
