// ============================================================
//  dashboard.gs
//  NowFunded — Trader Dashboard backend
//  Action: getDashboard, requestPayout
// ============================================================

/**
 * Entry point — called by the shared doPost router in index.gs.
 * Supported actions:
 *   getDashboard  — returns all accounts + plan details + payout history for a trader
 *   requestPayout — submits a new payout request for a funded/scaled account
 */
function handleDashboard(payload) {
  const action = payload.action;

  if (action === 'getDashboard')  return getDashboard(payload);
  if (action === 'requestPayout') return requestPayout(payload);

  return { error: 'Unknown dashboard action: ' + action };
}


// ─── getDashboard ────────────────────────────────────────────────────────────

/**
 * Returns all Accounts for the trader, enriched with:
 *   - Plan details (name, account_size, targets, drawdown, payout splits)
 *   - MT5 credentials (if issued)
 *   - Payout history (from PayoutRequests)
 *
 * Response shape:
 * {
 *   success: true,
 *   accounts: [
 *     {
 *       account_id, order_id, telegram_id,
 *       phase, mt5_login, mt5_password, mt5_server,
 *       status, issued_at, parent_account_id,
 *       plan_id, plan_name, account_size,
 *       plan_phase1_target, plan_phase2_target,
 *       plan_max_drawdown,
 *       plan_payout_split_first, plan_payout_split_second,
 *       payouts: [ { payout_id, payout_number, amount_requested,
 *                    trader_wallet, status, created_at, resolved_at } ]
 *     }, ...
 *   ]
 * }
 */
function getDashboard(payload) {
  const telegramId = String(payload.telegram_id || '').trim();
  if (!telegramId) return { error: 'telegram_id required' };

  const ss = SpreadsheetApp.openById(
    PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID')
  );

  // ── Load Accounts for this trader ───────────────────────────────────────
  const accountsSheet = ss.getSheetByName('Accounts');
  const accountsData  = accountsSheet.getDataRange().getValues();
  const accountsHdr   = accountsData[0];

  const colA = makeColMap(accountsHdr);

  const traderAccounts = [];
  for (let r = 1; r < accountsData.length; r++) {
    const row = accountsData[r];
    if (String(row[colA.telegram_id]) !== telegramId) continue;

    traderAccounts.push({
      account_id:       row[colA.account_id],
      order_id:         row[colA.order_id],
      telegram_id:      row[colA.telegram_id],
      phase:            Number(row[colA.phase]) || 1,
      mt5_login:        row[colA.mt5_login]    || '',
      mt5_password:     row[colA.mt5_password] || '',
      mt5_server:       row[colA.mt5_server]   || '',
      status:           row[colA.status]       || 'active',
      issued_at:        row[colA.issued_at]    || '',
      parent_account_id:row[colA.parent_account_id] || '',
      plan_id:          '',   // filled below from Orders
      // plan fields filled below
      payouts: [],
    });
  }

  if (traderAccounts.length === 0) {
    return { success: true, accounts: [] };
  }

  // ── Load Orders to get plan_id per account ───────────────────────────────
  const ordersSheet = ss.getSheetByName('Orders');
  const ordersData  = ordersSheet.getDataRange().getValues();
  const ordersHdr   = ordersData[0];
  const colO        = makeColMap(ordersHdr);

  const orderMap = {};  // order_id → plan_id
  for (let r = 1; r < ordersData.length; r++) {
    const row = ordersData[r];
    orderMap[String(row[colO.order_id])] = String(row[colO.plan_id]);
  }

  traderAccounts.forEach(acc => {
    acc.plan_id = orderMap[String(acc.order_id)] || '';
  });

  // ── Load Plans to enrich account data ────────────────────────────────────
  const plansSheet = ss.getSheetByName('Plans');
  const plansData  = plansSheet.getDataRange().getValues();
  const plansHdr   = plansData[0];
  const colP       = makeColMap(plansHdr);

  const planMap = {};  // plan_id → plan row object
  for (let r = 1; r < plansData.length; r++) {
    const row  = plansData[r];
    const pid  = String(row[colP.plan_id]);
    planMap[pid] = {
      plan_name:              row[colP.name]              || '',
      account_size:           row[colP.account_size]      || 0,
      plan_phase1_target:     row[colP.phase1_target]     || '',
      plan_phase2_target:     row[colP.phase2_target]     || '',
      plan_max_drawdown:      row[colP.max_drawdown]      || '',
      plan_payout_split_first: row[colP.payout_split_first]  || '',
      plan_payout_split_second:row[colP.payout_split_second] || '',
    };
  }

  traderAccounts.forEach(acc => {
    const plan = planMap[String(acc.plan_id)] || {};
    Object.assign(acc, plan);
  });

  // ── Load PayoutRequests for this trader ──────────────────────────────────
  const payoutsSheet = ss.getSheetByName('PayoutRequests');
  const payoutsData  = payoutsSheet.getDataRange().getValues();
  const payoutsHdr   = payoutsData[0];
  const colPR        = makeColMap(payoutsHdr);

  // Build a map: account_id → [ payout rows ]
  const payoutMap = {};
  for (let r = 1; r < payoutsData.length; r++) {
    const row = payoutsData[r];
    if (String(row[colPR.telegram_id]) !== telegramId) continue;
    const aid = String(row[colPR.account_id]);
    if (!payoutMap[aid]) payoutMap[aid] = [];
    payoutMap[aid].push({
      payout_id:        row[colPR.payout_id],
      payout_number:    Number(row[colPR.payout_number]) || 1,
      amount_requested: Number(row[colPR.amount_requested]) || 0,
      trader_wallet:    row[colPR.trader_wallet] || '',
      status:           row[colPR.status]        || 'pending',
      split_applied:    row[colPR.split_applied] || '',
      created_at:       row[colPR.created_at]    || '',
      resolved_at:      row[colPR.resolved_at]   || '',
    });
  }

  traderAccounts.forEach(acc => {
    acc.payouts = payoutMap[String(acc.account_id)] || [];
  });

  // Sort: active/funded/scaled first, then by issued_at desc
  traderAccounts.sort((a, b) => {
    const priority = s => ['scaled','funded','active','passed','breached','blown'].indexOf(s);
    const pa = priority(a.status), pb = priority(b.status);
    if (pa !== pb) return pa - pb;
    return (b.issued_at > a.issued_at) ? 1 : -1;
  });

  return { success: true, accounts: traderAccounts };
}


