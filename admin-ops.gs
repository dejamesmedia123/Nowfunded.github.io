/**
 * admin-ops.gs
 * ─────────────────────────────────────────────────────────────────────────
 * Backend handlers for admin-ops.html (SPA A — Daily Operations).
 *
 * Scope: Orders, Accounts (credentials + status), Payouts, Support,
 *        and badge counts for nav polling.
 *
 * This file knows nothing about Plans/Codes/Users/Settings — those
 * live in admin-manage.gs. Both files are registered with the SAME shared
 * doGet/doPost router in Code.gs; there is only one GAS deployment / URL.
 *
 * Every handler calls requireAdminSession_() first — the session token is
 * re-validated on every request, never trusted from client state alone.
 *
 * Sheets touched: Orders, Accounts, PayoutRequests, SupportThreads,
 *                  SupportMessages, Users, PointsLedger, Plans, Referrals
 *
 * Notification functions (notifyXxx) are expected to live in notifications.gs
 * in the same GAS project.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Router entries — add these to the shared doPost(e) switch in Code.gs:
 *
 *   if (action === 'getOrdersQueue')          return handleGetOrdersQueue(payload);
 *   if (action === 'confirmOrder')            return handleConfirmOrder(payload);
 *   if (action === 'rejectOrder')             return handleRejectOrder(payload);
 *   if (action === 'getAccounts')             return handleGetAccounts(payload);
 *   if (action === 'issueCredentials')        return handleIssueCredentials(payload);
 *   if (action === 'updateAccountStatus')     return handleUpdateAccountStatus(payload);
 *   if (action === 'getPayoutsQueue')         return handleGetPayoutsQueue(payload);
 *   if (action === 'approvePayout')           return handleApprovePayout(payload);
 *   if (action === 'rejectPayout')            return handleRejectPayout(payload);
 *   if (action === 'getOpenSupportThreads')   return handleGetOpenSupportThreads(payload);
 *   if (action === 'getSupportThreadMessages')return handleGetSupportThreadMessages(payload);
 *   if (action === 'postAdminReply')          return handlePostAdminReply(payload);
 *   if (action === 'closeSupportThread')      return handleCloseSupportThread(payload);
 *   if (action === 'getOpsCounts')            return handleGetOpsCounts(payload);
 */

// ─────────────────────────────────────────────────────────────────────────
// SHEET NAME CONSTANTS
// ─────────────────────────────────────────────────────────────────────────

const ORDERS_SHEET          = 'Orders';
const ACCOUNTS_SHEET        = 'Accounts';
const PAYOUT_REQUESTS_SHEET = 'PayoutRequests';
const SUPPORT_THREADS_SHEET = 'SupportThreads';
const SUPPORT_MESSAGES_SHEET= 'SupportMessages';
const USERS_SHEET_OPS       = 'Users';
const PLANS_SHEET_OPS       = 'Plans';
const POINTS_LEDGER_OPS     = 'PointsLedger';
const REFERRALS_SHEET_OPS   = 'Referrals';

// ─────────────────────────────────────────────────────────────────────────
// BADGE COUNTS — polled every 30s by SPA A
// ─────────────────────────────────────────────────────────────────────────

/**
 * Returns pending counts for all nav badges in one call.
 * Response: { orders_pending, payouts_pending, support_open }
 */
