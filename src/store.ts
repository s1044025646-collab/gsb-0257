import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { ApproxResult } from "./approx.js";

export const INPUT_VERSION = "v1";

export interface StoredRecord {
  id: number;
  createdAt: string;
  inputVersion: string;
  rawInput: string;
  maxDenominator: string;
  snapshot: ApproxResult;
}

export class Store {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS approximations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        input_version TEXT NOT NULL,
        raw_input TEXT NOT NULL,
        max_denominator TEXT NOT NULL,
        snapshot TEXT NOT NULL
      );
    `);
  }

  save(rawInput: string, maxDenominator: bigint, snapshot: ApproxResult): number {
    const stmt = this.db.prepare(
      "INSERT INTO approximations (created_at, input_version, raw_input, max_denominator, snapshot) VALUES (?, ?, ?, ?, ?)"
    );
    const r = stmt.run(
      new Date().toISOString(),
      INPUT_VERSION,
      rawInput,
      maxDenominator.toString(),
      JSON.stringify(snapshot)
    );
    return Number(r.lastInsertRowid);
  }

  get(id: number): StoredRecord | null {
    const row = this.db.prepare("SELECT * FROM approximations WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.toRecord(row) : null;
  }

  list(limit = 50, offset = 0): StoredRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM approximations ORDER BY id DESC LIMIT ? OFFSET ?")
      .all(limit, offset) as Record<string, unknown>[];
    return rows.map((r) => this.toRecord(r));
  }

  private toRecord(row: Record<string, unknown>): StoredRecord {
    return {
      id: Number(row.id),
      createdAt: String(row.created_at),
      inputVersion: String(row.input_version),
      rawInput: String(row.raw_input),
      maxDenominator: String(row.max_denominator),
      snapshot: JSON.parse(String(row.snapshot)) as ApproxResult,
    };
  }

  close(): void {
    this.db.close();
  }
}

export function defaultDbPath(): string {
  return path.join(process.cwd(), "data", "approx.db");
}
