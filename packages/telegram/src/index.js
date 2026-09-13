import { ERROR_CODES, PlogallError, decorateMessage, wrapError } from '@plogall/core';

export function normalizeTelegramContext(context, capabilities = {}) {
  const message = context?.message;
  const chat = context?.chat;
  const from = context?.from;
  if (!context?.update || !chat) throw new PlogallError(ERROR_CODES.INVALID_MESSAGE, 'An tgplus context with an update and chat is required.', { platform: 'telegram' });
  const messageId = message?.message_id ?? context.callbackQuery?.message?.message_id ?? null;
  const updateType = context.updateType || (message ? 'message' : 'update');
  const type = updateType === 'edited_message' || updateType === 'edited_channel_post' ? 'message.edit' : updateType === 'callback_query' ? 'button' : 'message';
  const mediaType = ['photo', 'video', 'document', 'audio', 'voice', 'sticker', 'animation', 'poll'].find(key => message?.[key] !== undefined);
  return {
    id: messageId == null ? String(context.update.update_id ?? `update-${Date.now()}`) : String(messageId),
    platform: 'telegram',
    type,
    text: message?.text ?? message?.caption ?? context.text ?? '',
    timestamp: (message?.date ?? Math.floor(Date.now() / 1000)) * 1000,
    user: { id: String(from?.id ?? 'unknown'), name: [from?.first_name, from?.last_name].filter(Boolean).join(' ') || null, username: from?.username ? `@${from.username}` : null, platform: 'telegram', raw: from ?? null },
    chat: { id: String(chat.id), type: chat.type === 'supergroup' ? 'group' : chat.type, name: chat.title ?? ([chat.first_name, chat.last_name].filter(Boolean).join(' ') || null), platform: 'telegram', raw: chat },
    media: mediaType ? { type: mediaType, raw: message[mediaType] } : null,
    capabilities: { ...capabilities },
    raw: context.update
  };
}

export class TelegramAdapter {
  name = 'telegram';
  state = 'created';
  #app;
  #bot;
  #botFactory;
  #botOptions;
  #registered = false;
  #capabilities;

  constructor({ bot, botFactory, botOptions = {}, capabilities = {} } = {}) {
    if (!bot && typeof botFactory !== 'function') throw new TypeError('TelegramAdapter requires an tgplus Bot or botFactory.');
    this.#bot = bot;
    this.#botFactory = botFactory;
    this.#botOptions = botOptions;
    this.#capabilities = { reply: true, send: true, react: true, edit: true, delete: true, media: true, polls: true, buttons: true, threads: true, ...capabilities };
  }

  get client() { return this.#bot; }
  get api() { return this.#bot?.api; }
  capabilities() { return { ...this.#capabilities }; }
  attach(app) { this.#app = app; }

  async connect() {
    if (this.state === 'ready' || this.state === 'connected') return this;
    this.state = 'connecting';
    if (!this.#bot) this.#bot = await this.#botFactory(this.#botOptions);
    if (!this.#bot?.api || typeof this.#bot.use !== 'function') throw new TypeError('bot must be an tgplus Bot instance.');
    if (!this.#registered) {
      this.#bot.use(async (context, next) => {
        try { await this.#app?._dispatch(normalizeTelegramContext(context, this.#capabilities).type, decorateMessage(normalizeTelegramContext(context, this.#capabilities), this)); }
        catch (error) { await this.#app?._dispatch('connection.error', { platform: this.name, error }); }
        return next();
      });
      this.#registered = true;
    }
    if (typeof this.#bot.launch !== 'function') throw new TypeError('tgplus Bot.launch() is required for TelegramAdapter polling.');
    await this.#bot.launch(this.#botOptions.launch);
    this.state = 'ready';
    await this.#app?._dispatch('connection.ready', { platform: this.name, raw: this.#bot });
    return this;
  }

  async disconnect() { this.#bot?.stop?.(); this.state = 'disconnected'; await this.#app?._dispatch('connection.close', { platform: this.name }); }
  normalizeMessage(context) { return decorateMessage(normalizeTelegramContext(context, this.#capabilities), this); }
  async sendMessage(chat, content) { this.#assertReady(); if (typeof content === 'string') return this.#operation('send', () => this.#bot.api.sendMessage({ chat_id: chat, text: content })); if (content?.text !== undefined) return this.#operation('send', () => this.#bot.api.sendMessage({ chat_id: chat, ...content })); throw new PlogallError(ERROR_CODES.INVALID_MESSAGE, 'Telegram universal send currently requires text content.', { platform: this.name }); }
  async send(chat, content) { return this.sendMessage(chat, content); }
  async reply(message, content) { const value = typeof content === 'string' ? { text: content } : { ...content }; const messageId = message.raw?.message?.message_id ?? message.raw?.callback_query?.message?.message_id; if (messageId != null) value.reply_parameters ??= { message_id: messageId }; return this.sendMessage(message.chat.id, value); }
  async react(message, text) { this.#assertFeature('react'); return this.#operation('react', () => this.#bot.api.setMessageReaction({ chat_id: message.chat.id, message_id: Number(message.id), reaction: [{ type: 'emoji', emoji: text }] })); }
  async edit(message, content) { this.#assertFeature('edit'); const value = typeof content === 'string' ? { text: content } : content; if (typeof value?.text !== 'string') throw new PlogallError(ERROR_CODES.INVALID_MESSAGE, 'Telegram edit requires text content.', { platform: this.name }); return this.#operation('edit', () => this.#bot.api.editMessageText({ chat_id: message.chat.id, message_id: Number(message.id), ...value })); }
  async delete(message) { this.#assertFeature('delete'); return this.#operation('delete', () => this.#bot.api.deleteMessage({ chat_id: message.chat.id, message_id: Number(message.id) })); }
  #assertReady() { if (!this.#bot?.api || !['connected', 'ready'].includes(this.state)) throw new PlogallError(ERROR_CODES.ADAPTER_NOT_CONNECTED, 'Telegram adapter is not connected.', { platform: this.name }); }
  #assertFeature(feature) { this.#assertReady(); if (!this.#capabilities[feature]) throw new PlogallError(ERROR_CODES.FEATURE_NOT_SUPPORTED, `Feature is not supported: ${feature}`, { platform: this.name, feature }); }
  async #operation(feature, operation) { try { return await operation(); } catch (error) { throw wrapError(error, { code: ERROR_CODES.NATIVE_ERROR, message: `Telegram ${feature} operation failed.`, feature }, this.name); } }
}

export const telegram = options => new TelegramAdapter(options);