function handleGetOpsCounts(payload) {
  const authErr = requireAdminSession_(payload);
  if (authErr) return authErr;

  const ss = getSpreadsheet_Ops_();

  const ordersPending  = countRowsWhere_(ss, ORDERS_SHEET,          'payment_status', 'pending');
  const payoutsPending = countRowsWhere_(ss, PAYOUT_REQUESTS_SHEET, 'status',         'pending');
  const supportOpen    = countRowsWhere_(ss, SUPPORT_THREADS_SHEET,  'status',         'open');

  return jsonSuccess_Ops_({
    success: true,
    orders_pending:  ordersPending,
    payouts_pending: payoutsPending,
    support_open:    supportOpen,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// ORDERS
// ─────────────────────────────────────────────────────────────────────────

/**
 * Returns all pending orders joined with trader username and plan name.
 */
function handleGetOrdersQueue(payload) {
  const authErr = requireAdminSession_(payload);
  if (authErr) return authErr;

  const ss      = getSpreadsheet_Ops_();
  const orders  = readAllRows_Ops_(ss, ORDERS_SHEET)
    .filter(o => o.payment_status === 'pending');

  // Enrich with username and plan name
  const users = readAllRows_Ops_(ss, USERS_SHEET_OPS);
  const plans = readAllRows_Ops_(ss, PLANS_SHEET_OPS);

  const enriched = orders.map(o => {
    const user = users.find(u => String(u.telegram_id) === String(o.telegram_id));
    const plan = plans.find(p => String(p.plan_id)     === String(o.plan_id));
    return {
      order_id:          String(o.order_id),
      telegram_id:       String(o.telegram_id),
      username:          user ? String(user.username || '') : '',
      plan_id:           String(o.plan_id),
      plan_name:         plan ? String(plan.name || '') : '',
      price_paid:        Number(o.price_paid),
      discount_code:     o.discount_code     ? String(o.discount_code)   : '',
      discount_amount:   o.discount_amount   ? Number(o.discount_amount) : 0,
      payment_reference: String(o.payment_reference || ''),
      payment_status:    String(o.payment_status),
      created_at:        normalizeDateOps_(o.created_at),
    };
  });

  return jsonSuccess_Ops_({ success: true, orders: enriched });
}

/**
 * Confirms an order:
 *  1. Updates Order payment_status = confirmed, confirmed_at = now
 *  2. Creates an Accounts row (phase 1, status = pending_credentials)
 *  3. Awards referral points if the trader was referred
 *  4. Notifies the trader
 */
function handleConfirmOrder(payload) {
  const authErr = requireAdminSession_(payload);
  if (authErr) return authErr;

  const orderId = String(payload.order_id || '');
  if (!orderId) return jsonError_Ops_('Missing order_id.');

  const ss          = getSpreadsheet_Ops_();
  const ordersSheet = ss.getSheetByName(ORDERS_SHEET);
  const orderRow    = findRowByValue_Ops_(ordersSheet, 'order_id', orderId);
  if (!orderRow) return jsonError_Ops_('Order not found.');

  const order = rowToObject_Ops_(ordersSheet, orderRow.rowIndex, orderRow.values);

  // Guard: already confirmed
  if (order.payment_status !== 'pending') {
    return jsonError_Ops_('Order is not in pending status.');
  }

  const now = new Date();

  // 1. Update order status
  updateRowFields_Ops_(ordersSheet, orderRow.rowIndex, {
    payment_status: 'confirmed',
    confirmed_at: now.toISOString(),
  });

  // 2. Create Phase 1 account row
  const accountId = 'ACC-' + Utilities.getUuid().slice(0, 8).toUpperCase();
  const accountsSheet = ss.getSheetByName(ACCOUNTS_SHEET);
  // Columns: account_id, order_id, telegram_id, phase, mt5_login, mt5_password,
  //          mt5_server, status, issued_at, parent_account_id
  accountsSheet.appendRow([
    accountId,
    orderId,
    String(order.telegram_id),
    1,             // phase 1
    '',            // mt5_login — issued later
    '',            // mt5_password
    '',            // mt5_server
    'pending_credentials',
    '',            // issued_at — set when creds are issued
    '',            // parent_account_id — none for phase 1
  ]);

  // 3. Award referral points if applicable
  const usersSheet = ss.getSheetByName(USERS_SHEET_OPS);
  const userRow    = findRowByValue_Ops_(usersSheet, 'telegram_id', String(order.telegram_id));
  if (userRow) {
    const user = rowToObject_Ops_(usersSheet, userRow.rowIndex, userRow.values);
    if (user.referred_by) {
      awardReferralPoints_(ss, String(user.referred_by), String(order.telegram_id), orderId);
    }
  }

  // 4. Notify trader
  try { notifyPaymentConfirmed(String(order.telegram_id)); } catch (e) {
    Logger.log('Notification error (confirmOrder): ' + e.message);
  }

  return jsonSuccess_Ops_({ success: true, account_id: accountId });
}

/**
 * Rejects an order: sets payment_status = rejected and notifies the trader.
 */
function handleRejectOrder(payload) {
  const authErr = requireAdminSession_(payload);
  if (authErr) return authErr;

  const orderId = String(payload.order_id || '');
  if (!orderId) return jsonError_Ops_('Missing order_id.');

  const ss          = getSpreadsheet_Ops_();
  const ordersSheet = ss.getSheetByName(ORDERS_SHEET);
  const orderRow    = findRowByValue_Ops_(ordersSheet, 'order_id', orderId);
  if (!orderRow) return jsonError_Ops_('Order not found.');

  const order = rowToObject_Ops_(ordersSheet, orderRow.rowIndex, orderRow.values);
  if (order.payment_status !== 'pending') {
    return jsonError_Ops_('Order is not in pending status.');
  }

  updateRowFields_Ops_(ordersSheet, orderRow.rowIndex, { payment_status: 'rejected' });

  try { notifyPaymentConfirmed(String(order.telegram_id)); } catch (e) {
    // notifyPaymentRejected — using notifyPaymentConfirmed placeholder only;
    // swap to notifyPaymentRejected when that notification exists.
    Logger.log('Notification error (rejectOrder): ' + e.message);
  }

  // Call the correct notification
  try {
    if (typeof notifyPaymentRejected === 'function') {
      notifyPaymentRejected(String(order.telegram_id));
    }
  } catch (e) { Logger.log('notifyPaymentRejected error: ' + e.message); }

  return jsonSuccess_Ops_({ success: true });
}

// ─────────────────────────────────────────────────────────────────────────
// ACCOUNTS
// ─────────────────────────────────────────────────────────────────────────

/**
 * Returns all Accounts, enriched with trader username from Users sheet.
 * Supports optional phase / status filtering via payload (not used by the
 * client filter — filtering is done client-side after fetch — but available
 * for future server-side use).
 */
function handleGetAccounts(payload) {
  const authErr = requireAdminSession_(payload);
  if (authErr) return authErr;

  const ss       = getSpreadsheet_Ops_();
  const accounts = readAllRows_Ops_(ss, ACCOUNTS_SHEET);
  const users    = readAllRows_Ops_(ss, USERS_SHEET_OPS);

  const enriched = accounts.map(a => {
    const user = users.find(u => String(u.telegram_id) === String(a.telegram_id));
    return {
      account_id:        String(a.account_id),
      order_id:          String(a.order_id),
      telegram_id:       String(a.telegram_id),
      username:          user ? String(user.username || '') : '',
      phase:             a.phase,
      mt5_login:         a.mt5_login  ? String(a.mt5_login)  : '',
      mt5_password:      a.mt5_password ? String(a.mt5_password) : '',
      mt5_server:        a.mt5_server ? String(a.mt5_server) : '',
      status:            String(a.status),
      issued_at:         normalizeDateOps_(a.issued_at),
      parent_account_id: a.parent_account_id ? String(a.parent_account_id) : '',
    };
  });

  return jsonSuccess_Ops_({ success: true, accounts: enriched });
}

/**
 * Issues MT5 credentials to an account:
 *  - Writes mt5_login, mt5_password, mt5_server
 *  - Sets status = active, issued_at = now
 *  - Notifies the trader with their credentials
 */
function handleIssueCredentials(payload) {
  const authErr = requireAdminSession_(payload);
  if (authErr) return authErr;

  const accountId = String(payload.account_id || '');
  const login     = String(payload.mt5_login   || '').trim();
  const password  = String(payload.mt5_password || '').trim();
  const server    = String(payload.mt5_server   || '').trim();

  if (!accountId) return jsonError_Ops_('Missing account_id.');
  if (!login || !password || !server) return jsonError_Ops_('Missing credential fields.');

  const ss            = getSpreadsheet_Ops_();
  const accountsSheet = ss.getSheetByName(ACCOUNTS_SHEET);
  const accountRow    = findRowByValue_Ops_(accountsSheet, 'account_id', accountId);
  if (!accountRow) return jsonError_Ops_('Account not found.');

  const account = rowToObject_Ops_(accountsSheet, accountRow.rowIndex, accountRow.values);
  if (account.status !== 'pending_credentials') {
    return jsonError_Ops_('Account is not awaiting credentials.');
  }

  updateRowFields_Ops_(accountsSheet, accountRow.rowIndex, {
    mt5_login:    login,
    mt5_password: password,
    mt5_server:   server,
    status:       'active',
    issued_at:    new Date().toISOString(),
  });

  try {
    notifyCredentialsIssued(String(account.telegram_id), login, password, server);
  } catch (e) { Logger.log('notifyCredentialsIssued error: ' + e.message); }

  return jsonSuccess_Ops_({ success: true });
}

/**
 * Updates an account's status. Handles all terminal and progression states:
 *
 *   passed   → creates next-phase account row; notifies trader
 *   breached → marks status; notifies trader (fee lost)
 *   blown    → marks status; awards 35% fee refund as points if toggle on; notifies trader
 *   scaled   → marks status; notifies trader
 */
function handleUpdateAccountStatus(payload) {
  const authErr = requireAdminSession_(payload);
  if (authErr) return authErr;

  const accountId = String(payload.account_id || '');
  const newStatus = String(payload.status     || '');

  if (!accountId) return jsonError_Ops_('Missing account_id.');

  const validStatuses = ['passed', 'breached', 'blown', 'scaled'];
  if (!validStatuses.includes(newStatus)) {
    return jsonError_Ops_('Invalid status: ' + newStatus);
  }

  const ss            = getSpreadsheet_Ops_();
  const accountsSheet = ss.getSheetByName(ACCOUNTS_SHEET);
  const accountRow    = findRowByValue_Ops_(accountsSheet, 'account_id', accountId);
  if (!accountRow) return jsonError_Ops_('Account not found.');

  const account   = rowToObject_Ops_(accountsSheet, accountRow.rowIndex, accountRow.values);
  const telegramId = String(account.telegram_id);
  const phase      = account.phase;

  // Update the account status
  updateRowFields_Ops_(accountsSheet, accountRow.rowIndex, { status: newStatus });

  // ── Status-specific side effects ──

  if (newStatus === 'passed') {
    // Determine next phase
    const nextPhase = (phase === 1 || phase === '1') ? 2 : 'funded';
    const nextAccountId = 'ACC-' + Utilities.getUuid().slice(0, 8).toUpperCase();

    accountsSheet.appendRow([
      nextAccountId,
      String(account.order_id),
      telegramId,
      nextPhase,
      '', '', '',                   // mt5 credentials — pending
      'pending_credentials',
      '',                           // issued_at
      accountId,                    // parent_account_id
    ]);

    try { notifyPhasePassed(telegramId, phase); }
    catch (e) { Logger.log('notifyPhasePassed error: ' + e.message); }
  }

  if (newStatus === 'breached') {
    try { notifyPhaseBreached(telegramId, phase); }
    catch (e) { Logger.log('notifyPhaseBreached error: ' + e.message); }
  }

  if (newStatus === 'blown') {
    let pointsRefunded = 0;

    // Check blown_refund_toggle setting
    const settingsSheet  = ss.getSheetByName('Settings');
    const settingsData   = settingsSheet.getDataRange().getValues();
    const sHeaders       = settingsData[0];
    const keyCol         = sHeaders.indexOf('key');
    const valCol         = sHeaders.indexOf('value');
    let   blownToggle    = false;

    for (let i = 1; i < settingsData.length; i++) {
      if (String(settingsData[i][keyCol]) === 'blown_refund_toggle') {
        blownToggle = settingsData[i][valCol] === true ||
                      settingsData[i][valCol] === 'true' ||
                      settingsData[i][valCol] === 'TRUE';
        break;
      }
    }

    if (blownToggle) {
      // Look up original order price to calculate 35% refund
      const ordersSheet = ss.getSheetByName(ORDERS_SHEET);
      const orderRow    = findRowByValue_Ops_(ordersSheet, 'order_id', String(account.order_id));
      if (orderRow) {
        const order   = rowToObject_Ops_(ordersSheet, orderRow.rowIndex, orderRow.values);
        const fee     = Number(order.price_paid) - Number(order.discount_amount || 0);
        pointsRefunded = Math.round(fee * 0.35);

        if (pointsRefunded > 0) {
          awardPoints_(ss, telegramId, 'blown_refund', 'Blown account fee refund (35%)', pointsRefunded, accountId);
        }
      }
    }

    try { notifyAccountBlown(telegramId, pointsRefunded); }
    catch (e) { Logger.log('notifyAccountBlown error: ' + e.message); }
  }

  if (newStatus === 'scaled') {
    try { notifyScaleUpAvailable(telegramId); }
    catch (e) { Logger.log('notifyScaleUpAvailable error: ' + e.message); }
  }

  return jsonSuccess_Ops_({ success: true });
}

// ─────────────────────────────────────────────────────────────────────────
// PAYOUTS
// ─────────────────────────────────────────────────────────────────────────

/**
 * Returns all pending payout requests, enriched with trader username.
 */
function handleGetPayoutsQueue(payload) {
  const authErr = requireAdminSession_(payload);
  if (authErr) return authErr;

  const ss      = getSpreadsheet_Ops_();
  const payouts = readAllRows_Ops_(ss, PAYOUT_REQUESTS_SHEET)
    .filter(p => p.status === 'pending');

  const users = readAllRows_Ops_(ss, USERS_SHEET_OPS);

  const enriched = payouts.map(p => {
    const user = users.find(u => String(u.telegram_id) === String(p.telegram_id));
    return {
      payout_id:        String(p.payout_id),
      account_id:       String(p.account_id),
      telegram_id:      String(p.telegram_id),
      username:         user ? String(user.username || '') : '',
      amount_requested: Number(p.amount_requested),
      trader_wallet:    String(p.trader_wallet || ''),
      status:           String(p.status),
      payout_number:    Number(p.payout_number || 1),
      split_applied:    p.split_applied ? Number(p.split_applied) : null,
      created_at:       normalizeDateOps_(p.created_at),
    };
  });

  return jsonSuccess_Ops_({ success: true, payouts: enriched });
}

/**
 * Approves a payout:
 *  1. Determines the correct split % from the linked Plan
 *  2. Updates PayoutRequest: status = approved, split_applied, resolved_at
 *  3. If payout_number >= 2, triggers scale-up notifications (trader + admin)
 *  4. Notifies trader
 */
function handleApprovePayout(payload) {
  const authErr = requireAdminSession_(payload);
  if (authErr) return authErr;

  const payoutId = String(payload.payout_id || '');
  if (!payoutId) return jsonError_Ops_('Missing payout_id.');

  const ss            = getSpreadsheet_Ops_();
  const payoutsSheet  = ss.getSheetByName(PAYOUT_REQUESTS_SHEET);
  const payoutRow     = findRowByValue_Ops_(payoutsSheet, 'payout_id', payoutId);
  if (!payoutRow) return jsonError_Ops_('Payout request not found.');

  const payout = rowToObject_Ops_(payoutsSheet, payoutRow.rowIndex, payoutRow.values);
  if (payout.status !== 'pending') return jsonError_Ops_('Payout is not pending.');

  const telegramId    = String(payout.telegram_id);
  const payoutNumber  = Number(payout.payout_number || 1);
  const amountRequested = Number(payout.amount_requested);

  // Determine split % from the linked account's order → plan
  let splitPercent = 80; // safe fallback
  try {
    const accountsSheet = ss.getSheetByName(ACCOUNTS_SHEET);
    const accountRow    = findRowByValue_Ops_(accountsSheet, 'account_id', String(payout.account_id));
    if (accountRow) {
      const account   = rowToObject_Ops_(accountsSheet, accountRow.rowIndex, accountRow.values);
      const ordersSheet = ss.getSheetByName(ORDERS_SHEET);
      const orderRow    = findRowByValue_Ops_(ordersSheet, 'order_id', String(account.order_id));
      if (orderRow) {
        const order    = rowToObject_Ops_(ordersSheet, orderRow.rowIndex, orderRow.values);
        const plansSheet = ss.getSheetByName(PLANS_SHEET_OPS);
        const planRow    = findRowByValue_Ops_(plansSheet, 'plan_id', String(order.plan_id));
        if (planRow) {
          const plan = rowToObject_Ops_(plansSheet, planRow.rowIndex, planRow.values);
          splitPercent = payoutNumber === 1
            ? Number(plan.payout_split_first)
            : Number(plan.payout_split_second);
        }
      }
    }
  } catch (e) {
    Logger.log('Split lookup error: ' + e.message);
  }

  const traderAmount = Math.round((amountRequested * splitPercent / 100) * 100) / 100;

  updateRowFields_Ops_(payoutsSheet, payoutRow.rowIndex, {
    status:        'approved',
    split_applied: splitPercent,
    resolved_at:   new Date().toISOString(),
  });

  // Notify trader payout approved
  try { notifyPayoutApproved(telegramId, traderAmount, String(payout.trader_wallet)); }
  catch (e) { Logger.log('notifyPayoutApproved error: ' + e.message); }

  // If 2nd+ payout — trigger scale-up
  if (payoutNumber >= 2) {
    try { notifyScaleUpAvailable(telegramId); } catch (e) {}
    try {
      const accountId = String(payout.account_id);
      const usersSheet = ss.getSheetByName(USERS_SHEET_OPS);
      const userRow    = findRowByValue_Ops_(usersSheet, 'telegram_id', telegramId);
      const username   = userRow
        ? String(rowToObject_Ops_(usersSheet, userRow.rowIndex, userRow.values).username || telegramId)
        : telegramId;
      notifyAdminScaleUpReady(accountId, username);
    } catch (e) { Logger.log('notifyAdminScaleUpReady error: ' + e.message); }
  }

  return jsonSuccess_Ops_({ success: true, split_applied: splitPercent, trader_amount: traderAmount });
}

/**
 * Rejects a payout: sets status = rejected and notifies the trader.
 */
function handleRejectPayout(payload) {
  const authErr = requireAdminSession_(payload);
  if (authErr) return authErr;

  const payoutId = String(payload.payout_id || '');
  if (!payoutId) return jsonError_Ops_('Missing payout_id.');

  const ss           = getSpreadsheet_Ops_();
  const payoutsSheet = ss.getSheetByName(PAYOUT_REQUESTS_SHEET);
  const payoutRow    = findRowByValue_Ops_(payoutsSheet, 'payout_id', payoutId);
  if (!payoutRow) return jsonError_Ops_('Payout request not found.');

  const payout = rowToObject_Ops_(payoutsSheet, payoutRow.rowIndex, payoutRow.values);
  if (payout.status !== 'pending') return jsonError_Ops_('Payout is not pending.');

  updateRowFields_Ops_(payoutsSheet, payoutRow.rowIndex, {
    status:      'rejected',
    resolved_at: new Date().toISOString(),
  });

  try { notifyPayoutRejected(String(payout.telegram_id)); }
  catch (e) { Logger.log('notifyPayoutRejected error: ' + e.message); }

  return jsonSuccess_Ops_({ success: true });
}

// ─────────────────────────────────────────────────────────────────────────
// SUPPORT
// ─────────────────────────────────────────────────────────────────────────

/**
 * Returns all open support threads, enriched with trader username and
 * sorted by last_message_at descending (most recent first).
 */
function handleGetOpenSupportThreads(payload) {
  const authErr = requireAdminSession_(payload);
  if (authErr) return authErr;

  const ss      = getSpreadsheet_Ops_();
  const threads = readAllRows_Ops_(ss, SUPPORT_THREADS_SHEET)
    .filter(t => t.status === 'open');

  const users = readAllRows_Ops_(ss, USERS_SHEET_OPS);

  const enriched = threads.map(t => {
    const user = users.find(u => String(u.telegram_id) === String(t.telegram_id));
    return {
      thread_id:       String(t.thread_id),
      telegram_id:     String(t.telegram_id),
      username:        user ? String(user.username || '') : '',
      status:          String(t.status),
      created_at:      normalizeDateOps_(t.created_at),
      last_message_at: normalizeDateOps_(t.last_message_at),
    };
  });

  // Sort: most recently active first
  enriched.sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at));

  return jsonSuccess_Ops_({ success: true, threads: enriched });
}

/**
 * Returns the full message history for a single support thread.
 */
function handleGetSupportThreadMessages(payload) {
  const authErr = requireAdminSession_(payload);
  if (authErr) return authErr;

  const threadId = String(payload.thread_id || '');
  if (!threadId) return jsonError_Ops_('Missing thread_id.');

  const ss       = getSpreadsheet_Ops_();
  const messages = readAllRows_Ops_(ss, SUPPORT_MESSAGES_SHEET)
    .filter(m => String(m.thread_id) === threadId)
    .map(m => ({
      message_id: String(m.message_id),
      thread_id:  String(m.thread_id),
      sender:     String(m.sender),
      content:    String(m.content),
      created_at: normalizeDateOps_(m.created_at),
    }));

  // Chronological order
  messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  return jsonSuccess_Ops_({ success: true, messages: messages });
}

/**
 * Posts an admin reply to a support thread:
 *  1. Appends a row to SupportMessages (sender = 'admin')
 *  2. Updates SupportThreads last_message_at
 *  3. Notifies the trader
 */
function handlePostAdminReply(payload) {
  const authErr = requireAdminSession_(payload);
  if (authErr) return authErr;

  const threadId = String(payload.thread_id || '');
  const content  = String(payload.content   || '').trim();

  if (!threadId) return jsonError_Ops_('Missing thread_id.');
  if (!content)  return jsonError_Ops_('Reply cannot be empty.');

  const ss             = getSpreadsheet_Ops_();
  const threadsSheet   = ss.getSheetByName(SUPPORT_THREADS_SHEET);
  const messagesSheet  = ss.getSheetByName(SUPPORT_MESSAGES_SHEET);

  const threadRow = findRowByValue_Ops_(threadsSheet, 'thread_id', threadId);
  if (!threadRow) return jsonError_Ops_('Thread not found.');

  const thread     = rowToObject_Ops_(threadsSheet, threadRow.rowIndex, threadRow.values);
  const telegramId = String(thread.telegram_id);

  if (thread.status !== 'open') return jsonError_Ops_('Thread is not open.');

  const now       = new Date();
  const messageId = 'MSG-' + Utilities.getUuid().slice(0, 8).toUpperCase();

  // Columns: message_id, thread_id, sender, content, created_at
  messagesSheet.appendRow([
    messageId,
    threadId,
    'admin',
    content,
    now.toISOString(),
  ]);

  // Update last_message_at on the thread
  updateRowFields_Ops_(threadsSheet, threadRow.rowIndex, {
    last_message_at: now.toISOString(),
  });

  try { notifySupportReply(telegramId); }
  catch (e) { Logger.log('notifySupportReply error: ' + e.message); }

  return jsonSuccess_Ops_({ success: true, message_id: messageId });
}

/**
 * Closes a support thread: sets status = closed.
 */
function handleCloseSupportThread(payload) {
  const authErr = requireAdminSession_(payload);
  if (authErr) return authErr;

  const threadId = String(payload.thread_id || '');
  if (!threadId) return jsonError_Ops_('Missing thread_id.');

  const ss           = getSpreadsheet_Ops_();
  const threadsSheet = ss.getSheetByName(SUPPORT_THREADS_SHEET);
  const threadRow    = findRowByValue_Ops_(threadsSheet, 'thread_id', threadId);
  if (!threadRow) return jsonError_Ops_('Thread not found.');

  updateRowFields_Ops_(threadsSheet, threadRow.rowIndex, { status: 'closed' });

  return jsonSuccess_Ops_({ success: true });
}

// ─────────────────────────────────────────────────────────────────────────
// AUTH — re-validates on every request
// ─────────────────────────────────────────────────────────────────────────

/**
 * Validates the admin session token on every request.
 * Returns null if valid, or a JSON error response to return immediately.
 *
 * validateAdminSessionToken_() lives in admin-login.gs (same project).
 */
function requireAdminSession_(payload) {
  const token = payload && payload.session;
  if (!token) return jsonError_Ops_('unauthorized');

  const valid = validateAdminSessionToken_(token); // admin-login.gs
  if (!valid)  return jsonError_Ops_('session_expired');

  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// POINTS HELPERS (used by confirmOrder and updateAccountStatus/blown)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Awards referral points to a referrer when their referred user's order
 * is confirmed.
 */
function awardReferralPoints_(ss, referrerTelegramId, referredTelegramId, orderId) {
  try {
    const props  = PropertiesService.getScriptProperties();
    const settingsSheet = ss.getSheetByName('Settings');
    const sData   = settingsSheet.getDataRange().getValues();
    const sHdr    = sData[0];
    const keyCol  = sHdr.indexOf('key');
    const valCol  = sHdr.indexOf('value');

    let pointsPerReferral = 100; // default
    for (let i = 1; i < sData.length; i++) {
      if (String(sData[i][keyCol]) === 'points_per_referral') {
        pointsPerReferral = Number(sData[i][valCol]) || 100;
        break;
      }
    }

    awardPoints_(ss, referrerTelegramId, 'referral', 'Referral bonus — referred user confirmed', pointsPerReferral, orderId);

    // Update Referrals sheet: mark as converted
    const referralsSheet = ss.getSheetByName(REFERRALS_SHEET_OPS);
    const data    = referralsSheet.getDataRange().getValues();
    const headers = data[0];
    const refererCol  = headers.indexOf('referrer_telegram_id');
    const referredCol = headers.indexOf('referred_telegram_id');
    const statusCol   = headers.indexOf('status') + 1;
    const convertedCol= headers.indexOf('converted_at') + 1;
    const awardedCol  = headers.indexOf('points_awarded') + 1;

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][refererCol]) === referrerTelegramId &&
          String(data[i][referredCol]) === referredTelegramId) {
        referralsSheet.getRange(i + 1, statusCol).setValue('converted');
        referralsSheet.getRange(i + 1, convertedCol).setValue(new Date().toISOString());
        referralsSheet.getRange(i + 1, awardedCol).setValue(pointsPerReferral);
        break;
      }
    }
  } catch (e) {
    Logger.log('awardReferralPoints_ error: ' + e.message);
  }
}

