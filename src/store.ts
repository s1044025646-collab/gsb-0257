import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const SCHEMA_VERSION = 1;

export interface RecordRow {
  id: number;
  created_at: string;
  input: string;
  input_value: string;
  max_denominator: number;
  input_version: string;
  schema_version: number;
  snapshot: string;
}

export function openDb(dbPath: string): DatabaseSync {
  const abs = resolve(dbPath);
  mkdirSync(dirname(abs), { recursive: true });
  const db = new DatabaseSync(abs);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS calculations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      input TEXT NOT NULL,
      input_value TEXT NOT NULL,
      max_denominator INTEGER NOT NULL,
      input_version TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      snapshot TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_calcs_created ON calculations(created_at);
  `);
  return db;
}

export interface SnapshotPayload {
  input: string;
  inputValue: string;
  maxDenominator: number;
  inputVersion: string;
  result: unknown;
}

export function insertCalculation(
  db: DatabaseSync,
  p: { input: string; inputValue: string; maxDenominator: number; inputVersion: string; snapshot: SnapshotPayload }
): number {
  const stmt = db.prepare(`
    INSERT INTO calculations (created_at, input, input_value, max_denominator, input_version, schema_version, snapshot)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    new Date().toISOString(),
    p.input,
    p.inputValue,
    p.maxDenominator,
    p.inputVersion,
    SCHEMA_VERSION,
    JSON.stringify(p.snapshot)
  );
  return Number(info.lastInsertRowid);
}

export function getCalculation(db: DatabaseSync, id: number): RecordRow | undefined {
  return db.prepare('SELECT * FROM calculations WHERE id = ?').get(id) as unknown as RecordRow | undefined;
}

export interface HistoryFilter {
  limit?: number;
  offset?: number;
  input?: string;
  maxDenominator?: number;
}

export function listCalculations(db: DatabaseSync, f: HistoryFilter = {}): RecordRow[] {
  const limit = Math.min(f.limit ?? 50, 500);
  const offset = f.offset ?? 0;
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.input !== undefined) {
    where.push('input = ?');
    params.push(f.input);
  }
  if (f.maxDenominator !== undefined) {
    where.push('max_denominator = ?');
    params.push(f.maxDenominator);
  }
  const sql =
    'SELECT * FROM calculations' +
    (where.length ? ' WHERE ' + where.join(' AND ') : '') +
    ' ORDER BY id DESC LIMIT ? OFFSET ?';
  return db.prepare(sql).all(...(params as any[]), limit, offset) as unknown as RecordRow[];
}
