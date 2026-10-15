// Hotel-module errors that core/auth/errors.js does not have. The global error
// handler (src/middleware/errorHandler.js) reads `statusCode`.

export class ConflictError extends Error {
    constructor(message, details) {
        super(message);
        this.name = 'ConflictError';
        this.statusCode = 409;
        if (details) this.details = details;
    }
}
