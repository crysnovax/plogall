import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { Plogall, PlogallError, ERROR_CODES } from '@plogall/core';
import { WhatsAppAdapter, normalizeWhatsAppMessage } from '@plogall/whatsapp';
import { TelegramAdapter, normalizeTelegramContext } from '@plogall/telegram';

const waMessage = (text = 'hello') => ({ key: { id: 'wa-1', remoteJid: '1555@s.whatsapp.net', fromMe: false }, pushName: 'Alice', messageTimestamp: 1710000000, message: { conversation: text } });
const tgContext = (text = 'hello') => { const update = { update_id: 42, message: { message_id: 7, date: 1710000000, text, chat: { id: 99, type: 'private', first_name: 'Alice' }, from: { id: 12, first_name: 'Alice', username: 'alice' } } }; return { update, updateType: 'message', message: update.message, chat: update.message.chat, from: update.message.from, text }; };

test('normalizes WhatsApp while preserving the native message', () => { const input = waMessage(); const msg = normalizeWhatsAppMessage(input); assert.equal(msg.platform, 'whatsapp'); assert.equal(msg.text, 'hello'); assert.equal(msg.chat.type, 'private'); assert.equal(msg.raw, input); });
test('normalizes Telegram through tgplus Context semantics', () => { const input = tgContext(); const msg = normalizeTelegramContext(input); assert.equal(msg.platform, 'telegram'); assert.equal(msg.id, '7'); assert.equal(msg.user.username, '@alice'); assert.equal(msg.raw, input.update); });

test('runs one universal handler across WhatsApp and Telegram', async () => {
  const waEvents = new EventEmitter(); const waSent = []; const waSocket = { ev: waEvents, sendMessage: async (...args) => { waSent.push(args); return { key: { id: 'sent-wa' } }; }, end: async () => {} };
  const tgHandlers = []; const tgCalls = []; const tgBot = { api: { sendMessage: async value => { tgCalls.push(['sendMessage', value]); return { message_id: 8 }; }, setMessageReaction: async value => { tgCalls.push(['reaction', value]); return true; }, editMessageText: async value => { tgCalls.push(['edit', value]); return {}; }, deleteMessage: async value => { tgCalls.push(['delete', value]); return true; } }, use: fn => tgHandlers.push(fn), launch: async () => {}, stop: () => {} };
  const app = new Plogall(); app.use(new WhatsAppAdapter({ socket: waSocket })); app.use(new TelegramAdapter({ bot: tgBot })); const received = [];
  app.onMessage(async msg => { received.push(`${msg.platform}:${msg.text}`); if (msg.text === '.ping') await msg.reply('Pong'); }); await app.start();
  waEvents.emit('messages.upsert', { messages: [waMessage('.ping')] }); await tgHandlers[0](tgContext('.ping'), async () => {}); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(received.sort(), ['telegram:.ping', 'whatsapp:.ping'].sort()); assert.equal(waSent[0][1], 'Pong'); assert.equal(tgCalls[0][1].text, 'Pong'); await app.stop();
});

test('fails explicitly for unsupported capabilities and preserves native causes', async () => {
  const adapter = new WhatsAppAdapter({ socket: { ev: new EventEmitter(), sendMessage: async () => { throw new Error('native failure'); } }, capabilities: { react: false } }); const app = new Plogall(); app.use(adapter); await app.start();
  await assert.rejects(() => adapter.react(adapter.normalizeMessage(waMessage()), '🔥'), error => error.code === ERROR_CODES.FEATURE_NOT_SUPPORTED);
  await assert.rejects(() => adapter.sendMessage('chat', 'text'), error => error.code === ERROR_CODES.NATIVE_ERROR && error.cause?.message === 'native failure'); await app.stop();
});
