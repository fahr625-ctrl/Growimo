-- ============================================================================
-- K4-B  Migration: Tabelle "generated_images" (dauerhafte Originalbild-Referenzen)
-- ============================================================================
-- Status: DESIGN-FREEZE 2026-10-19 (verbindlich fuer Phase 2b, siehe
-- DESIGN-FREEZE-2026-10-19.md, Abschnitt 2). Kein Deploy, kein Prod-Schreibzugriff
-- in dieser Runde - die Migration wird in Phase 2b ZUERST gegen eine lokale
-- Postgres-16.15-KOPIE getestet (Muster db-bereinigung-2026-10-18/
-- wiederherstellungstest) und NIE ohne ausdrueckliche Owner-Freigabe gegen die
-- Produktions-DB gefahren.
--
-- Eigenschaften (verbindlich):
--  * REIN ADDITIV: keine bestehende Tabelle wird geaendert, keine Spalte
--    umbenannt/entfernt, keine Zeile migriert oder geloescht. Der Bestand hat
--    13 Tabellen und keine Bild-Tabelle (read-only belegt am 2026-10-19).
--  * IDEMPOTENT: mehrfaches Ausfuehren liefert dasselbe Ergebnis
--    (IF NOT EXISTS ueberall, Constraint wird vor dem Setzen gedroppt).
--  * KONSISTENT MIT DEM BESTEHENDEN MIGRATIONSPFAD:
--    src/db/init.ts splittet src/db/schema.ts am Semikolon und faehrt alle
--    Statements als EINE Transaktion (sql.transaction). Deshalb gilt:
--      >>> In Kommentaren und String-Literalen darf KEIN Semikolon stehen. <<<
--    (Vorlage 2026-10-19: dieser Kommentar enthielt selbst eines und zerbrach
--     das Splitting - geprueft und behoben, siehe DESIGN-FREEZE Abschnitt 2.)
--    Die Datei ist so formuliert, dass sie 1:1 in schemaSQL eingesetzt werden
--    kann. CREATE INDEX CONCURRENTLY ist wegen der einen Transaktion NICHT
--    zulaessig - hier bewusst nicht verwendet.
--  * KONSISTENT MIT DEM BESTAND: uuid-ossp / uuid_generate_v4(), users.id UUID,
--    projects.id UUID (wie users, projects, generated_content, subscriptions ...).
--
-- Spaltenlogik (Design-Freeze Abschnitt 2):
--  * id             UUID PK wie in allen Bestandstabellen.
--  * user_id        users.id (UUID) - ACHTUNG: NICHT die Clerk-ID. usage_monthly
--                   und usage_events speichern dagegen TEXT-Clerk-Ids. Die Route
--                   loest clerk_id ueber ensureUserRow() nach users.id auf.
--  * project_id     NULLABLE 1:n. ON DELETE SET NULL ist Owner-Entscheidung (b):
--                   eine Projekt-Loeschung darf NIE ein bezahltes Originalbild
--                   mitloeschen. Es gibt daher auch KEINEN Loeschgrund
--                   'project_cleanup' - Projekt-Loeschung loescht nie Bilder.
--  * blob_path      Pfad im privaten Store, eindeutig = 1 Zeile pro Blob.
--                   Macht Retries idempotent und laesst den Cap Originale
--                   zaehlen, nicht Verwendungen.
--  * blob_url       private Store-URL, nur serverseitig, niemals im Client.
--  * size_bytes     echte Groesse in Bytes - Basis des globalen Hobby-Guards
--                   (IMAGE_GLOBAL_BYTES_CAP) und der ehrlichen Kostenzahl.
--  * prompt         Anzeige-Text, App-seitig auf 400 Zeichen gekappt
--                   (Datensparsamkeit, siehe Rechtstexte-Entwurf).
--  * created_at     Quelle der Aufbewahrungsfrist.
--  * expires_at     created_at + IMAGE_TTL_DAYS (Default 90). BEWUSST OHNE
--                   DB-DEFAULT: der Wert kommt aus dem Parameter, damit es nur
--                   EINE Wahrheit gibt. Fehlt er, scheitert das INSERT laut,
--                   statt still nie zu loeschen (fail-closed).
--  * deleted_at     Loeschabsicht (Mark-and-sweep). Gesetzt = fuer jede Abfrage
--                   und die UI unsichtbar. Der Wiederanlauf-Sweeper loescht
--                   danach Blob + Zeile.
--  * delete_reason  Whitelist: cap_200, ttl_90d, account_deleted, manual.
-- ============================================================================

