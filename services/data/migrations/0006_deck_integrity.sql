PRAGMA foreign_keys = ON;

CREATE UNIQUE INDEX IF NOT EXISTS idx_deck_general_unique_general
ON deck_general_slots(deck_id, general_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_deck_general_unique_weapon
ON deck_general_slots(deck_id, weapon_instance_id)
WHERE weapon_instance_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_deck_general_unique_mount
ON deck_general_slots(deck_id, mount_instance_id)
WHERE mount_instance_id IS NOT NULL;
