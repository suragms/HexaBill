# Finding missing migrations / schema drift in production

Errors like **42P01** (relation does not exist) or **42703** (undefined column) mean the production database is missing tables or columns that the app expects.

## 1. Use the schema-check endpoint (recommended)

**As SystemAdmin**, call:

```http
GET /api/schema-check
Authorization: Bearer <system-admin-jwt>
```

Response example when something is missing:

```json
{
  "success": true,
  "expectedTableCount": 42,
  "existingTableCount": 41,
  "missingTables": ["DamageCategories"],
  "missingColumns": [{ "table": "ErrorLogs", "column": "ResolvedAt" }],
  "message": "Fix by running migrations (POST /api/migrate) or adding CREATE TABLE/ALTER in Program.cs startup."
}
```

- **missingTables** – tables the app expects (from `AppDbContext`) that are not in the DB. Add `CREATE TABLE IF NOT EXISTS` in `Program.cs` (PostgreSQL startup block) or run the missing migration.
- **missingColumns** – important columns we’ve seen missing in production. Add `ALTER TABLE "TableName" ADD COLUMN IF NOT EXISTS "ColumnName" ...` in `Program.cs` or run the migration.

When nothing is missing:

```json
{
  "success": true,
  "missingTables": [],
  "missingColumns": [],
  "message": "Schema matches EF model (no missing tables or critical columns)."
}
```

## 2. When you add a new entity/table

Update the **expected tables** list in `DiagnosticsController.SchemaCheck()` so the schema-check still catches a missing table in production. The list is the array of table names at the start of that method; add your new table name there (same casing as in migrations).

If you add a column that’s critical and has caused production issues, add a `(TableName, ColumnName)` pair to the **criticalColumns** array in the same method so it appears in `missingColumns`.

## 3. Fixing drift

- **Option A – Migrations:** Run pending migrations in production (e.g. `POST /api/migrate` as SystemAdmin, or your deployment pipeline running `dotnet ef database update`).
- **Option B – Startup SQL:** For optional or backward-compatible objects, add `CREATE TABLE IF NOT EXISTS` or `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` in the PostgreSQL block in `Program.cs` so they are created on next app startup.

After applying a fix, call `GET /api/schema-check` again to confirm `missingTables` and `missingColumns` are empty.

## 4. ErrorLogs "errorMissingColumn" / 42703 (ResolvedAt)

If you see `FROM "ErrorLogs" AS e`, `Routine: errorMissingColumn`, or `Severity: ERROR` when loading error logs or the Super Admin alert summary, the production DB is missing the `ResolvedAt` column. Run **Scripts/RUN_ON_RENDER_PSQL.sql** (at least the first two lines: `ALTER TABLE "ErrorLogs" ADD COLUMN IF NOT EXISTS "ResolvedAt" ...` and the index) in your production PostgreSQL (e.g. Render PSQL), then restart the API. The app will return empty error-log data until the column exists but will not 500.
