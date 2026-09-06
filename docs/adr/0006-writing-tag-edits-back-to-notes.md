# 6. Writing tag edits back to notes

## Status

Accepted. Amends the read-only consequence recorded in [ADR 0001](0001-flat-tags-with-a-relation-graph.md).

## Context

Until this decision the plugin only ever read the vault. ADR 0001 stated as a consequence that relations "never touch note content", and the README promised the plugin "never modifies your vault". That was true and worth keeping while the plugin was purely a lens over existing tags.

It stopped being sufficient once the plugin became the place you actually think about tags. Flat tags (ADR 0001) only work if tags are cheap to fix: a flat vocabulary with no hierarchy accumulates near-duplicates (`#health`, `#Health`, `#healthy`) and mis-named tags faster than a nested one, because there is no tree structure pushing you toward a canonical name. Spotting `#projekt` next to `#project` in the cloud and then having to leave for the Tags pane — or worse, hand-edit thirty notes — makes the tool that surfaced the problem useless for solving it.

Two capabilities were requested: renaming a tag, and assigning existing-or-new tags to notes. Both write to notes. That crosses a real line, and the question was not only whether to cross it but how to do so without the plugin becoming dangerous. Bulk tag edits are exactly the operation where a bug is expensive: Obsidian's undo is per-file and editor-scoped, so a bad rewrite across two hundred notes is not undoable from inside the app.

Three risks needed answers:

1. **Wrong writes.** Naive approaches (regex over raw file text) corrupt code blocks, URL fragments, and Markdown headings that merely look like tags.
2. **Unintended blast radius.** "Rename `#a`" reads as a small action but can rewrite hundreds of files, including nested children the user forgot existed.
3. **Silent damage.** A write that half-succeeds, or that reshapes YAML the user hand-wrote, is worse than a refusal.

## Decision

The plugin now writes to notes, through a dedicated `TagEditor` (`src/edit.ts`) that is the only component allowed to do so. Three operations are supported — rename a tag, assign a tag to notes, remove a tag from notes — and every one of them is **planned before it is applied**.

**Plans are derived from the metadata cache**, with no file reads, so the UI can state the exact blast radius (which notes, how many occurrences, split between body and frontmatter) before anything is written. Every destructive-looking action shows that plan first: the rename dialog recomputes it live as you type, and bulk assign/remove route through a confirmation listing the affected notes.

**Writes use Obsidian's structural APIs rather than text munging.** Note bodies go through `vault.process` (atomic read-modify-write) using the tag offsets Obsidian's own parser recorded, which is what keeps code blocks, `https://…#fragment` URLs and `# Heading` lines from being mistaken for tags — the parser already decided what is a tag, and the plugin only touches those spans. Frontmatter goes through `fileManager.processFrontMatter`, so YAML is re-serialised by Obsidian rather than patched by hand. This raises `minAppVersion` to 1.4.4, where `processFrontMatter` became available.

**Cached offsets are verified before use.** Each recorded span is compared against the live text and skipped if it no longer holds that exact tag, so a stale cache costs a missed rename rather than a corrupted note. Body edits are applied back-to-front so earlier offsets stay valid when a replacement changes length.

**Frontmatter shape is preserved.** A list stays a list, a comma-separated string stays a string, and an entry written without a leading `#` keeps that form. Keys that contain no matching tag are never rewritten at all.

The feature is exposed through several deliberately different surfaces, because renaming during exploration and renaming as a cleanup chore are different activities: inline rename in the cloud and tree (behind an edit-mode toggle), a rename dialog with live preview, context-menu entries in all three views, an "Edit tags" group in the details panel, bulk add/remove acting on exactly the notes frozen in the notes panel, and command-palette commands for the active note.

## Consequences

- The plugin can no longer be described as read-only, and the README no longer claims it. Anyone auditing it for safety must now review `src/edit.ts`, which is deliberately the single place any write can originate.
- Users need a backup or version control before bulk edits. The confirmation modal says so explicitly rather than leaving it implicit, because Obsidian's undo genuinely will not save them.
- Renaming a tag has to update the plugin's own manual connections (ADR 0002), or a rename would silently orphan them. Renames also collapse duplicate manual links and drop any link that a rename turned into a self-link.
- Relying on Obsidian's parser for tag positions means the plugin inherits its definition of a tag exactly — a benefit for correctness, but it also means the plugin cannot edit anything the parser does not report, such as a tag inside a code block. That is the right default and not worth an escape hatch.
- Assigning a tag defaults to frontmatter rather than the note body. Frontmatter is structurally editable, so it is the safer target; appending to the body is offered but is a text append and cannot be as precise.
- The `planFor` walk is O(notes × tags) over the cache on every keystroke in the rename dialog. That is acceptable at the vault sizes this plugin targets and keeps the preview honest, but it is the first thing to revisit if the dialog feels slow on a very large vault.