// ─── requestPayout ───────────────────────────────────────────────────────────

/**
 * Submits a payout request for a funded or scaled account.
 *
 * Validates:
 *   - Account exists and belongs to the trader
 *   - Account status is funded or scaled
 *   - No pending payout already exists for this account
 *
 * Writes a new row to PayoutRequests.
 * Notifies admin via notifications.gs → notifyAdminNewPayout().
 */
function requestPayout(payload) {
  const telegramId     = String(payload.telegram_id     || '').trim();
  const accountId      = String(payload.account_id      || '').trim();
  const traderWallet   = String(payload.trader_wallet   || '').trim();
  const amountRequested = parseFloat(payload.amount_requested) || 0;

  if (!telegramId)    return { error: 'telegram_id required' };
  if (!accountId)     return { error: 'account_id required' };
  if (!traderWallet)  return { error: 'Wallet address is required.' };
  if (amountRequested <= 0) return { error: 'Amount must be greater than zero.' };

  const ss = SpreadsheetApp.openById(
    PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID')
  );

  // ── Verify account ───────────────────────────────────────────────────────
  const accountsSheet = ss.getSheetByName('Accounts');
  const accountsData  = accountsSheet.getDataRange().getValues();
  const accountsHdr   = accountsData[0];
  const colA          = makeColMap(accountsHdr);

  let accountRow = null;
  let accountStatus = '';
  for (let r = 1; r < accountsData.length; r++) {
    const row = accountsData[r];
    if (String(row[colA.account_id]) === accountId &&
        String(row[colA.telegram_id]) === telegramId) {
      accountRow    = r + 1; // 1-based sheet row
      accountStatus = String(row[colA.status]);
      break;
    }
  }

  if (!accountRow) return { error: 'Account not found.' };
  if (!['funded','scaled'].includes(accountStatus)) {
    return { error: 'Payouts are only available on funded or scaled accounts.' };
  }

  // ── Check for existing pending payout ────────────────────────────────────
  const payoutsSheet = ss.getSheetByName('PayoutRequests');
  const payoutsData  = payoutsSheet.getDataRange().getValues();
  const payoutsHdr   = payoutsData[0];
  const colPR        = makeColMap(payoutsHdr);

  let pendingExists  = false;
  let payoutNumber   = 1;

  for (let r = 1; r < payoutsData.length; r++) {
    const row = payoutsData[r];
    if (String(row[colPR.account_id]) !== accountId) continue;
    payoutNumber++;  // count all existing payouts for this account
    if (String(row[colPR.status]) === 'pending') {
      pendingExists = true;
    }
  }

  if (pendingExists) {
    return { error: 'You already have a pending payout request for this account.' };
  }

  // ── Write new PayoutRequest row ──────────────────────────────────────────
  const payoutId  = 'PAY-' + Date.now();
  const createdAt = new Date().toISOString();

  payoutsSheet.appendRow([
    payoutId,       // payout_id
    accountId,      // account_id
    telegramId,     // telegram_id
    amountRequested,// amount_requested
    traderWallet,   // trader_wallet
    'pending',      // status
    payoutNumber,   // payout_number
    '',             // split_applied (set by admin on approval)
    createdAt,      // created_at
    '',             // resolved_at
  ]);

  // ── Notify admin ─────────────────────────────────────────────────────────
  try {
    const usersSheet = ss.getSheetByName('Users');
    const usersData  = usersSheet.getDataRange().getValues();
    const usersHdr   = usersData[0];
    const colU       = makeColMap(usersHdr);
    let username     = telegramId;
    for (let r = 1; r < usersData.length; r++) {
      if (String(usersData[r][colU.telegram_id]) === telegramId) {
        username = usersData[r][colU.username] || usersData[r][colU.first_name] || telegramId;
        break;
      }
    }
    notifyAdminNewPayout(payoutId, username, amountRequested);
  } catch (e) {
    // Non-fatal — log and continue
    console.error('Admin notification failed:', e);
  }

  return { success: true, payout_id: payoutId };
}


// ─── Shared helper ───────────────────────────────────────────────────────────

/**
 * Builds a column-name → index map from a header row.
 * e.g. makeColMap(['account_id','status']) → { account_id: 0, status: 1 }
 */
function makeColMap(headerRow) {
  const map = {};
  headerRow.forEach((h, i) => {
    const key = String(h).trim().toLowerCase().replace(/\s+/g, '_');
    map[key] = i;
  });
  return map;
}