/**
 * Appends a PointsLedger row and updates the Users points_balance.
 */
function awardPoints_(ss, telegramId, type, reason, points, referenceId) {
  const ledgerSheet = ss.getSheetByName(POINTS_LEDGER_OPS);
  const ledgerId    = 'LDG-' + Utilities.getUuid().slice(0, 8).toUpperCase();

  // Columns: ledger_id, telegram_id, type, reason, points, reference_id, created_at
  ledgerSheet.appendRow([
    ledgerId,
    telegramId,
    type,
    reason,
    points,
    referenceId || '',
    new Date().toISOString(),
  ]);

  // Update Users points_balance
  const usersSheet = ss.getSheetByName(USERS_SHEET_OPS);
  const userRow    = findRowByValue_Ops_(usersSheet, 'telegram_id', telegramId);
  if (userRow) {
    const user    = rowToObject_Ops_(usersSheet, userRow.rowIndex, userRow.values);
    const current = Number(user.points_balance || 0);
    updateRowFields_Ops_(usersSheet, userRow.rowIndex, { points_balance: current + points });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// SHEET HELPERS
// (These mirror the helpers in admin-manage.gs but are scoped with _Ops_
//  suffix to avoid any collision if GAS ever merges scopes across files.)
// ─────────────────────────────────────────────────────────────────────────

function getSpreadsheet_Ops_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  return SpreadsheetApp.openById(id);
}

function readAllRows_Ops_(ss, sheetName) {
  const sheet   = ss.getSheetByName(sheetName);
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const rows    = [];
  for (let i = 1; i < data.length; i++) {
    rows.push(headers.reduce((acc, h, idx) => { acc[h] = data[i][idx]; return acc; }, {}));
  }
  return rows;
}

function findRowByValue_Ops_(sheet, columnName, value) {
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const col     = headers.indexOf(columnName);
  if (col === -1) return null;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][col]) === String(value)) {
      return { rowIndex: i + 1, values: data[i] };
    }
  }
  return null;
}

function rowToObject_Ops_(sheet, rowIndex, values) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  return headers.reduce((acc, h, idx) => { acc[h] = values[idx]; return acc; }, {});
}

function updateRowFields_Ops_(sheet, rowIndex, fieldMap) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  Object.keys(fieldMap).forEach(key => {
    if (fieldMap[key] === undefined) return;
    const col = headers.indexOf(key);
    if (col === -1) return;
    sheet.getRange(rowIndex, col + 1).setValue(fieldMap[key]);
  });
}

function countRowsWhere_(ss, sheetName, column, value) {
  const sheet   = ss.getSheetByName(sheetName);
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const col     = headers.indexOf(column);
  if (col === -1) return 0;
  let count = 0;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][col]) === value) count++;
  }
  return count;
}

function normalizeDateOps_(value) {
  if (value instanceof Date) return value.toISOString();
  return value ? String(value) : '';
}

function jsonSuccess_Ops_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonError_Ops_(message) {
  return ContentService
    .createTextOutput(JSON.stringify({ success: false, error: message }))
    .setMimeType(ContentService.MimeType.JSON);
}
