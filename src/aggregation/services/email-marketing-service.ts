import "server-only";

import { calculateEmailMarketingKpis, toEmailMarketingRecord, type EmailMarketingRecord } from "@/aggregation/services/email-marketing-analytics";
import { readMoonArqEmailSignups } from "@/collection/connectors/supabase/email-signups-adapter";

export type EmailMarketingSnapshot = {
  rows: EmailMarketingRecord[];
  kpis: ReturnType<typeof calculateEmailMarketingKpis>;
  fetchedAt: string;
  source: {
    project: "moonarq-web";
    schema: "public";
    table: "email_signups";
    connection: "direct_supabase";
  };
};

export async function getEmailMarketingSnapshot(dataSpaceId: string, now: Date = new Date()): Promise<EmailMarketingSnapshot> {
  const result = await readMoonArqEmailSignups(dataSpaceId);
  const rows = result.rows.map(toEmailMarketingRecord);
  return {
    rows,
    kpis: calculateEmailMarketingKpis(rows, now),
    fetchedAt: now.toISOString(),
    source: {
      project: "moonarq-web",
      schema: "public",
      table: "email_signups",
      connection: "direct_supabase",
    },
  };
}
