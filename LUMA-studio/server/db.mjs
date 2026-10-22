// SQLite persistence for the studio. Uses Node's built-in `node:sqlite` module,
// so there is nothing to compile or install. Migrations run in order on open.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export const MIGRATIONS = [
  {
    version: 1,
    name: 'initial schema',
    sql: `
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        model_name TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE renders (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        view_id TEXT NOT NULL,
        label TEXT NOT NULL,
        preset TEXT NOT NULL,
        preset_label TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        engine TEXT NOT NULL,
        engine_label TEXT NOT NULL,
        quality TEXT,
        samples INTEGER NOT NULL DEFAULT 0,
        model_name TEXT,
        filename TEXT NOT NULL,
        file_path TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        settings TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX renders_project_created ON renders(project_id, created_at DESC);
      CREATE TABLE looks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        base_preset TEXT NOT NULL,
        settings TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE camera_views (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        camera TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX camera_views_project ON camera_views(project_id, created_at);
    `,
  },
];

export function openDatabase(file) {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

export function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);');
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map(row => row.version));
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(migration.version, migration.name, new Date().toISOString());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  return db;
}
