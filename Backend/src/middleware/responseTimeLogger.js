import { logger } from '../utils/logger.js';
import { redactUrl } from '../utils/redactUrl.js';

/**
 * Logs API request method, path, status code, response time, and request ID.
 * Does not log body, headers, or any sensitive data.
 */
export const responseTimeLogger = (req, res, next) => {
    const start = Date.now();
    const requestId = req.requestId || '-';
    res.on('finish', () => {
        const duration = Date.now() - start;
        logger.info(`[${requestId}] ${req.method} ${redactUrl(req.originalUrl)} ${res.statusCode} ${duration}ms`);
    });
    next();
};
