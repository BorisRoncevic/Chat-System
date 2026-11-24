# Chat System

Next.js frontend i NestJS/Socket.IO backend sa PostgreSQL bazom, registracijom,
prijavom i privatnim razgovorima između dva korisnika na backendu.

**Trenutno stanje frontenda:** stranica prikazuje demo chat (`alice` / `bob`,
razgovor 1). Ovaj demo šalje `auth.userId`, dok backend zahteva JWT sesiju.
Za povezivanje sa ovim backendom potrebno je povezati frontend sa auth API-jem
i slati sesijski kolačić. Ova razlika postoji nezavisno od organizacije fajlova.

## Organizacija koda

```text
frontend/src/app/
  page.tsx
  page.module.css
  globals.css
  layout.tsx

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

Frontend chat je objedinjen u `page.tsx`: tipovi, konstante, pomoćne funkcije,
hook-ovi i JSX su u istom fajlu. CSS je izdvojen u `page.module.css`, a globalni
stilovi u `globals.css`. Backend ostaje organizovan po funkcionalnim modulima.

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
6. Otvori `http://localhost:3000` za demo prikaz. Backend registracija i privatni
   razgovori dostupni su putem API-ja ispod; trenutni demo nema forme za prijavu.

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
i `send-message`; server vraća potvrdu ili `{ error }` i emituje `new-message`.

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

Iz `frontend`: `npm run lint`, `npm run typecheck` i `npm run build`.
