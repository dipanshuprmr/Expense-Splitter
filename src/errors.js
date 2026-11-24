'use strict';

/**
 * Error raised when user input breaks a business rule.
 * `code` is a stable machine-readable string, `status` is the HTTP status the API maps it to.
 */
class AppError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
  }
}

const validation = (code, message) => new AppError(code, message, 400);
const notFound = (code, message) => new AppError(code, message, 404);

module.exports = { AppError, validation, notFound };
