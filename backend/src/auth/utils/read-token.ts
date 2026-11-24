import { AUTH_COOKIE } from '../auth.constants';

export function readToken(cookie?: string, authorization?: string): string {
  if (authorization?.startsWith('Bearer ')) return authorization.slice(7);
  return (
    cookie
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${AUTH_COOKIE}=`))
      ?.slice(AUTH_COOKIE.length + 1) ?? ''
  );
}