CREATE TABLE IF NOT EXISTS generated_images (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  blob_path TEXT NOT NULL,
  blob_url TEXT,
  aspect_ratio TEXT,
  mime_type TEXT,
  size_bytes BIGINT CHECK (size_bytes IS NULL OR size_bytes >= 0),
  prompt TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ,
  delete_reason TEXT
);

-- Ein Pfad gehoert genau einer Zeile.
CREATE UNIQUE INDEX IF NOT EXISTS idx_generated_images_blob_path
  ON generated_images(blob_path);

-- Cap/Liste: die lebenden Bilder eines Nutzers, neueste zuerst (Sliding Window).
CREATE INDEX IF NOT EXISTS idx_generated_images_user_live
  ON generated_images(user_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- Projektansicht: alle lebenden Bilder eines Projekts.
CREATE INDEX IF NOT EXISTS idx_generated_images_project_live
  ON generated_images(project_id)
  WHERE deleted_at IS NULL;

-- TTL-Sweeper: faellige, noch nicht markierte Bilder (taeglicher Cron).
CREATE INDEX IF NOT EXISTS idx_generated_images_expires_live
  ON generated_images(expires_at)
  WHERE deleted_at IS NULL;

-- Wiederanlauf-Sweeper: markierte Bilder, deren Blob-Delete noch aussteht.
-- Bewusst KEIN Index auf size_bytes: der Guard summiert ueber hoechstens rund
-- 500 Zeilen (volle Hobby-Auslastung), ein Sequenz-Scan ist billiger als ein
-- zusaetzlicher Index (Design-Freeze Abschnitt 2, Neu-Bewertung nach 1 Monat
-- Realdaten im Rahmen der 8.4-Kalibrierung).
CREATE INDEX IF NOT EXISTS idx_generated_images_deleted_pending
  ON generated_images(deleted_at)
  WHERE deleted_at IS NOT NULL;

-- KEINE Aenderung an bestehenden Tabellen.
-- KEINE Datenmigration, kein Backfill (es gibt heute keine serverseitigen
-- Bilddaten - die Produktions-DB hat 13 Tabellen und keine Bild-Tabelle,
-- read-only belegt am 2026-10-19).

-- ============================================================================
-- Referenz-Abfragen fuer Phase 2b (nicht Teil der Migration, nur zur Klarheit).
-- Parameter: :user_id (users.id), :max_images (IMAGE_MAX_PER_USER),
--            :ttl_days (IMAGE_TTL_DAYS), :cap_bytes (IMAGE_GLOBAL_BYTES_CAP).
-- HINWEIS: In diesem Kommentarblock steht absichtlich kein Semikolon - der
-- Splitting-Mechanismus von init.ts wuerde sonst mitten im Kommentar trennen.
--
-- 1) Guard-Pruefung (in derselben Transaktion wie das INSERT nachpruefen)
--   SELECT COALESCE(SUM(size_bytes), 0) FROM generated_images WHERE deleted_at IS NULL
--
-- 2) Ueberhang des Sliding Window (aeltestes zuerst, deterministisch)
--   SELECT id, blob_path FROM generated_images
--   WHERE user_id = :user_id AND deleted_at IS NULL
--   ORDER BY created_at ASC, id ASC
--   OFFSET :max_images
--
-- 3) Markieren (Schritt 1, EINE Transaktion, idempotent)
--   UPDATE generated_images SET deleted_at = NOW(), delete_reason = 'cap_200'
--   WHERE id = ANY(:ids) AND deleted_at IS NULL
--   RETURNING id, blob_path
--
-- 4) Faellige TTL-Bilder markieren (Cron, taeglich 03:00)
--   UPDATE generated_images SET deleted_at = NOW(), delete_reason = 'ttl_90d'
--   WHERE expires_at < NOW() AND deleted_at IS NULL
--   RETURNING id, blob_path
--
-- 5) Wiederanlauf-Sweeper (nach dem Blob-Delete)
--   DELETE FROM generated_images
--   WHERE id = ANY(:ids) AND deleted_at IS NOT NULL
-- ============================================================================

-- Whitelist des Loeschgrunds: verhindert freie Texte und haelt Logs inhaltsfrei.
-- Bewusst OHNE 'project_cleanup' (Projekt-Loeschung loescht nie Bilder).
ALTER TABLE generated_images DROP CONSTRAINT IF EXISTS generated_images_delete_reason_check;
ALTER TABLE generated_images ADD CONSTRAINT generated_images_delete_reason_check
  CHECK (delete_reason IS NULL OR delete_reason IN ('cap_200', 'ttl_90d', 'account_deleted', 'manual'));
