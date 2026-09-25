ALTER TABLE "File" RENAME COLUMN "s3Key" TO "storageKey";

ALTER TABLE "UploadSession" RENAME COLUMN "s3Key" TO "storageKey";