-- Admin-managed site & app settings (guest sign-in prompt timing, maintenance mode, announcement banner,
-- feature switches, mobile app version policy). One JSON document under the key "site".
CREATE TABLE "AppSetting" (
  "key"       TEXT NOT NULL,
  "value"     TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedBy" TEXT NOT NULL DEFAULT '',
  CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);
