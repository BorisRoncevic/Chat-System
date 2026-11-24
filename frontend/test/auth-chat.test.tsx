import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Home from "../src/app/page";

const { ioMock } = vi.hoisted(() => ({ ioMock: vi.fn() }));
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
    .mockImplementation(async (event) =>
      event === "join-room"
        ? { joined: true }
        : { success: true, message: savedMessage },
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
  vi.unstubAllGlobals();
});

describe("authenticated chat", () => {
  it("does not connect a socket before authentication and registers with a cookie request", async () => {
    render(<Home />);
    await screen.findByRole("heading", { name: "Prijavi se" });
    expect(ioMock).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Nemaš nalog? Registruj se" }),
    );
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
    render(<Home />);
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
    render(<Home />);
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
    render(<Home />);
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

  it("logs out, disconnects the socket and removes private messages", async () => {
    fetchMock.mockImplementation(async (input) => authenticatedFetch(input));
    render(<Home />);
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
    render(<Home />);
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
    render(<Home />);
    await waitFor(() => expect(sockets).toHaveLength(1));
    await act(async () => sockets[0].connect());
    await screen.findByRole("heading", { name: "Prijavi se" });
    expect(sockets[0].disconnect).toHaveBeenCalled();
  });

  it("ignores messages from another conversation and rejoins after reconnect", async () => {
    fetchMock.mockImplementation(async (input) => authenticatedFetch(input));
    render(<Home />);
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
    expect(screen.queryByRole("textbox", { name: "Poruka" })).toBeNull();
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
    render(<Home />);
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
    render(<Home />);
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
