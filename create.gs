function createNowFundedSpreadsheet() {
  var ss = SpreadsheetApp.create("NowFunded");

  var sheets = [
    {
      name: "Users",
      columns: [
        "telegram_id", "username", "first_name", "referral_code",
        "referred_by", "points_balance", "join_date", "onboarding_complete"
      ]
    },
    {
      name: "Plans",
      columns: [
        "plan_id", "name", "account_size", "price_usd",
        "phase1_target", "phase2_target", "max_drawdown",
        "payout_split_first", "payout_split_second", "is_active"
      ]
    },
    {
      name: "Orders",
      columns: [
        "order_id", "telegram_id", "plan_id", "price_paid",
        "discount_code", "discount_amount", "payment_reference",
        "payment_status", "created_at", "confirmed_at"
      ]
    },
    {
      name: "Accounts",
      columns: [
        "account_id", "order_id", "telegram_id", "phase",
        "mt5_login", "mt5_password", "mt5_server", "status",
        "issued_at", "parent_account_id"
      ]
    },
    {
      name: "PayoutRequests",
      columns: [
        "payout_id", "account_id", "telegram_id", "amount_requested",
        "trader_wallet", "status", "payout_number", "split_applied",
        "created_at", "resolved_at"
      ]
    },
    {
      name: "PointsLedger",
      columns: [
        "ledger_id", "telegram_id", "type", "reason",
        "points", "reference_id", "created_at"
      ]
    },
    {
      name: "DiscountCodes",
      columns: [
        "code", "type", "discount_percent", "max_uses",
        "uses_so_far", "is_active", "created_at"
      ]
    },
    {
      name: "Referrals",
      columns: [
        "referral_id", "referrer_telegram_id", "referred_telegram_id",
        "status", "converted_at", "points_awarded"
      ]
    },
    {
      name: "SupportThreads",
      columns: [
        "thread_id", "telegram_id", "status",
        "created_at", "last_message_at"
      ]
    },
    {
      name: "SupportMessages",
      columns: [
        "message_id", "thread_id", "sender", "content", "created_at"
      ]
    },
    {
      name: "Settings",
      columns: ["key", "value", "label"]
    }
  ];

  // Rename the default sheet to the first tab name
  var defaultSheet = ss.getSheets()[0];
  defaultSheet.setName(sheets[0].name);
  defaultSheet.getRange(1, 1, 1, sheets[0].columns.length)
    .setValues([sheets[0].columns]);

  // Create remaining sheets
  for (var i = 1; i < sheets.length; i++) {
    var sheet = ss.insertSheet(sheets[i].name);
    sheet.getRange(1, 1, 1, sheets[i].columns.length)
      .setValues([sheets[i].columns]);
  }

  Logger.log("NowFunded spreadsheet created: " + ss.getUrl());
}
