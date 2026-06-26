/**
 * Code.gs
 * ─────────────────────────────────────────────────────────────────────────
 * Shared entry point for all NowFunded admin GAS handlers.
 *
 * There is a SINGLE deployed Web App URL shared by:
 *   admin-login.gs   — adminLogin
 *   admin-ops.gs     — Orders, Accounts, Payouts, Support, badge counts
 *   admin-manage.gs  — Plans, Discount Codes, Users, Settings
 *   notifications.gs — imported by ops + manage handlers
 *
 * All files must live in the SAME GAS project. Deploy once as a Web App
 * (Execute as: Me, Access: Anyone) and paste the URL into:
 *   - admin-login.html  →  const GAS_URL = '...'
 *   - admin-ops.html    →  const GAS_URL = '...'
 *   - admin-manage.html →  const GAS_URL = '...'
 *
 * Script Properties required (Project Settings → Script Properties):
 *   SPREADSHEET_ID    — Google Sheets document ID
 *   BOT_TOKEN         — Telegram Bot API token
 *   ADMIN_TELEGRAM_ID — Admin's Telegram user ID (for notifications)
 *   ADMIN_PASSWORD    — Admin UI login password
 *   SESSION_SECRET    — Random string for HMAC session signing
 * ─────────────────────────────────────────────────────────────────────────
 */

/**
 * HTTP GET — not used by the admin UI, but required for Web App deployment.
 * Returns a simple health check so you can verify the URL is live.
 */
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'NowFunded Admin API — OK' }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * HTTP POST — all requests from the admin SPAs arrive here.
 * Reads the JSON body, dispatches on `action`.
 */
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const action  = String(payload.action || '');

    // ── AUTH ──────────────────────────────────────────────────────────
    if (action === 'adminLogin')               return handleAdminLogin(payload);

    // ── DAILY OPS (admin-ops.gs) ──────────────────────────────────────
    if (action === 'getOpsCounts')             return handleGetOpsCounts(payload);

    if (action === 'getOrdersQueue')           return handleGetOrdersQueue(payload);
    if (action === 'confirmOrder')             return handleConfirmOrder(payload);
    if (action === 'rejectOrder')              return handleRejectOrder(payload);

    if (action === 'getAccounts')              return handleGetAccounts(payload);
    if (action === 'issueCredentials')         return handleIssueCredentials(payload);
    if (action === 'updateAccountStatus')      return handleUpdateAccountStatus(payload);

    if (action === 'getPayoutsQueue')          return handleGetPayoutsQueue(payload);
    if (action === 'approvePayout')            return handleApprovePayout(payload);
    if (action === 'rejectPayout')             return handleRejectPayout(payload);

    if (action === 'getOpenSupportThreads')    return handleGetOpenSupportThreads(payload);
    if (action === 'getSupportThreadMessages') return handleGetSupportThreadMessages(payload);
    if (action === 'postAdminReply')           return handlePostAdminReply(payload);
    if (action === 'closeSupportThread')       return handleCloseSupportThread(payload);

    // ── SETUP & MANAGEMENT (admin-manage.gs) ─────────────────────────
    if (action === 'getPlans')                 return handleGetPlans(payload);
    if (action === 'createPlan')               return handleCreatePlan(payload);
    if (action === 'updatePlan')               return handleUpdatePlan(payload);
    if (action === 'togglePlanActive')         return handleTogglePlanActive(payload);

    if (action === 'getDiscountCodes')         return handleGetDiscountCodes(payload);
    if (action === 'createPromoCode')          return handleCreatePromoCode(payload);
    if (action === 'toggleCodeActive')         return handleToggleCodeActive(payload);

    if (action === 'searchUsers')              return handleSearchUsers(payload);
    if (action === 'getUserDetail')            return handleGetUserDetail(payload);

    if (action === 'getSettings')              return handleGetSettings(payload);
    if (action === 'updateSettings')           return handleUpdateSettings(payload);

    // ── Unknown action ────────────────────────────────────────────────
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: 'Unknown action: ' + action }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    Logger.log('doPost error: ' + err.message);
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: 'Internal server error.' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
