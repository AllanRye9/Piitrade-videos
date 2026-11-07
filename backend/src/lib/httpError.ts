export class HttpError extends Error {
  status: number;
  /** Optional machine-readable code the frontend can branch on (e.g.
   *  VIDEO_TOO_LONG opens the trim editor) without parsing the message. */
  code?: string;
  /** Optional extra fields merged into the JSON error body. */
  details?: Record<string, unknown>;
  constructor(status: number, message: string, options?: { code?: string; details?: Record<string, unknown> }) {
    super(message);
    this.status = status;
    this.code = options?.code;
    this.details = options?.details;
  }
}
