import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { PrismaService } from '../prisma/prisma.service';

import { PUBLIC_USER_SELECT } from './auth.constants';
import type {
  LoginInput,
  PublicUser,
  RegisterInput,
  SessionClaims,
} from './auth.types';

const deriveKey = promisify(scrypt);

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(data: RegisterInput | undefined) {
    const username =
      typeof data?.username === 'string'
        ? data.username.trim().toLowerCase()
        : '';
    const email =
      typeof data?.email === 'string' ? data.email.trim().toLowerCase() : '';
    if (!/^[a-z0-9_]{3,30}$/.test(username)) {
      throw new BadRequestException(
        'Korisničko ime mora imati 3–30 slova, brojeva ili donjih crta.',
      );
    }
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('Unesi ispravnu email adresu.');
    }
    if (
      typeof data?.password !== 'string' ||
      data.password.length < 8 ||
      data.password.length > 128
    ) {
      throw new BadRequestException('Lozinka mora imati 8–128 znakova.');
    }
    const salt = randomBytes(16).toString('hex');
    const key = (await deriveKey(data.password, salt, 64)) as Buffer;
    const passwordHash = `${salt}:${key.toString('hex')}`;
    try {
      const user = await this.prisma.user.create({
        data: { username, email, passwordHash },
        select: PUBLIC_USER_SELECT,
      });
      return this.session(user);
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('Korisničko ime ili email je već zauzet.');
      }
      throw error;
    }
  }

  async login(data: LoginInput | undefined) {
    if (
      typeof data?.email !== 'string' ||
      typeof data.password !== 'string' ||
      data.password.length > 128
    ) {
      throw new UnauthorizedException('Pogrešan email ili lozinka.');
    }
    const user = await this.prisma.user.findUnique({
      where: { email: data.email.trim().toLowerCase() },
    });
    const [salt, hash] = user?.passwordHash?.split(':') ?? [
      'unknown-account',
      '00'.repeat(64),
    ];
    const key = (await deriveKey(data.password, salt, 64)) as Buffer;
    const expected = Buffer.from(hash, 'hex');
    if (
      !user?.passwordHash ||
      expected.length !== key.length ||
      !timingSafeEqual(key, expected)
    ) {
      throw new UnauthorizedException('Pogrešan email ili lozinka.');
    }
    return this.session({
      id: user.id,
      username: user.username,
      email: user.email,
    });
  }

  private async session(user: PublicUser) {
    const token = await this.jwt.signAsync({}, { subject: user.id });
    return { token, user };
  }

  async authenticate(token: string) {
    try {
      const claims = await this.jwt.verifyAsync<SessionClaims>(token);
      if (
        typeof claims.sub !== 'string' ||
        !Number.isSafeInteger(claims.exp) ||
        claims.exp * 1000 <= Date.now()
      ) {
        throw new Error('Invalid claims');
      }
      const user = await this.prisma.user.findUnique({
        where: { id: claims.sub },
        select: { ...PUBLIC_USER_SELECT, passwordHash: true },
      });
      if (!user?.passwordHash) throw new Error('Unknown account');
      return {
        user: { id: user.id, username: user.username, email: user.email },
        expiresAt: claims.exp * 1000,
      };
    } catch {
      throw new UnauthorizedException('Prijavi se ponovo.');
    }
  }
}
