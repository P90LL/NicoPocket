import { jobErrorSummary, type JobErrorCode } from './jobs.js';

// Do not expose exceptions from browser APIs, signed URLs, or workers in UI errors.
export class JobMediaError extends Error {
  readonly code: JobErrorCode;
  constructor(code: JobErrorCode) {
    super(jobErrorSummary[code]);
    this.name = 'JobMediaError';
    this.code = code;
  }
}
