-- DropForeignKey
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_raisedById_fkey";

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "assigneeId" TEXT,
ADD COLUMN     "category" TEXT,
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "conversationId" TEXT,
ADD COLUMN     "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "number" SERIAL NOT NULL,
ADD COLUMN     "requesterEmail" TEXT,
ADD COLUMN     "requesterName" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'portal',
ALTER COLUMN "clientAccountId" DROP NOT NULL,
ALTER COLUMN "raisedById" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ticket_messages" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorType" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ticket_messages_ticketId_createdAt_idx" ON "ticket_messages"("ticketId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_number_key" ON "tickets"("number");

-- CreateIndex
CREATE INDEX "tickets_status_priority_lastActivityAt_idx" ON "tickets"("status", "priority", "lastActivityAt");

-- CreateIndex
CREATE INDEX "tickets_assigneeId_status_idx" ON "tickets"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "tickets_conversationId_idx" ON "tickets"("conversationId");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

