import type { EventEmitter } from 'node:events';
export declare const ERROR_CODES: Readonly<Record<string, string>>;
export declare class PlogallError extends Error { code: string; platform?: string; feature?: string; cause?: unknown; constructor(code: string, message: string, options?: { platform?: string; feature?: string; cause?: unknown }); }
export interface UniversalUser { id: string; name: string | null; username: string | null; platform: string; raw: unknown; }
export interface UniversalChat { id: string; type: string; name: string | null; platform: string; raw: unknown; }
export interface UniversalMessage { id: string; platform: string; type: string; text: string; timestamp: number; user: UniversalUser; chat: UniversalChat; media: unknown; capabilities: Record<string, boolean>; raw: unknown; reply(content: unknown, options?: unknown): Promise<unknown>; send(content: unknown, options?: unknown): Promise<unknown>; react(text: string): Promise<unknown>; edit(content: unknown, options?: unknown): Promise<unknown>; delete(): Promise<unknown>; }
export declare function decorateMessage(message: Omit<UniversalMessage, 'reply' | 'send' | 'react' | 'edit' | 'delete'>, adapter: any): UniversalMessage;
export declare function wrapError(error: unknown, fallback: { code: string; message: string; feature?: string }, platform: string): PlogallError;
export interface Adapter { name: string; connect(): Promise<unknown>; disconnect?(): Promise<unknown>; attach(app: Plogall): void; }
export declare class Plogall extends EventEmitter { constructor(options?: { debug?: boolean }); use(adapter: Adapter): this; adapter(name: string): Adapter; adapters(): Adapter[]; middleware(fn: (message: UniversalMessage, next: () => Promise<unknown>) => unknown): this; onMessage(handler: (message: UniversalMessage) => unknown): this; start(): Promise<this>; stop(): Promise<void>; send(options: { platform: string; chat: string | number; [key: string]: unknown }): Promise<unknown>; }
