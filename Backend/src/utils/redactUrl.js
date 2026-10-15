// Request URLs go to the access log, the response-time log and the error log. A few
// endpoints take a credential in the query string because they are opened in a plain
// browser tab (the hotel voucher's ?token= / ?vt=, signed private-file links' &s=), so
// those values are masked before any URL is written anywhere.

const SECRET_QUERY_PARAMS = /([?&](?:token|vt|access_token|refresh_token|accessToken|refreshToken|s|sig|signature)=)[^&#]*/gi;

/** The URL with credential-bearing query values replaced by [REDACTED]. */
export const redactUrl = (url) => String(url ?? '').replace(SECRET_QUERY_PARAMS, '$1[REDACTED]');
