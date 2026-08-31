ALTER TABLE "User"
ADD CONSTRAINT "User_microsoft_login_requires_object_id"
CHECK (NOT "microsoftLoginEnabled" OR "microsoftObjectId" IS NOT NULL);
