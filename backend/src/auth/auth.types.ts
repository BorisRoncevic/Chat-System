import type { Request } from 'express';

export type PublicUser = {
  id: string;
  username: string;
  email: string;
};

export type AuthRequest = Request & { user: PublicUser };
export type RegisterInput = {
  username?: unknown;
  email?: unknown;
  password?: unknown;
};
export type LoginInput = { email?: unknown; password?: unknown };
export type SessionClaims = { sub: string; exp: number };
