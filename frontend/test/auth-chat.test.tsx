import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSyncExternalStore } from "react";
import type { ComponentProps } from "react";
import ProtectedLayout from "../src/app/(protected)/layout";
import AuthLayout from "../src/app/(auth)/layout";
import Home from "../src/app/(protected)/page";
import LoginPage from "../src/app/(auth)/login/page";
import RegisterPage from "../src/app/(auth)/register/page";
import { SessionProvider } from "../src/features/auth/components/session-provider";

const { ioMock, navigation } = vi.hoisted(() => ({
  ioMock: vi.fn(),
  navigation: {
    path: "/",
    listeners: new Set<() => void>(),
    router: { replace: vi.fn() },
  },
}));

function navigate(path: string) {
  navigation.path = path;
  navigation.listeners.forEach((listener) => listener());
}

vi.mock("next/navigation", () => ({ useRouter: () => navigation.router }));
vi.mock("next/link", () => ({
  default: ({ href, children, onClick, ...props }: ComponentProps<"a">) => (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        navigate(href!);
      }}
    >
      {children}
    </a>
  ),
}));

function TestRoutes() {
  const path = useSyncExternalStore(
    (listener) => {
      navigation.listeners.add(listener);
      return () => {
        navigation.listeners.delete(listener);
      };
    },
    () => navigation.path,
  );
  if (path === "/login" || path === "/register") {
    return (
      <AuthLayout>
        {path === "/login" ? <LoginPage /> : <RegisterPage />}
      </AuthLayout>
    );
  }
  return (
    <ProtectedLayout>
      {path === "/protected-example" ? <h1>Zaštićena stranica</h1> : <Home />}
    </ProtectedLayout>
  );
}

function renderApp(path = "/") {
  navigation.path = path;
  return render(
    <SessionProvider>
      <TestRoutes />
    </SessionProvider>,
  );
}
vi.mock("socket.io-client", () => ({ io: ioMock }));

const alice = {
  id: "alice-id",
  username: "alice",
  email: "alice@example.test",
};
const bob = { id: "bob-id", username: "bob", email: "bob@example.test" };
const conversation = {
  id: 7,
  members: [{ user: alice }, { user: bob }],
  messages: [],
};
const savedMessage = {
  id: "message-1",
  conversationId: 7,
  senderId: alice.id,
  clientMessageId: "client-1",
  seq: 1,
  text: "Privatna poruka",
  createdAt: "2026-11-24T12:00:00.000Z",
};

class FakeSocket {
  connected = false;
  handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  emitWithAck = vi
    .fn<(event: string, payload: Record<string, unknown>) => Promise<unknown>>()
    .mockImplementation(async (event, payload) =>
      event === "join-room"
        ? { joined: true }
        : {
            success: true,
            clientMessageId: payload.clientMessageId,
            message: { ...savedMessage, ...payload },
          },
    );
  timeout = vi.fn(() => this);
  disconnect = vi.fn(() => {
    this.connected = false;
    this.fire("disconnect");
  });
  removeAllListeners = vi.fn(() => this.handlers.clear());
  on(event: string, handler: (...args: unknown[]) => void) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
    return this;
  }
  off(event: string, handler: (...args: unknown[]) => void) {
    this.handlers.get(event)?.delete(handler);
    return this;
  }
  fire(event: string, ...args: unknown[]) {
    for (const handler of this.handlers.get(event) ?? []) handler(...args);
  }
  connect() {
    this.connected = true;
    this.fire("connect");
  }
}

const fetchMock = vi.fn<typeof fetch>();
let sockets: FakeSocket[];

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function authenticatedFetch(input: RequestInfo | URL) {
  const path = new URL(String(input)).pathname;
  if (path === "/auth/me") return response({ user: alice });
  if (path === "/conversations") return response([conversation]);
  if (path.endsWith("/messages")) return response([]);
  if (path === "/auth/logout") return response({ success: true });
  throw new Error(`Unexpected request: ${path}`);
}

