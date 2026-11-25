# Chat System

Next.js frontend i NestJS/Socket.IO backend sa PostgreSQL bazom, registracijom,
prijavom i privatnim razgovorima između dva korisnika na backendu.

Frontend podržava registraciju, prijavu, obnovu sesije pri otvaranju stranice,
odjavu i privatne razgovore. HTTP zahtevi šalju sesijski kolačić, a Socket.IO
se povezuje tek nakon prijave i koristi istu sesiju.

## Organizacija koda

```text
frontend/src/
  app/
    (protected)/
      layout.tsx
      page.tsx
    (auth)/
      layout.tsx
      login/page.tsx
      register/page.tsx
    globals.css
    layout.tsx
  components/
    chat-app.tsx
  features/
    auth/
      components/
        login-form.tsx
        register-form.tsx
        auth-card.tsx
        session-provider.tsx
        session-gate.tsx
      hooks/
        use-session.ts
        use-session-state.ts
      types.ts
      constants.ts
      auth.module.css
    chat/
      components/
        chat.tsx
        conversation-sidebar.tsx
        conversation-view.tsx
        message-list.tsx
        message-composer.tsx
      hooks/
        use-chat.ts
        use-conversation.ts
      utils/messages.ts
      types.ts
      constants.ts
      chat.module.css
  lib/
    api.ts
    config.ts
  styles/
    ui.module.css

backend/src/
  app.module.ts
  main.ts
  auth/
    auth.types.ts
    auth.constants.ts
    utils/read-token.ts
  chat/
  prisma/
```

`app/(protected)/page.tsx` prikazuje `ChatApp` na `/`. Prijava je posebna stranica `/login`
sa komponentom `LoginForm`, a registracija `/register` sa `RegisterForm`.
Forme šalju zahteve na `/auth/login` i `/auth/register` i dele izgled kroz
`AuthCard`. Linkovi omogućavaju prelazak između stranica.

`SessionProvider` u glavnom layout-u deli stanje sesije između stranica.
`useSessionState` obnavlja sesiju i obrađuje njen istek, a `useSession` daje
komponentama pristup tom zajedničkom stanju. Zajednički layout u `(protected)`
koristi `SessionGate` sa `access="authenticated"` za sve svoje stranice, a layout
u `(auth)` koristi `access="guest"` za prijavu i registraciju. Stranice ne dodaju
sopstvene provere. `SessionGate` prikazuje proveru sesije ili grešku sa ponovnim
pokušajem, pa po potrebi preusmerava neprijavljenog korisnika na `/login`, a
prijavljenog sa auth stranica na `/`.
Uspešna prijava ili registracija otvara chat. Odjava i istek sesije vraćaju na
`/login`; obaveštenje o isteku ostaje sačuvano tokom prelaska na tu stranicu.

Za novu zaštićenu stranicu, na primer `/profile`, dodaj
`app/(protected)/profile/page.tsx`; ona automatski koristi zajednički layout.
Nazivi grupa u zagradama ne ulaze u URL. Glavni `app/layout.tsx` ostaje zajednički
za obe grupe, pa `SessionProvider` ostaje montiran tokom navigacije. Ovo je
kontrola prikaza na frontendu; backend i dalje proverava sesiju i pristup podacima.

`Chat` povezuje sidebar i aktivni razgovor. `useChat` upravlja listom razgovora,
kreiranjem razgovora, socket konekcijom, ulaskom u sobu i odjavom.
`ConversationView` povezuje prikaz poruka (`MessageList`) i polje za slanje
(`MessageComposer`) sa hookom `useConversation`. Taj hook upravlja istorijom,
dolaznim porukama, nacrtom, ACK-om, timeoutom i prekidom veze. Njegovo stanje
pripada aktivnom razgovoru; ključ komponente se menja pri izboru drugog razgovora.

Tipovi i konstante su uz funkcionalnost kojoj pripadaju. `lib/api.ts` sadrži
zajednički HTTP klijent i obradu grešaka, a `lib/config.ts` adresu API-ja.
`utils/messages.ts` spaja poruke bez duplikata i sortira ih po `seq`.
CSS moduli su podeljeni na autentifikaciju, chat i zajedničke UI stilove;
globalni stilovi ostaju u `app/globals.css`. Backend ostaje organizovan po
funkcionalnim modulima.

## Lokalno pokretanje

1. Pokreni PostgreSQL iz glavnog foldera: `docker compose up -d`.
2. U `backend` folderu pokreni `npm install`. Ako `.env` ne postoji, kopiraj
   `.env.example` u `.env` i podesi `DATABASE_URL` prema svom Docker podešavanju.
3. Postavi sopstveni `JWT_SECRET` u `backend/.env` (najmanje 32 bajta).
   Vrednost možeš generisati komandom `openssl rand -hex 32`.
4. Iz `backend` pokreni:

   ```sh
   ./node_modules/.bin/prisma migrate deploy --config prisma7.config.ts
   ./node_modules/.bin/prisma generate --config prisma7.config.ts
   npm run start:dev
   ```

5. U drugom terminalu, iz `frontend` pokreni `npm install` pa `npm run dev`.
6. Otvori `http://localhost:3000/register` i registruj nalog. Za postojeći nalog
   koristi `http://localhost:3000/login`. Drugi nalog napravi u
   privatnom prozoru ili drugom browseru. Unesi korisničko ime drugog korisnika
   u polje za novi razgovor, pa izaberi razgovor i pošalji poruku.
