INSERT INTO "platform_settings" (
  "id", "currency", "minimum_investment", "maximum_investment", "compounding_enabled"
) VALUES (1, 'USDT', 300, 5000, true)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "ledger_accounts" (
  "code", "name", "type", "normal_balance", "currency"
) VALUES
  ('PLATFORM:HOT_WALLET', 'Platform hot wallet', 'ASSET', 'DEBIT', 'USDT'),
  ('PLATFORM:TREASURY_IN_TRANSIT', 'Treasury funds in transit', 'ASSET', 'DEBIT', 'USDT'),
  ('PLATFORM:BROKER_TREASURY', 'Broker and MT5 treasury', 'ASSET', 'DEBIT', 'USDT'),
  ('PLATFORM:WITHDRAWAL_RESERVED', 'Reserved withdrawal liability', 'LIABILITY', 'CREDIT', 'USDT'),
  ('PLATFORM:ACCRUAL_EXPENSE', 'Daily accrual expense', 'EXPENSE', 'DEBIT', 'USDT')
ON CONFLICT ("code") DO NOTHING;
