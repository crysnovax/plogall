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

## Universal messages and fallbacks

Build one intent and let each adapter render it honestly for its platform:

```js
import { Message } from '@plogall/core';

await app.send({
  platform: 'telegram',
  chat: 123,
  message: Message.text('Choose an action')
    .button('Confirm', 'confirm')
    .button('Cancel', 'cancel')
});
```

Telegram receives inline buttons. WhatsApp receives a readable text fallback when the configured engine cannot represent the same controls. The delivery metrics report when degradation occurred.

## Reliable delivery

`Plogall.send()` uses an outbox-style delivery manager with idempotency keys, retries, exponential backoff, native `retryAfterMs` support, failure events, and delivery metrics:

```js
await app.send({
  platform: 'telegram',
  chat: 123,
  message: 'Payment received',
  idempotencyKey: 'payment:order-1842'
});

console.log(app.metrics().delivery);
```

The adapter operation is attempted only once for a successfully delivered idempotency key, preventing duplicate sends after process retries.

## Durable conversation workflows

Workflows are platform-independent and can be backed by `FileStore` or an application database implementing the same `get`, `set`, and `delete` interface:

```js
const onboarding = app.workflow('onboarding');
onboarding
  .onMessage()
  .when(ctx => ctx.text === 'start')
  .ask('name', 'What is your name?')
  .step('normalized', ({ state }) => state.name.toUpperCase())
  .reply(state => `Welcome ${state.normalized}`)
  .complete(() => console.log('onboarding complete'));
```

Use `new Plogall({ store: new FileStore('./state') })` for restart-safe state in a single process, or provide a database-backed store for a multi-instance deployment.

## Identity and observability

Platform IDs stay separate until explicitly verified and linked:

```js
await app.identity.link('customer-1842', 'telegram', '78239112', { verified: true });
```

`app.metrics()` reports delivery attempts, retries, failures, degradation, adapter health, lifecycle state, and capabilities. Native updates and native clients remain available through `msg.raw`, `adapter.client`, and `adapter.api`.

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

The foundation now includes capability-aware messages, delivery reliability, verified identity links, durable workflow primitives, and observability. Cross-platform forwarding, team inboxes, database connectors, AI packages, and a visual workflow studio should remain separate packages so the core adapter contract stays stable.

## Development

```bash
npm install
npm test
```

The tests use fake native clients that implement the inspected `plogme` and `tgplus` contracts, so they do not require live WhatsApp authentication or a Telegram token.

## Licensing and attribution

PLOGALL is a new orchestration project. Its adapters consume the separately installed `plogme` and `tgplus` engines without changing their package identities or attribution. Applications must comply with the applicable engine licenses. See [`NOTICE.md`](NOTICE.md) for the attribution references.
