-- Viewing guardrail: aggregate watch stats per video/day/cohort, and tag impressions per shop/day.
CREATE TABLE "VideoDailyStat" (
  "id"          TEXT NOT NULL,
  "videoId"     TEXT NOT NULL,
  "day"         DATE NOT NULL,
  "cohort"      TEXT NOT NULL,
  "sessions"    INTEGER NOT NULL DEFAULT 0,
  "completions" INTEGER NOT NULL DEFAULT 0,
  "sumWatchMs"  BIGINT NOT NULL DEFAULT 0,
  "sumFrac"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "sumFracSq"   DOUBLE PRECISION NOT NULL DEFAULT 0,
  CONSTRAINT "VideoDailyStat_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "VideoDailyStat_videoId_day_cohort_key" ON "VideoDailyStat"("videoId", "day", "cohort");
CREATE INDEX "VideoDailyStat_day_cohort_idx" ON "VideoDailyStat"("day", "cohort");
ALTER TABLE "VideoDailyStat" ADD CONSTRAINT "VideoDailyStat_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SiteDailyStat" (
  "id"          TEXT NOT NULL,
  "siteId"      TEXT NOT NULL,
  "day"         DATE NOT NULL,
  "impressions" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "SiteDailyStat_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SiteDailyStat_siteId_day_key" ON "SiteDailyStat"("siteId", "day");
ALTER TABLE "SiteDailyStat" ADD CONSTRAINT "SiteDailyStat_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
