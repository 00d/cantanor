# Pathfinder 2e ORC Reference Map

This repository is organized as a Pathfinder 2e rules reference corpus for game-content ingestion and retrieval workflows.
The intended target is Pathfinder 2e Remastered/ORC-aligned usage, while preserving upstream source text as extracted.

## Scope of tracked files

- Total tracked files: `183`
- Primary rule corpus files: `extracted/**` (`123` files)
- Stable indexing/pointer files: `corpus/**` (`57` files)
- Project notes/docs: `README.md`, `archives_of_nethys_investigation.md`
- OS metadata: `.DS_Store`, `corpus/.DS_Store` (not rules content)

## How each file group references Pathfinder rules

- `README.md`
  - Top-level project identity (`TRPG with ORC ruleset`).

- `archives_of_nethys_investigation.md`
  - Research notes on external Pathfinder data acquisition and provenance/compliance caveats.
  - Used as process guidance, not as canonical rule data.

- `corpus/index.json`
  - Master manifest for all books.
  - Maps each book id to source PDF name, extracted directory, parsed directory, and extraction quality metrics.

- `corpus/books/<book-id>/README.md`
  - Small generated descriptor per book.
  - Confirms that each directory is a stable pointer layout.

- `corpus/books/<book-id>/book.json`
  - Per-book manifest with identifiers, source PDF, absolute source paths, and quality metrics.
  - Primary machine-readable pointer for a single book.

- `corpus/books/<book-id>/links/source.pdf`
  - Symlink to original PDF input.

- `corpus/books/<book-id>/links/parsed_pdf`
  - Symlink to parser output directory.

- `corpus/books/<book-id>/links/extracted`
  - Symlink to normalized extracted text used by downstream tooling.

- `extracted/<Book>/metadata.json`
  - Canonical extraction metadata for each book: source PDF, section/chapter boundaries, page ranges, extraction method, and coverage counts.
  - This file defines how text chunks map back to Pathfinder book structure.

- `extracted/<Book>/*.txt`
  - Extracted rule/adventure text segments by front matter, chapter, appendix, or full-content block.
  - These are the primary textual references used by retrieval and indexing.

- `extracted/Bestiary1/creatures.json`, `extracted/Bestiary2/creatures.json`
  - Structured creature-entry exports (A-Z companion to letter-split text files).
  - Used when downstream consumers need entity-level access instead of chapter text.

## Book coverage represented in this repo

- `Abomination_Vaults`
- `Advanced_Players_Guide`
- `Ancestry_Guide`
- `Bestiary1`
- `Bestiary2`
- `Core_Rulebook`
- `Dark_Archive`
- `Dungeon_Slimes_Pf2e`
- `Game_Mastery_Guide`
- `Guns_Amp_Gears`
- `RemasterPlayerCoreCharacterSheet`

## Remaster/ORC interpretation for this repo

- This repo should be treated as a Pathfinder rules reference corpus for ORC-oriented workflows.
- Some extracted source books are pre-remaster publications and may include historical OGL/trademark notices in the raw text.
- Preserve source provenance (`corpus/index.json`, per-book `book.json`, and `metadata.json`) so downstream publishing/compliance decisions can be made explicitly.
