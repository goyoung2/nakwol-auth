# NAKWOL Connect v0.3 release verification notes

Implementation is staged on `feature/nakwol-connect-v0.3-data-auto` for bundled PR verification. The release preserves the approved trust boundary: existing Connect device authorization proves app management through AUTH; DATA owns only DATA application capability rows; browser runtime uses app access tokens, never CLI tokens.

Pre-PR local checks: CLI/config/integration/orchestration subset 9/9 pass; Connect runtime JavaScript syntax check passes. Full repository and DATA verification is delegated to the two existing PR workflows in one bundled review cycle.