7. Osvežavanje stranice obnavlja sesiju. Dugme „Odjavi se” briše sesijski kolačić
   i prekida konekciju u trenutnom prozoru. Istek sesije vraća formu za prijavu.

Backend koristi port 3001, a frontend 3000. Koristi `localhost` na obe strane.
`FRONTEND_URL` u backendu i `NEXT_PUBLIC_API_URL` u frontendu mogu promeniti ove
adrese. Kolačić koristi `SameSite=Lax`; u produkciji postaje i `Secure`, pa koristi
HTTPS i frontend/API na istom sajtu.

## Prijava i pristup

- Lozinke se čuvaju kao scrypt heševi sa nasumičnim salt-om.
- JWT traje jedan sat i čuva se u `HttpOnly` kolačiću. Nije u localStorage-u.
- HTTP zahtevi i Socket.IO handshake proveravaju potpis, rok, issuer i audience.
- Po isteku JWT-a prekida se i postojeća WebSocket konekcija. Potrebna je nova
  prijava; automatsko osvežavanje tokena nije implementirano.
- Odjava briše kolačić i zatvara konekciju u trenutnom prozoru. Već izdat token
  ostaje kriptografski važeći do isteka; nema liste opozvanih tokena.
- Identitet se uzima iz JWT-a. `?userId=...` i demo `auth.userId` više ne služe
  za prijavu. Stari demo nalozi bez lozinke ne mogu se prijaviti; napravi nove
  naloge. Stari podaci ostaju u bazi.
- Samo članovi razgovora mogu učitati istoriju, ući u njegovu Socket.IO sobu ili
  slati poruke. Istorija se učitava po 100 poruka, uz dugme za starije poruke.

## API

| Metoda | Putanja | Podaci |
| --- | --- | --- |
| POST | `/auth/register` | `{ username, email, password }` |
| POST | `/auth/login` | `{ email, password }` |
| GET | `/auth/me` | Trenutni korisnik |
| POST | `/auth/logout` | Brisanje kolačića |
| GET | `/conversations` | Razgovori prijavljenog korisnika |
| POST | `/conversations` | `{ username }` primaoca |
| GET | `/conversations/:id/messages?before=123` | Istorija; `before` je opcion |

Za HTTP klijente podržan je i `Authorization: Bearer <JWT>`. Browser koristi
`credentials: 'include'`. Socket.IO koristi isti kolačić i događaje `join-room`
i `send-message`; server vraća ACK i emituje `new-message`.

## Potvrda slanja i timeout

Frontend šalje `{ conversationId, clientMessageId, text }` i čeka ACK najviše
5 sekundi pomoću `socket.timeout(5000).emitWithAck(...)`.

- Posle uspešnog upisa u bazu backend vraća
  `{ success: true, clientMessageId, message }`. Frontend prikazuje „Poruka je
  sačuvana” i prazni polje. ACK potvrđuje čuvanje, a ne da je primalac pročitao
  ili primio poruku.
- Ako slanje bude odbijeno, odgovor je
  `{ success: false, clientMessageId, code, error, retryable }`. Kod razlikuje
  neispravnu poruku, nedostatak pristupa, neotvoren razgovor, konflikt ID-a i
  privremenu grešku. `clientMessageId` se vraća kada je dostavljen ispravan ID.
- Dok čeka ACK, forma onemogućava novo slanje. Timeout ili prekid veze prikazuje
  da čuvanje nije potvrđeno: poruka je možda već u bazi. Tekst ostaje u polju,
  uključujući ponovno povezivanje dok je isti razgovor otvoren.
- Ručno ponovno slanje neizmenjenog teksta koristi isti `clientMessageId`, pa
  postojeća serverska provera sprečava dupliranje poruke. Automatski retries i
  backoff još nisu implementirani. Nacrt se čuva u memoriji aktivnog razgovora,
  ne preživljava osvežavanje stranice ili prelazak na drugi razgovor.
- Greška pri emitovanju obaveštenja drugim korisnicima ne menja uspešan ACK
  za već sačuvanu poruku. Takva greška se beleži u serverskom logu.

`join-room` takođe ima timeout od 5 sekundi i vraća `{ joined: true }` ili
strukturisanu grešku sa `success: false`, `code`, `error` i `retryable`.

## Provere

Iz `backend`:

```sh
npm run build
npm test -- --runInBand
npm run test:integration
```

Integracioni testovi zahtevaju migriranu lokalnu bazu i važeći `.env`. Prave
jedinstveno imenovane test naloge i razgovore i brišu samo svoje podatke na kraju.
Proveravaju JWT, privatnost HTTP/Socket.IO pristupa, duplikate, istoriju i odjavu.

Iz `frontend`: `npm test`, `npm run lint`, `npm run typecheck` i `npm run build`.
Frontend testovi proveravaju registraciju, prijavu, obnovu i istek sesije,
odjavu, kreiranje razgovora i slanje kroz mock HTTP/Socket.IO interfejse.
ACK testovi pokrivaju čekanje upisa, greške, timeout, očuvanje nacrta,
ponovno povezivanje i ručno slanje sa istim ID-em.
