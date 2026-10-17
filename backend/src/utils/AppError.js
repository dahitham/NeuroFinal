/** Error whose message is safe to show to end users (no stack traces, no secrets). */
export class AppError extends Error {
  constructor(status, message, code = 'ERROR', details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true;
  }
}

export const AI_UNAVAILABLE_MESSAGE =
  'AI assistance is temporarily unavailable. Your local accessibility tools are still available.';
