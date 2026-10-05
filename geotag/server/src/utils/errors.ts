/** Thrown for anything the person can fix by changing what they sent. The message is shown to them as is. */
export class UserError extends Error {
  constructor(public code: string, message: string, public status = 400, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}
