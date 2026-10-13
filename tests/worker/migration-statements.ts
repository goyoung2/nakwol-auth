// Current migrations contain ordinary statements and single BEGIN/END trigger bodies.
// Keep each trigger body intact when sending individual statements to D1.
export function migrationStatements(sql: string): readonly string[] {
  return sql.replace(/^--.*$/gm, '').match(/\s*CREATE TRIGGER\b[\s\S]*?\bEND\s*;|[^;]+;/gi)?.map(statement => statement.trim()).filter(Boolean) ?? [];
}
