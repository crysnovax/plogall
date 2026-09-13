import { ERROR_CODES, PlogallError, decorateMessage, renderMessage, wrapError } from '@plogall/core';

const object = value => value !== null && typeof value === 'object';
const messageText = message => {
  const content = message?.message || {};
  if (typeof content.conversation === 'string') return content.conversation;
  for (const key of Object.keys(content)) {
    const value = content[key];
    if (object(value) && typeof (value.text ?? value.caption) === 'string') return value.text ?? value.caption;
  }
  return '';
};

export function normalizeWhatsAppMessage(message, capabilities = {}) {
  if (!object(message) || !object(message.key)) throw new PlogallError(ERROR_CODES.INVALID_MESSAGE, 'A plogme/Baileys message with a key is required.', { platform: 'whatsapp' });
  const key = message.key;
  const remoteJid = key.remoteJid || '';
  const participant = key.participant || (key.fromMe ? null : remoteJid);
  const chatType = remoteJid.endsWith('@g.us') ? 'group' : remoteJid.endsWith('@newsletter') ? 'channel' : 'private';
  const content = message.message || {};
  const mediaKey = Object.keys(content).find(key => key.endsWith('Message') && !['extendedTextMessage'].includes(key));
  const normalized = {
    id: key.id,
    platform: 'whatsapp',
    type: 'message',
    text: messageText(message),
    timestamp: Number(message.messageTimestamp || Math.floor(Date.now() / 1000)) * 1000,
    user: { id: participant || remoteJid, name: message.pushName || null, username: null, platform: 'whatsapp', raw: message },
    chat: { id: remoteJid, type: chatType, name: null, platform: 'whatsapp', raw: key },
    media: mediaKey ? { type: mediaKey.replace(/Message$/, ''), raw: content[mediaKey] } : null,
    capabilities: { ...capabilities },
    raw: message
  };
  return normalized;
}

export class WhatsAppAdapter {
  name = 'whatsapp';
  state = 'created';
  #app;
  #socket;
  #socketFactory;
  #listeners = [];
  #capabilities;

  constructor({ socket, socketFactory, capabilities = {} } = {}) {
    if (!socket && typeof socketFactory !== 'function') throw new TypeError('WhatsAppAdapter requires socket or socketFactory.');
    this.#socket = socket;
    this.#socketFactory = socketFactory;
    this.#capabilities = { reply: true, send: true, react: true, edit: true, delete: true, media: true, polls: true, buttons: true, threads: false, ...capabilities };
  }

  get client() { return this.#socket; }
  capabilities() { return { ...this.#capabilities }; }
  render(content) { const rendered = renderMessage(content, { ...this.#capabilities, buttons: false, media: false }, this.name); return rendered; }
  attach(app) { this.#app = app; }

  async connect() {
    if (this.state === 'ready' || this.state === 'connected') return this;
    this.state = 'connecting';
    if (!this.#socket) this.#socket = await this.#socketFactory();
    if (!this.#socket?.ev?.on || typeof this.#socket.sendMessage !== 'function') throw new TypeError('socketFactory must return a plogme/Baileys socket.');
    const on = (event, handler) => { this.#socket.ev.on(event, handler); this.#listeners.push([event, handler]); };
    on('messages.upsert', ({ messages = [] }) => void Promise.all(messages.map(message => this.#app?._dispatch('message', decorateMessage(normalizeWhatsAppMessage(message, this.#capabilities), this)))).catch(error => this.#app?._dispatch('connection.error', { platform: this.name, error })));
    on('messages.update', update => this.#app?._dispatch('message.edit', update));
    on('messages.delete', update => this.#app?._dispatch('message.delete', update));
    on('messages.reaction', update => this.#app?._dispatch('reaction', update));
    on('connection.update', update => this.#onConnection(update));
    this.state = 'connected';
    await this.#app?._dispatch('connection', { platform: this.name, state: this.state, raw: this.#socket });
    return this;
  }

  async disconnect() {
    for (const [event, handler] of this.#listeners) this.#socket?.ev?.off?.(event, handler);
    this.#listeners = [];
    if (this.#socket?.end) await this.#socket.end();
    this.state = 'disconnected';
    await this.#app?._dispatch('connection.close', { platform: this.name });
  }

  normalizeMessage(message) { return decorateMessage(normalizeWhatsAppMessage(message, this.#capabilities), this); }
  async sendMessage(chat, content, options) { this.#assertReady(); const rendered = typeof content === 'string' ? { text: content } : this.render(content); const value = { text: rendered.text }; return this.#operation('send', () => this.#socket.sendMessage(chat, value, options)); }
  async send(chat, content, options) { return this.sendMessage(chat, content, options); }
  async reply(message, content, options) { return this.sendMessage(message.chat.id, content, { ...options, quoted: message.raw }); }
  async react(message, text) { this.#assertFeature('react'); return this.#operation('react', () => this.sendMessage(message.chat.id, { react: { text, key: message.raw.key } })); }
  async edit(message, content, options) { this.#assertFeature('edit'); return this.#operation('edit', () => this.sendMessage(message.chat.id, { ...(typeof content === 'string' ? { text: content } : content), edit: message.raw.key }, options)); }
  async delete(message) { this.#assertFeature('delete'); return this.#operation('delete', () => this.sendMessage(message.chat.id, { delete: message.raw.key })); }
  #assertReady() { if (!this.#socket || !['connected', 'ready'].includes(this.state)) throw new PlogallError(ERROR_CODES.ADAPTER_NOT_CONNECTED, 'WhatsApp adapter is not connected.', { platform: this.name }); }
  #assertFeature(feature) { this.#assertReady(); if (!this.#capabilities[feature]) throw new PlogallError(ERROR_CODES.FEATURE_NOT_SUPPORTED, `Feature is not supported: ${feature}`, { platform: this.name, feature }); }
  async #operation(feature, operation) { try { return await operation(); } catch (error) { throw wrapError(error, { code: ERROR_CODES.NATIVE_ERROR, message: `WhatsApp ${feature} operation failed.`, feature }, this.name); } }
  #onConnection(update) { if (update.connection === 'open') { this.state = 'ready'; void this.#app?._dispatch('connection.ready', { platform: this.name, raw: update }); } else if (update.connection === 'close') { this.state = 'disconnected'; void this.#app?._dispatch('connection.close', { platform: this.name, raw: update }); } else if (update.connection === 'connecting') this.state = 'connecting'; if (update.lastDisconnect) void this.#app?._dispatch('connection.error', { platform: this.name, error: update.lastDisconnect, raw: update }); }
}

export const whatsapp = options => new WhatsAppAdapter(options);
