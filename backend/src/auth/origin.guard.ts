import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

@Injectable()
export class OriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    if (
      request.headers.origin &&
      request.headers.origin !==
        this.config.get('FRONTEND_URL', 'http://localhost:3000')
    ) {
      throw new ForbiddenException('Origin nije dozvoljen.');
    }
    return true;
  }
}
