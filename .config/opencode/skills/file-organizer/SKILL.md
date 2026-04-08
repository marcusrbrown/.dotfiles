---
name: file-organizer
description: Use when files are scattered across directories, Downloads is cluttered, duplicates are wasting space, folder structure has grown chaotic, or a directory needs cleanup before archiving or migrating to a new machine.
---

# File Organizer

## Overview

Systematic file organization for macOS. Analyze → categorize → plan → confirm → execute → verify. Every destructive operation requires explicit user approval.

## When to Use

- Downloads folder overflowing with months/years of unsorted files
- Can't find files because they're scattered across directories
- Duplicate files wasting disk space
- Folder structure grown organically and no longer makes sense
- Preparing to archive old projects or migrate machines
- Setting up organization for a new directory

**When NOT to use:**
- Git repository internals (use git tools instead)
- Application data directories (`~/Library/`, `~/.config/` internals)
- Cloud-synced directories you don't own (shared team drives)

## Quick Reference

| Phase | Action | Key Rule |
|-------|--------|----------|
| **Scope** | Ask: which directory, what problem, what to avoid, how aggressive | Never assume — always confirm scope |
| **Analyze** | Survey file types, sizes, dates using safe read-only commands | Use macOS-safe commands from `commands-reference.md` |
| **Categorize** | Group by type, purpose, or date | Match user's mental model, not yours |
| **Plan** | Present tree diagram + change list + "needs decision" bucket | User must approve before any changes |
| **Execute** | `mkdir -p` then `mv` with logging | One category at a time; stop on conflicts |
| **Verify** | Show before/after summary + maintenance tips | Confirm nothing was lost |

## Safety Rules (NON-NEGOTIABLE)

1. **Always confirm** before any `mv`, `rm`, or rename operation
2. **Never delete without asking** — prefer archiving over deletion
3. **Exclude dangerous paths**: `.git/`, `.dotfiles/`, `node_modules/`, bare repo metadata
4. **Use `-x` flag** on `find`/`du` to stay within filesystem boundaries (prevents scanning mounted volumes, Time Machine, network shares)
5. **Quote all paths** — spaces, special chars, and option-like names break unquoted commands
6. **Warn about iCloud** — `file`, `md5`, and `cat` can trigger downloads of cloud-only files
7. **Preserve timestamps** — use `mv` (preserves by default) or `cp -p` when copying
8. **Log all moves** — maintain a record so operations can be reversed
9. **Handle dotfiles explicitly** — `du *` and `ls *` skip hidden files; `find` includes them. Be consistent.
10. **Never touch bare git repos** — `~/.dotfiles` and similar `GIT_DIR` setups look like junk but are critical infrastructure

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Using `find -printf` on macOS | BSD find has no `-printf`. Use `stat -f` or `-exec basename`. See `commands-reference.md` |
| Scanning without `-x` flag | Accidentally includes mounted volumes, Time Machine, iCloud. Always use `find -x` |
| `md5` pipeline for dedup | `md5 file` output includes path — `sort \| uniq -d` won't match. Use `md5 -r` and `awk` |
| Deleting "duplicates" that are hardlinks | Check with `stat -f '%i'` (inode) before removing |
| Running `du -sh *` for size survey | Misses dotfiles/hidden directories. Use `du -shx .[!.]* *` or explicit `find` |
| Organizing inside `~/Library/` | Application data — reorganizing breaks apps |
| Moving iCloud Drive files without warning | Triggers re-sync; can delete across devices if not careful |

## Reference Files

- `commands-reference.md` — macOS-safe commands for analysis, duplicate detection, and organization with proper quoting and filesystem boundaries
