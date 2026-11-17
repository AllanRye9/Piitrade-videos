-- One counted view per (session, video): the first time a session watches a video
-- viewedAt is set and Video.views is incremented; repeats don't count again.
ALTER TABLE "UserVideoState" ADD COLUMN "viewedAt" TIMESTAMP(3);
