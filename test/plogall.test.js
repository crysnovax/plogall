import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { Plogall, PlogallError, ERROR_CODES, Message, DeliveryManager, IdentityStore, MemoryStore, FileStore } from '@plogall/core';
import { WhatsAppAdapter, normalizeWhatsAppMessage } from '@plogall/whatsapp';
import { TelegramAdapter, normalizeTelegramContext } from '@plogall/telegram';

const waMessage = (text = 'hello') => ({ key: { id: 'wa-1', remoteJid: '1555@s.whatsapp.net', fromMe: false }, pushName: 'Alice', messageTimestamp: 1710000000, message: { conversation: text } });
const tgContext = (text = 'hello') => { const update = { update_id: 42, message: { message_id: 7, date: 1710000000, text, chat: { id: 99, type: 'private', first_name: 'Alice' }, from: { id: 12, first_name: 'Alice', username: 'alice' } } }; return { update, updateType: 'message', message: update.message, chat: update.message.chat, from: update.message.from, text }; };

function fakeTelegram() { const handlers = []; const calls = []; return { handlers, calls, bot: { api: { sendMessage: async value => { calls.push(['sendMessage', value]); return { message_id: 8 }; }, setMessageReaction: async value => { calls.push(['reaction', value]); return true; }, editMessageText: async value => { calls.push(['edit', value]); return {}; }, deleteMessage: async value => { calls.push(['delete', value]); return true; } }, use: fn => handlers.push(fn), launch: async () => {}, stop: () => {} } }; }

test('normalizes WhatsApp while preserving the native message', () => { const input = waMessage(); const msg = normalizeWhatsAppMessage(input); assert.equal(msg.platform, 'whatsapp'); assert.equal(msg.text, 'hello'); assert.equal(msg.chat.type, 'private'); assert.equal(msg.raw, input); });
test('normalizes Telegram through tgplus Context semantics', () => { const input = tgContext(); const msg = normalizeTelegramContext(input); assert.equal(msg.platform, 'telegram'); assert.equal(msg.id, '7'); assert.equal(msg.user.username, '@alice'); assert.equal(msg.raw, input.update); });

test('runs one universal handler across WhatsApp and Telegram', async () => {
  const waEvents = new EventEmitter(); const waSent = []; const waSocket = { ev: waEvents, sendMessage: async (...args) => { waSent.push(args); return { key: { id: 'sent-wa' } }; }, end: async () => {} }; const tg = fakeTelegram();
  const app = new Plogall(); app.use(new WhatsAppAdapter({ socket: waSocket })); app.use(new TelegramAdapter({ bot: tg.bot })); const received = [];
  app.onMessage(async msg => { received.push(`${msg.platform}:${msg.text}`); if (msg.text === '.ping') await msg.reply('Pong'); }); await app.start();
  waEvents.emit('messages.upsert', { messages: [waMessage('.ping')] }); await tg.handlers[0](tgContext('.ping'), async () => {}); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(received.sort(), ['telegram:.ping', 'whatsapp:.ping'].sort()); assert.equal(waSent[0][1].text, 'Pong'); assert.equal(tg.calls[0][1].text, 'Pong'); await app.stop();
});

test('renders universal buttons with Telegram controls and WhatsApp text fallback', async () => {
  const tg = fakeTelegram(); const app = new Plogall(); const waSent = []; const waSocket = { ev: new EventEmitter(), sendMessage: async (...args) => { waSent.push(args); return true; }, end: async () => {} }; app.use(new WhatsAppAdapter({ socket: waSocket })); app.use(new TelegramAdapter({ bot: tg.bot })); await app.start();
  const content = Message.text('Choose').button('Confirm', 'confirm').button('Cancel', 'cancel').build(); await app.send({ platform: 'telegram', chat: 99, message: content, idempotencyKey: 'button-telegram' }); await app.send({ platform: 'whatsapp', chat: '1555@s.whatsapp.net', message: content, idempotencyKey: 'button-whatsapp' });
  assert.equal(tg.calls[0][1].reply_markup.inline_keyboard[0][0].callback_data, 'confirm'); assert.match(waSent[0][1].text, /Confirm: confirm/); assert.equal(app.metrics().delivery.degraded, 1); await app.stop();
});

test('retries delivery and enforces idempotency', async () => { let attempts = 0; const delivery = new DeliveryManager({ maxAttempts: 3, backoffMs: 0, sleep: async () => {} }); const send = () => { attempts += 1; if (attempts < 3) return Promise.reject(new Error('temporary')); return Promise.resolve('ok'); }; assert.equal(await delivery.send({ platform: 'telegram', chat: 1, content: 'x', send, idempotencyKey: 'same' }), 'ok'); assert.equal(attempts, 3); assert.equal(await delivery.send({ platform: 'telegram', chat: 1, content: 'x', send, idempotencyKey: 'same' }), 'ok'); assert.equal(attempts, 3); assert.equal(delivery.metrics().retried, 2); });

test('requires verified identity links and prevents conflicts', async () => { const identities = new IdentityStore(new MemoryStore()); await assert.rejects(() => identities.link('customer-1', 'telegram', '12'), error => error.code === ERROR_CODES.IDENTITY_CONFLICT); await identities.link('customer-1', 'telegram', '12', { verified: true }); assert.equal(identities.resolve('telegram', '12'), 'customer-1'); await assert.rejects(() => identities.link('customer-2', 'telegram', '12', { verified: true }), error => error.code === ERROR_CODES.IDENTITY_CONFLICT); });

test('FileStore persists workflow values across instances', async () => { const directory = `/tmp/plogall-test-${Date.now()}`; const first = new FileStore(directory); await first.set('conversation', { step: 2, user: 'Alice' }); const second = new FileStore(directory); assert.deepEqual(await second.get('conversation'), { step: 2, user: 'Alice' }); await second.delete('conversation'); });

test('runs a durable workflow across message turns', async () => { const app = new Plogall(); const replies = []; const message = text => ({ ...normalizeWhatsAppMessage(waMessage(text)), reply: async value => { replies.push(value); } }); app.workflow('onboarding').when(msg => msg.text === 'start').ask('name', 'What is your name?').step('normalized', ({ state }) => state.name.toUpperCase()).reply(state => `Welcome ${state.normalized}`).complete(() => {}); await app._dispatch('message', message('start')); await app._dispatch('message', message('Alice')); await app._dispatch('message', message('next')); assert.deepEqual(replies, ['What is your name?', 'Welcome ALICE']); const metrics = app.metrics(); assert.equal(metrics.delivery.attempted, 0); });

test('fails explicitly for unsupported capabilities and preserves native causes', async () => { const adapter = new WhatsAppAdapter({ socket: { ev: new EventEmitter(), sendMessage: async () => { throw new Error('native failure'); } }, capabilities: { react: false } }); const app = new Plogall(); app.use(adapter); await app.start(); await assert.rejects(() => adapter.react(adapter.normalizeMessage(waMessage()), '🔥'), error => error.code === ERROR_CODES.FEATURE_NOT_SUPPORTED); await assert.rejects(() => adapter.sendMessage('chat', 'text'), error => error.code === ERROR_CODES.NATIVE_ERROR && error.cause?.message === 'native failure'); await app.stop(); });
