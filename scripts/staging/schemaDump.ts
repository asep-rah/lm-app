/**
 * Validates a production SCHEMA-ONLY dump before it is applied to staging.
 * - Refuses any data statement (COPY … FROM stdin, INSERT INTO) → no
 *   customer data can travel to staging through this file.
 * - Flags outbound HTTP inside the schema (pg_net / http extension / edge
 *   function hooks / URLs): a cloned trigger could call production endpoints
 *   from staging. Those must be reviewed and neutralised first.
 */
export type DumpReport = { dataStatements: string[]; outboundHttp: string[]; productionRefs: string[] };

export const inspectSchemaDump = (sql: string, productionRef: string): DumpReport => {
  const lines = sql.split(/\r?\n/);
  const hits = (re: RegExp) =>
    lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => re.test(l))
      .map(({ l, i }) => `line ${i + 1}: ${l.trim().slice(0, 120)}`);
  return {
    dataStatements: hits(/^\s*(COPY\s+[^\s]+.*FROM\s+stdin|INSERT\s+INTO\s)/i),
    outboundHttp: hits(/net\.http_(get|post|delete)|extensions\.http\(|\bhttp_(get|post)\s*\(|supabase_functions\.http_request|https?:\/\//i),
    productionRefs: hits(new RegExp(productionRef, 'i'))
  };
};
