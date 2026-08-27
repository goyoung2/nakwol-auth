PRAGMA foreign_keys = ON;

ALTER TABLE game_equipment_traits ADD COLUMN native_id INTEGER;
ALTER TABLE game_equipment_traits ADD COLUMN kind TEXT CHECK(kind IN ('skill','effect'));
ALTER TABLE game_equipment_traits ADD COLUMN evidence_state TEXT NOT NULL DEFAULT 'unresolved' CHECK(evidence_state IN ('canonical','observed','unresolved'));

CREATE UNIQUE INDEX idx_game_equipment_traits_native_kind
ON game_equipment_traits(kind, native_id)
WHERE kind IS NOT NULL AND native_id IS NOT NULL;

CREATE TABLE game_equipment_trait_applicability (
  trait_id TEXT NOT NULL,
  equipment_type TEXT NOT NULL CHECK(equipment_type IN ('weapon','mount')),
  evidence_state TEXT NOT NULL CHECK(evidence_state IN ('canonical','observed','unresolved')),
  source_locator TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY(trait_id, equipment_type),
  FOREIGN KEY(trait_id) REFERENCES game_equipment_traits(id) ON DELETE CASCADE
);
CREATE INDEX idx_game_equipment_trait_applicability_type
ON game_equipment_trait_applicability(equipment_type, evidence_state);

UPDATE data_schema_meta SET value = '3' WHERE key = 'schema_version';
