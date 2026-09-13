import { EventEmitter } from 'node:events';

export const ERROR_CODES = Object.freeze({
  ADAPTER_NOT_FOUND: 'ADAPTER_NOT_FOUND',
  ADAPTER_NOT_CONNECTED: 'ADAPTER_NOT_CONNECTED',
  FEATURE_NOT_SUPPORTED: 'FEATURE_NOT_SUPPORTED',
  INVALID_MESSAGE: 'INVALID_MESSAGE',
  INVALID_CHAT: 'INVALID_CHAT',
  AUTHENTICATION_FAILED: 'AUTHENTICATION_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  PLATFORM_ERROR: 'PLATFORM_ERROR',
  NATIVE_ERROR: 'NATIVE_ERROR'
});

export class PlogallError extends Error {
  constructor(code, message, { platform, feature, cause } = {}) {
    super(message, { cause });
    this.name = 'PlogallError';
    this.code = code;
    this.platform = platform;
    this.feature = feature;
    if (cause !== undefined) this.cause = cause;
  }
}

export function wrapError(error, fallback, platform) {
  if (error instanceof PlogallError) return error;
  return new PlogallError(fallback.code, fallback.message, { platform, feature: fallback.feature, cause: error });
}

export function decorateMessage(message, adapter) {
  const msg = { ...message };
  msg.reply = (content, options) => adapter.reply(msg, content, options);
  msg.send = (content, options) => adapter.send(msg.chat.id, content, options);
  msg.react = text => adapter.react(msg, text);
  msg.edit = (content, options) => adapter.edit(msg, content, options);
  msg.delete = () => adapter.delete(msg);
  return Object.freeze(msg);
}

export class Plogall extends EventEmitter {
  #adapters = new Map();
  #middleware = [];
  #started = false;

  constructor({ debug = false } = {}) {
    super();
    this.debug = Boolean(debug);
    this.setMaxListeners(100);
  }

  use(adapter) {
    if (!adapter || typeof adapter.name !== 'string' || typeof adapter.connect !== 'function') throw new TypeError('An adapter with name and connect() is required.');
    if (this.#adapters.has(adapter.name)) throw new PlogallError(ERROR_CODES.PLATFORM_ERROR, `Adapter already registered: ${adapter.name}`, { platform: adapter.name });
    adapter.attach(this);
    this.#adapters.set(adapter.name, adapter);
    this.#debug(`adapter loaded: ${adapter.name}`);
    return this;
  }

  adapter(name) {
    const adapter = this.#adapters.get(name);
    if (!adapter) throw new PlogallError(ERROR_CODES.ADAPTER_NOT_FOUND, `Adapter not found: ${name}`, { platform: name });
    return adapter;
  }

  adapters() { return [...this.#adapters.values()]; }
  middleware(fn) { if (typeof fn !== 'function') throw new TypeError('Middleware must be a function.'); this.#middleware.push(fn); return this; }
  onMessage(fn) { this.on('message', fn); return this; }

  async start() {
    if (this.#started) return this;
    this.#started = true;
    try { await Promise.all(this.adapters().map(adapter => adapter.connect())); }
    catch (error) { this.#started = false; throw error; }
    return this;
  }

  async stop() {
    await Promise.allSettled(this.adapters().map(adapter => adapter.disconnect?.()));
    this.#started = false;
  }

  async send({ platform, chat, ...content }) {
    if (!platform || chat === undefined || chat === null) throw new PlogallError(ERROR_CODES.INVALID_CHAT, 'platform and chat are required.');
    return this.adapter(platform).sendMessage(chat, content);
  }

  async _dispatch(event, payload) {
    this.#debug(event);
    if (event !== 'message') { this.emit(event, payload); return; }
    let index = -1;
    const next = async () => {
      index += 1;
      if (index < this.#middleware.length) return this.#middleware[index](payload, next);
      return this.emit('message', payload);
    };
    await next();
  }

  #debug(event) { if (this.debug) this.emit('debug', `[PLOGALL] ${event}`); }
}
