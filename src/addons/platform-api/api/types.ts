/** Core error envelopes and Huma problem details are validated at the HTTP boundary. */
export interface ApiErrorBody {
  code?: string;
  message?: unknown;
  detail?: unknown;
}
