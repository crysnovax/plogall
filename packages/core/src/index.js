import { EventEmitter } from 'node:events';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';

export const ERROR_CODES = Object.freeze({
  ADAPTER_NOT_FOUND: 'ADAPTER_NOT_FOUND', ADAPTER_NOT_CONNECTED: 'ADAPTER_NOT_CONNECTED', FEATURE_NOT_SUPPORTED: 'FEATURE_NOT_SUPPORTED', INVALID_MESSAGE: 'INVALID_MESSAGE', INVALID_CHAT: 'INVALID_CHAT', AUTHENTICATION_FAILED: 'AUTHENTICATION_FAILED', RATE_LIMITED: 'RATE_LIMITED', PLATFORM_ERROR: 'PLATFORM_ERROR', NATIVE_ERROR: 'NATIVE_ERROR', DELIVERY_FAILED: 'DELIVERY_FAILED', WORKFLOW_ERROR: 'WORKFLOW_ERROR', IDENTITY_CONFLICT: 'IDENTITY_CONFLICT'
});

export class PlogallError extends Error {
  constructor(code, message, { platform, feature, cause, details } = {}) { super(message, { cause }); this.name = 'PlogallError'; this.code = code; this.platform = platform; this.feature = feature; this.details = details; if (cause !== undefined) this.cause = cause; }
}
export function wrapError(error, fallback, platform) { if (error instanceof PlogallError) return error; return new PlogallError(fallback.code, fallback.message, { platform, feature: fallback.feature, cause: error }); }

