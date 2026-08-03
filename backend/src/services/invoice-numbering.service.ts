import { prisma } from "../lib/db.js";
import { InternalError } from "../lib/app-error.js";

const SEQ_PAD = 6;

/** Pure formatting, split out so it's unit-testable without the DB. */
export function formatInvoiceNumber(year: number, seq: number): string {
  return `INV-${year}-${seq.toString().padStart(SEQ_PAD, "0")}`;
}

/**
 * Atomically allocate the next sequential invoice number for an owner within
 * a given year. Uses a single upsert-and-increment statement (INSERT ...
 * ON CONFLICT ... DO UPDATE ... RETURNING) so concurrent callers never race
 * on the same sequence value.
 */
export async function generateInvoiceNumber(
  ownerAddress: string,
  date: Date = new Date(),
): Promise<string> {
  const year = date.getUTCFullYear();

  const rows = await prisma.$queryRaw<{ lastSeq: number }[]>`
    INSERT INTO "InvoiceCounter" ("ownerAddress", "year", "lastSeq")
    VALUES (${ownerAddress}, ${year}, 1)
    ON CONFLICT ("ownerAddress", "year")
    DO UPDATE SET "lastSeq" = "InvoiceCounter"."lastSeq" + 1
    RETURNING "lastSeq"
  `;

  const seq = rows[0]?.lastSeq;
  if (seq === undefined) {
    throw new InternalError("Failed to allocate invoice number");
  }

  return formatInvoiceNumber(year, seq);
}
