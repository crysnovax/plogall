# PLOGALL

**Universal messaging infrastructure for Node.js.**

PLOGALL is a new project that lets application code handle WhatsApp and Telegram through one universal API while keeping each platform engine independent:

```text
Your application
       │
     PLOGALL
   ┌───┴────┐
plogme       tgplus
   │          │
WhatsApp   Telegram
```

PLOGALL does not rewrite either engine and does not copy their source code. It consumes their public runtime objects through adapters.

## Packages

| Package | Purpose | Native engine |
|---|---|---|
| `@plogall/core` | Universal events, middleware, messages, lifecycle, errors | None |
| `@plogall/whatsapp` | WhatsApp adapter | `plogme` / customized Baileys |
| `@plogall/telegram` | Telegram adapter | `tgplus` |

The Telegram adapter is built against the published `tgplus` `Bot`, `Context`, and `Api` APIs, version `1.0.0`.

## Installation

Install only the platforms required by the application:

```bash
npm install @plogall/core @plogall/whatsapp @plogall/telegram
npm install plogme tgplus
```

PLOGALL keeps `tgplus` as an external Telegram engine dependency. It is not copied into or rebranded by PLOGALL.

## Universal API

```js
import { Bot } from 'tgplus';
import makeWASocket from 'plogme';
import { Plogall } from '@plogall/core';
import { whatsapp } from '@plogall/whatsapp';
import { telegram } from '@plogall/telegram';

const waSocket = makeWASocket(whatsappConfig);
const tgBot = new Bot(process.env.TELEGRAM_TOKEN);
const app = new Plogall();

app.use(whatsapp({ socket: waSocket }));
app.use(telegram({ bot: tgBot }));

app.on('message', async msg => {
  if (msg.text === '.ping') {
    await msg.reply(`Pong from ${msg.platform}`);
  }
});

await app.start();
```

Every normalized message exposes `id`, `platform`, `text`, `timestamp`, `user`, `chat`, `media`, `capabilities`, and `raw`. Message operations are universal where their semantics are sound:

```js
await msg.reply('Hello');
await msg.react('🔥');
await msg.edit('Updated');
await msg.delete();
```

Native power is never hidden:

```js
const whatsappClient = app.adapter('whatsapp').client;
const telegramApi = app.adapter('telegram').api;
const nativeUpdate = msg.raw;
```

## Reliability model

Adapters maintain independent lifecycle states. Native failures reject as `PlogallError` with a stable error code, platform, feature, and original `cause`. Unsupported features produce `FEATURE_NOT_SUPPORTED`; they are never silently treated as successful.

The first release intentionally does not include cross-platform identity linking, forwarding, database plugins, or a CLI generator. Those belong in later packages and should not weaken the core adapter contract.

## Development

```bash
npm install
npm test
```

The tests use fake native clients that implement the inspected `plogme` and `tgplus` contracts, so they do not require live WhatsApp authentication or a Telegram token.

## Licensing and attribution

PLOGALL is a new orchestration project. Its adapters consume the separately installed `plogme` and `tgplus` engines without changing their package identities or attribution. Applications must comply with the applicable engine licenses. See [`NOTICE.md`](NOTICE.md) for the attribution references.