export class MessageBuilder {
  #value = { type: 'text', text: '', buttons: [], media: [], metadata: {} };
  text(value) { this.#value.type = 'text'; this.#value.text = String(value ?? ''); return this; }
  image(url, options = {}) { this.#value.media.push({ type: 'image', url, ...options }); return this; }
  video(url, options = {}) { this.#value.media.push({ type: 'video', url, ...options }); return this; }
  document(url, options = {}) { this.#value.media.push({ type: 'document', url, ...options }); return this; }
  button(label, action, options = {}) { this.#value.buttons.push({ label, action, ...options }); return this; }
  metadata(values) { Object.assign(this.#value.metadata, values); return this; }
  build() { return Object.freeze({ ...this.#value, buttons: [...this.#value.buttons], media: [...this.#value.media], metadata: { ...this.#value.metadata } }); }
}
export const Message = Object.freeze({ text: value => new MessageBuilder().text(value), builder: () => new MessageBuilder() });
export const message = value => typeof value === 'string' ? Message.text(value).build() : value instanceof MessageBuilder ? value.build() : value;

export function renderMessage(content, capabilities = {}, platform = 'unknown') {
  const value = message(content);
  if (typeof value === 'string') return { text: value, degraded: false, omittedFeatures: [] };
  if (!value || typeof value !== 'object') throw new PlogallError(ERROR_CODES.INVALID_MESSAGE, 'Message content must be text or a MessageBuilder value.', { platform });
  const omittedFeatures = [];
  let text = value.text ?? '';
  const supportsButtons = capabilities.buttons !== false;
  const supportsMedia = capabilities.media !== false;
  const buttons = supportsButtons ? value.buttons ?? [] : [];
  if (!supportsButtons && value.buttons?.length) { omittedFeatures.push('buttons'); text += `\n${value.buttons.map(button => `${button.label}: ${button.action}`).join('\n')}`; }
  const media = supportsMedia ? value.media ?? [] : [];
  if (!supportsMedia && value.media?.length) { omittedFeatures.push('media'); text += `\n${value.media.map(item => item.url).join('\n')}`; }
  return { text, buttons, media, metadata: value.metadata ?? {}, degraded: omittedFeatures.length > 0, omittedFeatures };
}

export function decorateMessage(messageValue, adapter) {
  const msg = { ...messageValue };
  msg.reply = (content, options) => adapter.reply(msg, content, options);
  msg.send = (content, options) => adapter.send(msg.chat.id, content, options);
  msg.react = text => adapter.react(msg, text);
  msg.edit = (content, options) => adapter.edit(msg, content, options);
  msg.delete = () => adapter.delete(msg);
  return Object.freeze(msg);
}

export class MemoryStore {
  #values = new Map();
  async get(key) { return this.#values.get(String(key)); }
  async set(key, value) { this.#values.set(String(key), value); return value; }
  async delete(key) { return this.#values.delete(String(key)); }
  async values() { return [...this.#values.values()]; }
}

export class FileStore {
  constructor(directory = '.plogall-state') { this.directory = directory; }
  #path(key) { return `${this.directory}/${encodeURIComponent(String(key))}.json`; }
  async get(key) { try { return JSON.parse(await readFile(this.#path(key), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; } }
  async set(key, value) { await mkdir(this.directory, { recursive: true }); await writeFile(this.#path(key), JSON.stringify(value), 'utf8'); return value; }
  async delete(key) { try { await unlink(this.#path(key)); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
  async values() { await mkdir(this.directory, { recursive: true }); const files = (await readdir(this.directory)).filter(file => file.endsWith('.json')); return Promise.all(files.map(file => readFile(`${this.directory}/${file}`, 'utf8').then(JSON.parse))); }
}

export class IdentityStore {
  #store; #aliases = new Map();
  constructor(store = new MemoryStore()) { this.#store = store; }
  async link(canonicalId, platform, platformId, { verified = false } = {}) { if (!verified) throw new PlogallError(ERROR_CODES.IDENTITY_CONFLICT, 'Identity links require explicit verification.', { platform, details: { canonicalId, platformId } }); const key = `${platform}:${platformId}`; const existing = this.#aliases.get(key); if (existing && existing !== canonicalId) throw new PlogallError(ERROR_CODES.IDENTITY_CONFLICT, 'Platform identity is already linked to another user.', { platform, details: { existing, canonicalId } }); this.#aliases.set(key, canonicalId); const identity = { id: canonicalId, platform, platformId, linkedAt: Date.now() }; await this.#store.set(`identity:${canonicalId}:${platform}:${platformId}`, identity); return identity; }
  resolve(platform, platformId) { return this.#aliases.get(`${platform}:${platformId}`) ?? null; }
  aliases(canonicalId) { return [...this.#aliases.entries()].filter(([, value]) => value === canonicalId).map(([key]) => { const [platform, ...rest] = key.split(':'); return { platform, platformId: rest.join(':') }; }); }
}

export class DeliveryManager extends EventEmitter {
  #records = new Map(); #metrics = { attempted: 0, delivered: 0, failed: 0, retried: 0, degraded: 0 };
  constructor({ maxAttempts = 3, backoffMs = 100, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) { super(); this.maxAttempts = maxAttempts; this.backoffMs = backoffMs; this.sleep = sleep; }
  status(key) { return this.#records.get(key) ?? null; }
  markDegraded() { this.#metrics.degraded += 1; }
  metrics() { return { ...this.#metrics }; }
  async send({ platform, chat, content, send, idempotencyKey = `${platform}:${chat}:${JSON.stringify(content)}`, maxAttempts = this.maxAttempts }) {
    const existing = this.#records.get(idempotencyKey); if (existing?.status === 'delivered') return existing.result;
    const record = { idempotencyKey, platform, chat, status: 'pending', attempts: 0, createdAt: Date.now() }; this.#records.set(idempotencyKey, record);
    let lastError;
    while (record.attempts < maxAttempts) { record.attempts += 1; this.#metrics.attempted += 1; try { const result = await send(); record.status = 'delivered'; record.result = result; record.deliveredAt = Date.now(); this.#metrics.delivered += 1; this.emit('delivered', record); return result; } catch (error) { lastError = error; if (record.attempts < maxAttempts) { this.#metrics.retried += 1; this.emit('retry', { ...record, error }); await this.sleep(error?.retryAfterMs ?? this.backoffMs * 2 ** (record.attempts - 1)); } } }
    record.status = 'failed'; record.error = lastError; this.#metrics.failed += 1; this.emit('failed', record); throw new PlogallError(ERROR_CODES.DELIVERY_FAILED, `Delivery failed after ${record.attempts} attempts.`, { platform, cause: lastError, details: record });
  }
}

export class WorkflowBuilder {
  #workflow; constructor(engine, name) { this.#workflow = { name, predicate: () => true, steps: [], complete: null }; this.engine = engine; }
  onMessage() { return this; }
  when(predicate) { this.#workflow.predicate = typeof predicate === 'function' ? predicate : messageValue => messageValue.text?.includes(predicate); return this; }
  ask(key, prompt) { this.#workflow.steps.push({ type: 'ask', key, prompt }); return this; }
  step(key, handler) { this.#workflow.steps.push({ type: 'step', key, handler }); return this; }
  reply(value) { this.#workflow.steps.push({ type: 'reply', value }); return this; }
  complete(handler) { this.#workflow.complete = handler; this.engine.register(this.#workflow); return this; }
}
export class WorkflowEngine extends EventEmitter {
  #store; #workflows = new Map();
  constructor(store = new MemoryStore()) { super(); this.#store = store; }
  create(name) { return new WorkflowBuilder(this, name); }
  register(workflow) { this.#workflows.set(workflow.name, workflow); return workflow; }
  async handle(messageValue) { for (const workflow of this.#workflows.values()) { const key = `${workflow.name}:${messageValue.platform}:${messageValue.chat.id}`; let state = await this.#store.get(key); if (!state && !(await workflow.predicate(messageValue))) continue; state ??= { index: 0, values: {}, waiting: false }; let progressed = true; while (progressed) { progressed = false; const step = workflow.steps[state.index]; if (!step) { if (workflow.complete) await workflow.complete({ message: messageValue, state: state.values }); await this.#store.delete(key); return true; } if (step.type === 'ask') { if (!state.waiting) { await messageValue.reply(typeof step.prompt === 'function' ? step.prompt(state.values) : step.prompt); state.waiting = true; } else { state.values[step.key] = messageValue.text; state.waiting = false; state.index += 1; progressed = true; } } else if (step.type === 'step') { state.values[step.key] = await step.handler({ message: messageValue, state: state.values }); state.index += 1; progressed = true; } else if (step.type === 'reply') { await messageValue.reply(typeof step.value === 'function' ? step.value(state.values) : step.value); state.index += 1; progressed = true; } } await this.#store.set(key, state); this.emit('progress', { workflow: workflow.name, message: messageValue, state }); return true; } return false; }
}

export class Plogall extends EventEmitter {
  #adapters = new Map(); #middleware = []; #started = false;
  constructor({ debug = false, store = new MemoryStore(), delivery = new DeliveryManager(), identity = new IdentityStore(store), workflows = new WorkflowEngine(store) } = {}) { super(); this.debug = Boolean(debug); this.setMaxListeners(100); this.delivery = delivery; this.identity = identity; this.workflows = workflows; }
  use(adapter) { if (!adapter || typeof adapter.name !== 'string' || typeof adapter.connect !== 'function') throw new TypeError('An adapter with name and connect() is required.'); if (this.#adapters.has(adapter.name)) throw new PlogallError(ERROR_CODES.PLATFORM_ERROR, `Adapter already registered: ${adapter.name}`, { platform: adapter.name }); adapter.attach(this); this.#adapters.set(adapter.name, adapter); this.#debug(`adapter loaded: ${adapter.name}`); return this; }
  adapter(name) { const adapter = this.#adapters.get(name); if (!adapter) throw new PlogallError(ERROR_CODES.ADAPTER_NOT_FOUND, `Adapter not found: ${name}`, { platform: name }); return adapter; }
  adapters() { return [...this.#adapters.values()]; }
  middleware(fn) { if (typeof fn !== 'function') throw new TypeError('Middleware must be a function.'); this.#middleware.push(fn); return this; }
  onMessage(fn) { this.on('message', fn); return this; }
  workflow(name) { return this.workflows.create(name); }
  capabilities(platform) { return platform ? this.adapter(platform).capabilities() : Object.fromEntries(this.adapters().map(adapter => [adapter.name, adapter.capabilities()])); }
  metrics() { return { delivery: this.delivery.metrics(), adapters: Object.fromEntries(this.adapters().map(adapter => [adapter.name, { state: adapter.state, capabilities: adapter.capabilities() }])) }; }
  async start() { if (this.#started) return this; this.#started = true; try { await Promise.all(this.adapters().map(adapter => adapter.connect())); } catch (error) { this.#started = false; throw error; } return this; }
  async stop() { await Promise.allSettled(this.adapters().map(adapter => adapter.disconnect?.())); this.#started = false; }
  async send({ platform, chat, message, idempotencyKey, ...content }) { if (!platform || chat === undefined || chat === null) throw new PlogallError(ERROR_CODES.INVALID_CHAT, 'platform and chat are required.'); const adapter = this.adapter(platform); const value = message ?? content; const rendered = typeof adapter.render === 'function' ? adapter.render(value) : value; if (rendered?.degraded) this.delivery.markDegraded(); return this.delivery.send({ platform, chat, content: rendered, idempotencyKey, send: () => adapter.sendMessage(chat, value) }); }
  async _dispatch(event, payload) { this.#debug(event); if (event !== 'message') { this.emit(event, payload); return; } try { await this.workflows.handle(payload); } catch (error) { this.emit('workflow.error', { error, message: payload }); } let index = -1; const next = async () => { index += 1; if (index < this.#middleware.length) return this.#middleware[index](payload, next); return this.emit('message', payload); }; await next(); }
  #debug(event) { if (this.debug) this.emit('debug', `[PLOGALL] ${event}`); }
}
