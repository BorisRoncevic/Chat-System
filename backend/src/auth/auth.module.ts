import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { OriginGuard } from './origin.guard';
import { AuthService } from './auth.service';
import { SESSION_SECONDS } from './auth.constants';

@Module({
  imports: [
    PrismaModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.getOrThrow<string>('JWT_SECRET');
        if (Buffer.byteLength(secret) < 32)
          throw new Error('JWT_SECRET mora imati najmanje 32 bajta.');
        return {
          secret,
          signOptions: {
            algorithm: 'HS256',
            expiresIn: SESSION_SECONDS,
            issuer: 'chat-system',
            audience: 'chat-system',
          },
          verifyOptions: {
            algorithms: ['HS256'],
            issuer: 'chat-system',
            audience: 'chat-system',
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, OriginGuard],
  exports: [AuthService, AuthGuard, OriginGuard],
})
export class AuthModule {}
