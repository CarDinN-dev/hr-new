ALTER TABLE "User" ADD COLUMN "microsoftObjectId" TEXT;

CREATE UNIQUE INDEX "User_microsoftObjectId_key" ON "User"("microsoftObjectId");