async function connect() {
  await waitFor(() => expect(sockets).toHaveLength(1));
  await act(async () => sockets[0].connect());
  await waitFor(() =>
    expect(
      (screen.getByRole("textbox", { name: "Poruka" }) as HTMLInputElement)
        .disabled,
    ).toBe(false),
  );
  return sockets[0];
}

beforeEach(() => {
  navigation.path = "/";
  navigation.router.replace.mockReset().mockImplementation(navigate);
  sockets = [];
  ioMock.mockReset().mockImplementation(() => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  });
  fetchMock
    .mockReset()
    .mockImplementation(async () =>
      response({ message: "Prijavi se ponovo." }, 401),
    );
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("authenticated chat", () => {
  it("protects another page through the shared layout without a page-level guard", async () => {
    renderApp("/protected-example");
    expect(
      screen.queryByRole("heading", { name: "Zaštićena stranica" }),
    ).toBeNull();
    await screen.findByRole("heading", { name: "Prijavi se" });
    expect(navigation.router.replace).toHaveBeenCalledWith("/login");
    expect(
      screen.queryByRole("heading", { name: "Zaštićena stranica" }),
    ).toBeNull();
    expect(ioMock).not.toHaveBeenCalled();
  });

  it("waits for the session before revealing a protected layout's children", async () => {
    let finishSession!: (value: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finishSession = resolve;
        }),
    );
    renderApp("/protected-example");
    expect(screen.getByRole("status").textContent).toBe("Provera sesije…");
    expect(
      screen.queryByRole("heading", { name: "Zaštićena stranica" }),
    ).toBeNull();
    expect(navigation.router.replace).not.toHaveBeenCalled();
    await act(async () => finishSession(response({ user: alice })));
    expect(
      screen.getByRole("heading", { name: "Zaštićena stranica" }),
    ).toBeDefined();
    expect(navigation.router.replace).not.toHaveBeenCalled();
    expect(ioMock).not.toHaveBeenCalled();
  });

  it.each(["/login", "/register"])(
    "redirects an authenticated visitor from %s to chat",
    async (path) => {
      fetchMock.mockImplementation(async (input) => authenticatedFetch(input));
      renderApp(path);
      await screen.findByRole("button", { name: "Odjavi se" });
      expect(navigation.router.replace).toHaveBeenCalledWith("/");
      expect(navigation.path).toBe("/");
      expect(screen.queryByLabelText("Lozinka")).toBeNull();
    },
  );

  it("opens login directly and links to a separate registration page without restoring the session twice", async () => {
    renderApp("/login");
    await screen.findByRole("heading", { name: "Prijavi se" });
    expect(
      screen.queryByLabelText("Korisničko ime", { exact: false }),
    ).toBeNull();
    expect(screen.getByLabelText("Lozinka").getAttribute("autocomplete")).toBe(
      "current-password",
    );
    const registerLink = screen.getByRole("link", {
      name: "Nemaš nalog? Registruj se",
    });
    expect(registerLink.getAttribute("href")).toBe("/register");
    fireEvent.click(registerLink);
    await screen.findByRole("heading", { name: "Napravi nalog" });
    expect(
      screen.getByLabelText("Korisničko ime", { exact: false }),
    ).toBeDefined();
    expect(
      screen
        .getByLabelText("Lozinka", { exact: false })
        .getAttribute("autocomplete"),
    ).toBe("new-password");
    const loginLink = screen.getByRole("link", {
      name: "Već imaš nalog? Prijavi se",
    });
    expect(loginLink.getAttribute("href")).toBe("/login");
    fireEvent.click(loginLink);
    await screen.findByRole("heading", { name: "Prijavi se" });
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/auth/me")),
    ).toHaveLength(1);
    expect(ioMock).not.toHaveBeenCalled();
  });

  it("opens registration directly and keeps validation errors on that page", async () => {
    renderApp("/register");
    await screen.findByRole("heading", { name: "Napravi nalog" });
    fireEvent.change(
      screen.getByLabelText("Korisničko ime", { exact: false }),
      { target: { value: "alice" } },
    );
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: alice.email },
    });
    fireEvent.change(screen.getByLabelText("Lozinka", { exact: false }), {
      target: { value: "Secret-password-123" },
    });
    fetchMock.mockImplementation(async () =>
      response({ message: "Korisničko ime ili email je već zauzet." }, 409),
    );
    fireEvent.click(screen.getByRole("button", { name: "Registruj se" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "već zauzet",
    );
    expect(navigation.path).toBe("/register");
    expect(ioMock).not.toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith("/auth/login")),
    ).toBe(false);
  });

  it("does not connect a socket before authentication and registers with a cookie request", async () => {
    renderApp();
    await screen.findByRole("heading", { name: "Prijavi se" });
    expect(ioMock).not.toHaveBeenCalled();
    expect(navigation.path).toBe("/login");
    fireEvent.click(
      screen.getByRole("link", { name: "Nemaš nalog? Registruj se" }),
    );
    expect(navigation.path).toBe("/register");
    fireEvent.change(
      screen.getByLabelText("Korisničko ime", { exact: false }),
      { target: { value: "alice" } },
    );
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: alice.email },
    });
    fireEvent.change(screen.getByLabelText("Lozinka", { exact: false }), {
      target: { value: "Secret-password-123" },
    });
    fetchMock.mockImplementation(async (input) => {
      if (String(input).endsWith("/auth/register"))
        return response({ user: alice }, 201);
      return response([]);
    });
    fireEvent.click(screen.getByRole("button", { name: "Registruj se" }));
    await screen.findByRole("button", { name: "Odjavi se" });
    expect(navigation.path).toBe("/");
    const request = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/auth/register"),
    )!;
    expect(request[1]?.credentials).toBe("include");
    expect(JSON.parse(String(request[1]?.body))).toEqual({
      username: "alice",
      email: alice.email,
      password: "Secret-password-123",
    });
    expect(ioMock.mock.calls[0][1]).toEqual({
      transports: ["websocket"],
      withCredentials: true,
    });
  });

  it("shows rejected login credentials and allows a successful login afterwards", async () => {
    renderApp();
    await screen.findByRole("heading", { name: "Prijavi se" });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: alice.email },
    });
    fireEvent.change(screen.getByLabelText("Lozinka"), {
      target: { value: "wrong-password" },
    });
    fetchMock.mockImplementation(async () =>
      response({ message: "Pogrešan email ili lozinka." }, 401),
    );
    fireEvent.click(screen.getByRole("button", { name: "Prijavi se" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Pogrešan email ili lozinka.",
    );
    expect(ioMock).not.toHaveBeenCalled();
    fetchMock.mockImplementation(async (input) =>
      String(input).endsWith("/auth/login")
        ? response({ user: alice })
        : response([]),
    );
    fireEvent.change(screen.getByLabelText("Lozinka"), {
      target: { value: "correct-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Prijavi se" }));
    await screen.findByRole("button", { name: "Odjavi se" });
    expect(screen.getByText("@alice")).toBeDefined();
  });

  it("restores a session, opens the actual conversation and sends without a client identity", async () => {
    fetchMock.mockImplementation(async (input) => authenticatedFetch(input));
    renderApp();
    const socket = await connect();
    expect(socket.emitWithAck).toHaveBeenCalledWith("join-room", {
      conversationId: 7,
    });
    const historyRequest = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/conversations/7/messages"),
    )!;
    expect(historyRequest[1]?.credentials).toBe("include");
    expect(
      fetchMock.mock.calls.every(
        ([, options]) => options?.credentials === "include",
      ),
    ).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "Poruka" }), {
      target: { value: "Privatna poruka" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Pošalji" }));
    await screen.findByText("Privatna poruka");
    const sent = socket.emitWithAck.mock.calls.find(
      ([event]) => event === "send-message",
    )![1];
    expect(sent).toEqual({
      conversationId: 7,
      clientMessageId: expect.any(String),
      text: "Privatna poruka",
    });
    expect(
      (screen.getByRole("textbox", { name: "Poruka" }) as HTMLInputElement)
        .value,
    ).toBe("");
  });

  it("creates a private conversation by username", async () => {
    let created = false;
    fetchMock.mockImplementation(async (input, options) => {
      const path = new URL(String(input)).pathname;
      if (path === "/auth/me") return response({ user: alice });
      if (path === "/conversations" && options?.method === "POST") {
        created = true;
        return response(conversation, 201);
      }
      if (path === "/conversations")
        return response(created ? [conversation] : []);
      return response([]);
    });
    renderApp();
    const recipient = await screen.findByLabelText("Novi privatni razgovor");
    fireEvent.change(recipient, { target: { value: "bob" } });
    fireEvent.click(screen.getByRole("button", { name: "Otvori" }));
    await screen.findByRole("heading", { name: "@bob" });
    const request = fetchMock.mock.calls.find(
      ([, options]) => options?.method === "POST",
    )!;
    expect(JSON.parse(String(request[1]?.body))).toEqual({ username: "bob" });
    expect(request[1]?.credentials).toBe("include");
  });

  it("waits for persistence ACK, prevents duplicate submits and deduplicates the broadcast", async () => {
    fetchMock.mockImplementation(async (input) => authenticatedFetch(input));
    renderApp();
    const socket = await connect();
    let acknowledge!: (value: unknown) => void;
    socket.emitWithAck.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          acknowledge = resolve;
        }),
    );
    const input = screen.getByRole("textbox", {
      name: "Poruka",
    }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Privatna poruka" } });
    fireEvent.submit(input.form!);
    fireEvent.submit(input.form!);
    expect(
      socket.emitWithAck.mock.calls.filter(
        ([event]) => event === "send-message",
      ),
    ).toHaveLength(1);
    expect(input.disabled).toBe(true);
    expect(screen.getByText("Čekam potvrdu čuvanja poruke…")).toBeDefined();
    const payload = socket.emitWithAck.mock.calls.at(-1)![1];
    const saved = { ...savedMessage, ...payload };
    act(() => socket.fire("new-message", saved));
    expect(input.value).toBe("Privatna poruka");
    await act(async () =>
      acknowledge({
        success: true,
        clientMessageId: payload.clientMessageId,
        message: saved,
      }),
    );
    expect(input.value).toBe("");
    expect(screen.getByText("Poruka je sačuvana.")).toBeDefined();
    expect(screen.getAllByText("Privatna poruka")).toHaveLength(1);
  });

  it("stops waiting after five seconds, keeps the draft and reuses its ID on manual retry", async () => {
    fetchMock.mockImplementation(async (input) => authenticatedFetch(input));
    renderApp();
    const socket = await connect();
    vi.useFakeTimers();
    socket.emitWithAck.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("operation has timed out")), 5000);
        }),
    );
    const input = screen.getByRole("textbox", {
      name: "Poruka",
    }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Privatna poruka" } });
    fireEvent.submit(input.form!);
    expect(socket.timeout).toHaveBeenLastCalledWith(5000);
    await act(async () => vi.advanceTimersByTimeAsync(4999));
    expect(input.disabled).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByRole("alert").textContent).toContain(
      "Potvrda nije stigla u roku od 5 sekundi",
    );
    expect(screen.getByRole("alert").dataset.deliveryState).toBe("unconfirmed");
    expect(input.value).toBe("Privatna poruka");
    expect(input.disabled).toBe(false);
    await act(async () => vi.advanceTimersByTimeAsync(30000));
    expect(
      socket.emitWithAck.mock.calls.filter(
        ([event]) => event === "send-message",
      ),
    ).toHaveLength(1);
    await act(async () => fireEvent.submit(input.form!));
    const attempts = socket.emitWithAck.mock.calls.filter(
      ([event]) => event === "send-message",
    );
    expect(attempts).toHaveLength(2);
    expect(attempts[1][1]).toEqual(attempts[0][1]);
    expect(input.value).toBe("");
    expect(screen.getByText("Poruka je sačuvana.")).toBeDefined();
  });

  it.each([
    ["FORBIDDEN", false, "rejected"],
    ["TEMPORARY_ERROR", true, "unconfirmed"],
  ])("keeps the text for a %s ACK", async (code, retryable, state) => {
    fetchMock.mockImplementation(async (input) => authenticatedFetch(input));
    renderApp();
    const socket = await connect();
    socket.emitWithAck.mockImplementationOnce(async (_, payload) => ({
      success: false,
      clientMessageId: payload.clientMessageId,
      code,
      retryable,
      error: "Slanje trenutno nije dozvoljeno.",
    }));
    const input = screen.getByRole("textbox", {
      name: "Poruka",
    }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Privatna poruka" } });
    await act(async () => fireEvent.submit(input.form!));
    expect(screen.getByRole("alert").dataset.deliveryState).toBe(state);
    expect(input.value).toBe("Privatna poruka");
    expect(input.disabled).toBe(false);
    expect(screen.queryByText("Poruka je sačuvana.")).toBeNull();
  });

  it.each([
    undefined,
    { success: true, clientMessageId: "wrong-id", message: savedMessage },
  ])(
    "preserves the draft when ACK is malformed or belongs to another message",
    async (ack) => {
      fetchMock.mockImplementation(async (input) => authenticatedFetch(input));
      renderApp();
      const socket = await connect();
      socket.emitWithAck.mockResolvedValueOnce(ack);
      const input = screen.getByRole("textbox", {
        name: "Poruka",
      }) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "Privatna poruka" } });
      await act(async () => fireEvent.submit(input.form!));
      expect(screen.getByRole("alert").textContent).toContain(
        "Server nije vratio ispravnu potvrdu",
      );
      expect(input.value).toBe("Privatna poruka");
    },
  );

  it("preserves an unconfirmed draft across reconnect and ignores the old ACK", async () => {
    fetchMock.mockImplementation(async (input) => authenticatedFetch(input));
    renderApp();
    const socket = await connect();
    let acknowledge!: (value: unknown) => void;
    socket.emitWithAck.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          acknowledge = resolve;
        }),
    );
    const input = screen.getByRole("textbox", {
      name: "Poruka",
    }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Privatna poruka" } });
    fireEvent.submit(input.form!);
    const payload = socket.emitWithAck.mock.calls.at(-1)![1];
    act(() => socket.disconnect());
    expect(input.value).toBe("Privatna poruka");
    expect(input.disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain(
      "Veza je prekinuta pre potvrde",
    );
    await act(async () => socket.connect());
    await waitFor(() => expect(input.disabled).toBe(false));
    await act(async () =>
      acknowledge({
        success: true,
        clientMessageId: payload.clientMessageId,
        message: { ...savedMessage, ...payload },
      }),
    );
    expect(input.value).toBe("Privatna poruka");
    expect(screen.queryByText("Poruka je sačuvana.")).toBeNull();
    await act(async () => fireEvent.submit(input.form!));
    expect(socket.emitWithAck.mock.calls.at(-1)![1]).toEqual(payload);
    expect(input.value).toBe("");
  });

  it("logs out, disconnects the socket and removes private messages", async () => {
    fetchMock.mockImplementation(async (input) => authenticatedFetch(input));
    renderApp();
    const socket = await connect();
    act(() => socket.fire("new-message", savedMessage));
    await screen.findByText("Privatna poruka");
    fireEvent.click(screen.getByRole("button", { name: "Odjavi se" }));
    await screen.findByRole("heading", { name: "Prijavi se" });
    expect(socket.disconnect).toHaveBeenCalled();
    expect(screen.queryByText("Privatna poruka")).toBeNull();
    expect(socket.handlers.size).toBe(0);
    const request = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/auth/logout"),
    )!;
    expect(request[1]).toMatchObject({
      method: "POST",
      credentials: "include",
    });
  });

  it("returns to login when the server expires the socket session", async () => {
    fetchMock.mockImplementation(async (input) => authenticatedFetch(input));
    renderApp();
    const socket = await connect();
    act(() => socket.fire("session-expired"));
    await screen.findByRole("heading", { name: "Prijavi se" });
    expect(screen.getByRole("alert").textContent).toContain(
      "Sesija je istekla",
    );
    expect(socket.disconnect).toHaveBeenCalled();
  });

  it("returns to login after an unauthorized history request", async () => {
    fetchMock.mockImplementation(async (input) =>
      String(input).endsWith("/messages")
        ? response({ message: "Prijavi se ponovo." }, 401)
        : authenticatedFetch(input),
    );
    renderApp();
    await waitFor(() => expect(sockets).toHaveLength(1));
    await act(async () => sockets[0].connect());
    await screen.findByRole("heading", { name: "Prijavi se" });
    expect(sockets[0].disconnect).toHaveBeenCalled();
  });

  it("ignores messages from another conversation and rejoins after reconnect", async () => {
    fetchMock.mockImplementation(async (input) => authenticatedFetch(input));
    renderApp();
    const socket = await connect();
    act(() =>
      socket.fire("new-message", {
        ...savedMessage,
        conversationId: 999,
        text: "Tuđa poruka",
      }),
    );
    expect(screen.queryByText("Tuđa poruka")).toBeNull();
    act(() => socket.disconnect());
    expect(
      (screen.getByRole("textbox", { name: "Poruka" }) as HTMLInputElement)
        .disabled,
    ).toBe(true);
    await act(async () => socket.connect());
    await waitFor(() =>
      expect(
        socket.emitWithAck.mock.calls.filter(
          ([event]) => event === "join-room",
        ),
      ).toHaveLength(2),
    );
  });

  it("offers retry when restoring a session fails because the server is unavailable", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    renderApp();
    await screen.findByRole("alert");
    expect(ioMock).not.toHaveBeenCalled();
    fetchMock.mockImplementation(async () =>
      response({ message: "Prijavi se ponovo." }, 401),
    );
    fireEvent.click(screen.getByRole("button", { name: "Pokušaj ponovo" }));
    await screen.findByRole("heading", { name: "Prijavi se" });
  });

  it("ignores late history from a conversation that is no longer selected", async () => {
    const carol = { id: "carol-id", username: "carol" };
    const otherConversation = {
      id: 9,
      members: [{ user: alice }, { user: carol }],
      messages: [],
    };
    let finishHistory!: (value: Response) => void;
    const delayedHistory = new Promise<Response>((resolve) => {
      finishHistory = resolve;
    });
    fetchMock.mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === "/auth/me") return response({ user: alice });
      if (path === "/conversations")
        return response([conversation, otherConversation]);
      if (path === "/conversations/7/messages") return delayedHistory;
      return response([]);
    });
    renderApp();
    await waitFor(() => expect(sockets).toHaveLength(1));
    await act(async () => sockets[0].connect());
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).endsWith("/conversations/7/messages"),
        ),
      ).toBe(true),
    );
    fireEvent.click(screen.getByRole("button", { name: /carol/ }));
    await screen.findByRole("heading", { name: "@carol" });
    await waitFor(() =>
      expect(
        (screen.getByRole("textbox", { name: "Poruka" }) as HTMLInputElement)
          .disabled,
      ).toBe(false),
    );
    await act(async () => finishHistory(response([savedMessage])));
    expect(screen.queryByText("Privatna poruka")).toBeNull();
    expect(sockets[0].emitWithAck).toHaveBeenCalledWith("join-room", {
      conversationId: 9,
    });
  });
});
