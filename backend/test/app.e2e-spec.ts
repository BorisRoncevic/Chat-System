import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const integration =
  process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;
integration('JWT authentication and private conversations', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let url: string;
  const prefix = `test_${randomUUID().slice(0, 8)}`;
  const password = 'Test-password-123!';
  const users: {
    id: string;
    username: string;
    email: string;
    cookie: string;
  }[] = [];
  const sockets: Socket[] = [];
  let conversationId: number;
  const userIds: string[] = [];

  async function connect(cookie?: string, options: object = {}) {
    const socket = io(url, {
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
      extraHeaders: cookie ? { Cookie: cookie } : {},
      ...options,
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Socket connect timed out')),
        5000,
      );
      socket.once('connect', () => {
        clearTimeout(timeout);
        resolve();
      });
      socket.once('connect_error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
    return socket;
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
    prisma = app.get(PrismaService);
    for (const suffix of ['a', 'b', 'c']) {
      const username = `${prefix}_${suffix}`;
      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ username, email: `${username}@example.test`, password })
        .expect(201);
      expect(response.body.user.passwordHash).toBeUndefined();
      expect(response.body.token).toBeUndefined();
      const cookie = response.headers['set-cookie'][0];
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
      users.push({ ...response.body.user, cookie: cookie.split(';')[0] });
      userIds.push(response.body.user.id);
    }
  }, 30000);

  afterAll(async () => {
    for (const socket of sockets) socket.disconnect();
    if (prisma && userIds.length) {
      const conversations = await prisma.conversation.findMany({
        where: { members: { some: { userId: { in: userIds } } } },
        select: { id: true },
      });
      await prisma.conversation.deleteMany({
        where: {
          id: { in: conversations.map((conversation) => conversation.id) },
        },
      });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await app?.close();
  });

  it('validates registration, prevents duplicate accounts and hashes passwords', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ username: 'x', email: 'invalid', password: 'short' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ username: users[0].username, email: users[0].email, password })
      .expect(409);
    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: users[0].id },
    });
    expect(stored.passwordHash).not.toContain(password);
    expect(stored.passwordHash).toMatch(/^[a-f0-9]{32}:[a-f0-9]{128}$/);
  });

  it('logs in, restores the current user and rejects wrong credentials', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: users[0].email, password: 'wrong' })
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: `${prefix}@missing.test`, password })
      .expect(401);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: users[0].email.toUpperCase(), password })
      .expect(200);
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', cookie)
      .expect(200);
    expect(me.body.user.id).toBe(users[0].id);
  });

  it('rejects missing, forged, expired and wrong-audience JWTs', async () => {
    await request(app.getHttpServer()).get('/conversations').expect(401);
    await request(app.getHttpServer())
      .get('/conversations')
      .set('Authorization', 'Bearer fake')
      .expect(401);
    const jwt = new JwtService({ secret: process.env.JWT_SECRET });
    for (const token of [
      jwt.sign(
        { sub: users[0].id },
        { expiresIn: -1, issuer: 'chat-system', audience: 'chat-system' },
      ),
      jwt.sign(
        { sub: users[0].id },
        { expiresIn: 60, issuer: 'chat-system', audience: 'wrong' },
      ),
      new JwtService({ secret: 'wrong-secret' }).sign(
        { sub: users[0].id },
        { expiresIn: 60, issuer: 'chat-system', audience: 'chat-system' },
      ),
    ]) {
      await request(app.getHttpServer())
        .get('/conversations')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
      await expect(connect(`chat_session=${token}`)).rejects.toThrow(
        'Prijavi se ponovo.',
      );
    }
  });

  it('rejects foreign origins and the old demo socket identity', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', 'https://untrusted.example')
      .send({ email: users[0].email, password })
      .expect(403);
    await expect(
      connect(undefined, { auth: { userId: 'alice' } }),
    ).rejects.toThrow('Prijavi se ponovo.');
    await expect(
      connect(users[0].cookie, {
        extraHeaders: {
          Cookie: users[0].cookie,
          Origin: 'https://untrusted.example',
        },
      }),
    ).rejects.toThrow('Prijavi se ponovo.');
  });

  it('creates only one private conversation for a pair, including concurrent requests', async () => {
    await request(app.getHttpServer())
      .post('/conversations')
      .set('Cookie', users[0].cookie)
      .send({ username: users[0].username })
      .expect(400);
    await request(app.getHttpServer())
      .post('/conversations')
      .set('Cookie', users[0].cookie)
      .send({ username: 'missing_user' })
      .expect(404);
    const responses = await Promise.all([
      request(app.getHttpServer())
        .post('/conversations')
        .set('Cookie', users[0].cookie)
        .send({ username: users[1].username })
        .expect(201),
      request(app.getHttpServer())
        .post('/conversations')
        .set('Cookie', users[1].cookie)
        .send({ username: users[0].username })
        .expect(201),
    ]);
    conversationId = responses[0].body.id;
    expect(responses[1].body.id).toBe(conversationId);
    expect(responses[0].body.members).toHaveLength(2);
    for (const user of users.slice(0, 2)) {
      const response = await request(app.getHttpServer())
        .get('/conversations')
        .set('Cookie', user.cookie)
        .expect(200);
      expect(
        response.body.map((conversation: { id: number }) => conversation.id),
      ).toContain(conversationId);
    }
    const outsider = await request(app.getHttpServer())
      .get('/conversations')
      .set('Cookie', users[2].cookie)
      .expect(200);
    expect(outsider.body).toEqual([]);
  });

  it('blocks outsiders from reading, joining or sending, even with a spoofed userId', async () => {
    await request(app.getHttpServer())
      .get(`/conversations/${conversationId}/messages?userId=${users[0].id}`)
      .set('Cookie', users[2].cookie)
      .expect(403);
    const outsider = await connect(users[2].cookie);
    expect(
      await outsider.timeout(5000).emitWithAck('join-room', { conversationId }),
    ).toMatchObject({ success: false, code: 'FORBIDDEN', retryable: false });
    expect(
      await outsider.timeout(5000).emitWithAck('send-message', {
        conversationId,
        text: 'unauthorized',
        clientMessageId: randomUUID(),
        userId: users[0].id,
      }),
    ).toMatchObject({
      success: false,
      code: 'ROOM_NOT_JOINED',
      retryable: false,
    });
  });

  it('delivers messages only to members, persists them and deduplicates retries', async () => {
    const sender = await connect(users[0].cookie);
    const recipient = await connect(users[1].cookie);
    const outsider = await connect(users[2].cookie);
    const leaked: unknown[] = [];
    outsider.on('new-message', (message) => leaked.push(message));
    for (const socket of [sender, recipient]) {
      expect(
        await socket.timeout(5000).emitWithAck('join-room', { conversationId }),
      ).toEqual({ joined: true });
    }
    const incoming = new Promise<{ text: string }>((resolve) =>
      recipient.once('new-message', resolve),
    );
    const payload = {
      conversationId,
      text: 'Privatna poruka',
      clientMessageId: randomUUID(),
      senderId: users[2].id,
    };
    const first = await sender
      .timeout(5000)
      .emitWithAck('send-message', payload);
    expect(first.success).toBe(true);
    expect(first.clientMessageId).toBe(payload.clientMessageId);
    expect(first.message.senderId).toBe(users[0].id);
    expect((await incoming).text).toBe(payload.text);
    const retry = await sender
      .timeout(5000)
      .emitWithAck('send-message', payload);
    expect(retry.message.id).toBe(first.message.id);
    const conflict = await sender
      .timeout(5000)
      .emitWithAck('send-message', { ...payload, text: 'Different text' });
    expect(conflict).toMatchObject({
      success: false,
      code: 'MESSAGE_CONFLICT',
      retryable: false,
      clientMessageId: payload.clientMessageId,
    });
    const history = await request(app.getHttpServer())
      .get(`/conversations/${conversationId}/messages`)
      .set('Cookie', users[1].cookie)
      .expect(200);
    expect(history.body).toHaveLength(1);
    expect(history.body[0].text).toBe(payload.text);
    expect(leaked).toHaveLength(0);
    expect(
      await sender
        .timeout(5000)
        .emitWithAck('send-message', { ...payload, text: ' ' }),
    ).toMatchObject({
      success: false,
      code: 'INVALID_MESSAGE',
      retryable: false,
      clientMessageId: payload.clientMessageId,
    });
    expect(
      await sender.timeout(5000).emitWithAck('join-room', {}),
    ).toHaveProperty('error');
  });

  it('returns the latest 100 messages and supports loading earlier messages', async () => {
    await prisma.message.createMany({
      data: Array.from({ length: 105 }, (_, index) => ({
        conversationId,
        senderId: users[0].id,
        clientMessageId: randomUUID(),
        seq: index + 2,
        text: `Message ${index + 2}`,
      })),
    });
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastSeq: 106 },
    });
    const recent = await request(app.getHttpServer())
      .get(`/conversations/${conversationId}/messages`)
      .set('Cookie', users[0].cookie)
      .expect(200);
    expect(recent.body).toHaveLength(100);
    expect(recent.body[0].seq).toBe(7);
    expect(recent.body[99].seq).toBe(106);
    const earlier = await request(app.getHttpServer())
      .get(`/conversations/${conversationId}/messages?before=7`)
      .set('Cookie', users[0].cookie)
      .expect(200);
    expect(earlier.body).toHaveLength(6);
    await request(app.getHttpServer())
      .get(`/conversations/${conversationId}/messages?before=bad`)
      .set('Cookie', users[0].cookie)
      .expect(400);
  });

  it('clears the HttpOnly session cookie on logout', async () => {
    const result = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', users[0].cookie)
      .expect(200);
    expect(result.headers['set-cookie'][0]).toContain('chat_session=;');
    await request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('disconnects an already connected socket when its JWT expires', async () => {
    const jwt = new JwtService({ secret: process.env.JWT_SECRET });
    const token = jwt.sign(
      { sub: users[0].id },
      { expiresIn: 2, issuer: 'chat-system', audience: 'chat-system' },
    );
    const socket = await connect(`chat_session=${token}`);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Expired socket was not disconnected')),
        4000,
      );
      socket.once('disconnect', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    expect(socket.connected).toBe(false);
  });
});
