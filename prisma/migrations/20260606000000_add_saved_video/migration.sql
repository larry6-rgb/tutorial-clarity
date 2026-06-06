-- CreateTable
CREATE TABLE IF NOT EXISTS "SavedVideo" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dateSaved" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isPersistent" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SavedVideo_pkey" PRIMARY KEY ("id")
);
