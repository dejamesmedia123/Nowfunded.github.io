/**
 * admin-login.gs
 * ─────────────────────────────────────────────────────────────────────────
 * Handles admin authentication for NowFunded.
 *
 * Scope: Password validation, session token issuance, token validation.
 * This file is shared by admin-ops.gs and admin-manage.gs — both call
 * validateAdminSessionToken_() which lives here.
 *
 * Token design: HMAC-SHA256 of (adminId + "." + expiryEpoch) using a
 * server-side secret stored in Script Properties. The token sent to the
 * client is: base64(adminId + "." + expiryEpoch + "." + hmac).
 * Session lifetime: 12 hours.
 *
 * Router entry — add to the shared doPost(e) switch in Code.gs:
 *
 *   if (action === 'adminLogin') return handleAdminLogin(payload);
 *
 * ─────────────────────────────────────────────────────────────────────────
 */

// ─────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────

/** Session lifetime in milliseconds (12 hours). */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Script Property key for the HMAC signing secret.
 * Set via Project Settings → Script Properties:
 *   key:   SESSION_SECRET
 *   value: any long random string you choose
 */
const SESSION_SECRET_PROP = 'SESSION_SECRET';

// ─────────────────────────────────────────────────────────────────────────
// LOGIN HANDLER
// ─────────────────────────────────────────────────────────────────────────

/**
 * Validates the submitted password against ADMIN_PASSWORD Script Property.
 * On success, issues a signed session token and returns it to the client.
 *
 * Expected payload: { action: 'adminLogin', password: '...' }
 * Response: { success: true, session_token: '...' }
 *        or { success: false, error: 'wrong_password' }
 */
function handleAdminLogin(payload) {
  const props         = PropertiesService.getScriptProperties();
  const adminPassword = props.getProperty('ADMIN_PASSWORD');

  if (!adminPassword) {
    Logger.log('ERROR: ADMIN_PASSWORD not set in Script Properties.');
    return jsonLoginError_('server_misconfigured');
  }

  const submitted = String(payload.password || '');

  if (submitted !== adminPassword) {
    return jsonLoginError_('wrong_password');
  }

  // Issue a signed session token
  const token = issueSessionToken_();

  return ContentService
    .createTextOutput(JSON.stringify({ success: true, session_token: token }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─────────────────────────────────────────────────────────────────────────
// TOKEN ISSUANCE
// ─────────────────────────────────────────────────────────────────────────

/**
 * Creates a signed session token.
 * Format (before base64): "admin.<expiryEpoch>.<hmac>"
 * The full token is base64url-encoded for safe storage in localStorage.
 *
 * @returns {string} signed session token
 */
function issueSessionToken_() {
  const props   = PropertiesService.getScriptProperties();
  const secret  = props.getProperty(SESSION_SECRET_PROP);

  if (!secret) {
    // Fallback: if no secret is configured, generate a time-based token.
    // This is less secure — always set SESSION_SECRET in Script Properties.
    Logger.log('WARNING: SESSION_SECRET not set. Using fallback token generation.');
    const expiry  = Date.now() + SESSION_TTL_MS;
    const raw     = 'admin.' + expiry + '.nosecret';
    return Utilities.base64EncodeWebSafe(raw);
  }

  const expiry   = Date.now() + SESSION_TTL_MS;
  const payload  = 'admin.' + expiry;
  const hmac     = computeHmac_(secret, payload);
  const raw      = payload + '.' + hmac;

  return Utilities.base64EncodeWebSafe(raw);
}

// ─────────────────────────────────────────────────────────────────────────
// TOKEN VALIDATION — called by admin-ops.gs and admin-manage.gs
// ─────────────────────────────────────────────────────────────────────────

/**
 * Validates a session token. Returns true if valid and not expired.
 *
 * This function is called by requireAdminSession_() in both
 * admin-ops.gs and admin-manage.gs — it must be in scope for both,
 * i.e. both .gs files must be in the same GAS project.
 *
 * @param {string} token - the session token from localStorage
 * @returns {boolean}
 */
function validateAdminSessionToken_(token) {
  if (!token) return false;

  try {
    const decoded = Utilities.newBlob(
      Utilities.base64DecodeWebSafe(token)
    ).getDataAsString();

    const parts = decoded.split('.');
    // parts[0] = 'admin', parts[1] = expiryEpoch, parts[2] = hmac (or 'nosecret')
    if (parts.length < 3) return false;

    const expiry = Number(parts[1]);
    if (isNaN(expiry) || Date.now() > expiry) return false; // expired

    // If no signing secret, accept the token on expiry check alone
    const props  = PropertiesService.getScriptProperties();
    const secret = props.getProperty(SESSION_SECRET_PROP);
    if (!secret || parts[2] === 'nosecret') return true;

    // Re-compute HMAC and compare
    const payload      = parts[0] + '.' + parts[1];
    const expectedHmac = computeHmac_(secret, payload);
    return parts[2] === expectedHmac;

  } catch (e) {
    Logger.log('Session validation error: ' + e.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// HMAC HELPER
// ─────────────────────────────────────────────────────────────────────────

/**
 * Computes an HMAC-SHA256 and returns a hex string.
 * @param {string} secret
 * @param {string} message
 * @returns {string}
 */
function computeHmac_(secret, message) {
  const sigBytes = Utilities.computeHmacSha256Signature(
    Utilities.newBlob(message).getBytes(),
    Utilities.newBlob(secret).getBytes()
  );
  // Convert byte array to hex string
  return sigBytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

// ─────────────────────────────────────────────────────────────────────────
// RESPONSE HELPERS (local to this file)
// ─────────────────────────────────────────────────────────────────────────

function jsonLoginError_(message) {
  return ContentService
    .createTextOutput(JSON.stringify({ success: false, error: message }))
    .setMimeType(ContentService.MimeType.JSON);
}
