import { API_URL } from "./config";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("Content-Type", "application/json");

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    credentials: "include",
    cache: "no-store",
  });
  const data = await response.json();

  if (!response.ok) {
    throw new ApiError(
      typeof data?.message === "string" ? data.message : "Zahtev nije uspeo.",
      response.status,
    );
  }

  return data as T;
}

export function errorMessage(error: unknown) {
  if (error instanceof TypeError)
    return "Server nije dostupan. Pokušaj ponovo.";
  return error instanceof Error ? error.message : "Došlo je do greške.";
}
