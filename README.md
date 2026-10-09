# EveryonePoker

Free ranked no-limit hold'em, live at [everyonepoker.com](https://everyonepoker.com). There's no money, no chips to buy and no ads. You play six-max sit and gos or heads-up matches, your rating moves with Glicko-2, and bots fill the empty seats in casual games. Every match gets its own public page with the hand histories and a shuffle you can check was fair.

![The EveryonePoker home page](screenshot.png)

## Running it

You need Node 22 and Postgres 16. If you don't have Postgres, `docker compose up -d db` starts one.

```sh
cp .env.example .env
npm install
npm run dev
```

The server applies `server/db/schema.sql` on start and serves the client and the websocket on one port (8130 by default). `npm test` runs the tests in every workspace.

## Licence

Source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE). You can read it, run it and change it for any noncommercial purpose. The flag artwork is from flag-icons (MIT) and the fonts are under the SIL Open Font License, and their licence files sit next to them in `client/public`.

Required Notice: Copyright Gabriel Penman (https://gabrielpenman.com)
