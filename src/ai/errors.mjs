// Callers supply only local, controlled messages, never provider response text.
export class AiError extends Error {
  constructor(code, message, fields) {
    super(message);
    this.name = 'AiError';
    this.code = code;
    if (fields) this.fields = fields;
  }
}
