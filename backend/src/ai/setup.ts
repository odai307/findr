import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../shared/config.js';
import { createFakeChatModel, createGeminiChatModel, type ChatModel } from './chat-model.js';

/**
 * GEMINI_CHAT_MODEL answers (and rewrites follow-ups), with GEMINI_FALLBACK_CHAT_MODEL used when
 * it is busy or slow; free-tier models are often overloaded. Without a key: a fake model.
 */
export function createChatModels(
  config: Config,
  log: FastifyBaseLogger,
): { chat: ChatModel; rewriter: ChatModel } {
  if (config.GEMINI_API_KEY) {
    const models = [...new Set([config.GEMINI_CHAT_MODEL, config.GEMINI_FALLBACK_CHAT_MODEL])];
    const model = createGeminiChatModel({ apiKey: config.GEMINI_API_KEY, models });
    return { chat: model, rewriter: model };
  }
  log.warn('No GEMINI_API_KEY: AI answers use a fake model that just quotes the top source.');
  return { chat: createFakeChatModel(), rewriter: createFakeChatModel() };
}
