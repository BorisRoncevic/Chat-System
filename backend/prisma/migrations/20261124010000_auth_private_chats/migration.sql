ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "directKey" TEXT;
CREATE UNIQUE INDEX "Conversation_directKey_key" ON "Conversation"("directKey");

SELECT setval(pg_get_serial_sequence('"Conversation"', 'id'),
  COALESCE((SELECT MAX("id") FROM "Conversation"), 1),
  EXISTS(SELECT 1 FROM "Conversation"));
