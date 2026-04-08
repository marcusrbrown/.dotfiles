---
name: file-organizer
description: Use when files are scattered across directories, Downloads is cluttered, duplicates are wasting space, folder structure has grown chaotic, or a directory needs cleanup before archiving or migrating to a new machine.
---

# File Organizer

## Overview

Systematic file organization for macOS and Linux. Analyze → categorize → plan → confirm → execute → verify. Every destructive operation requires explicit user approval.

**First step:** Detect the platform (`uname -s`) and use the matching command variants from `commands-reference.md`. If a required tool is missing, stop and explain — never guess.

## When to Use

- Downloads folder overflowing with months/years of unsorted files
- Can't find files because they're scattered across directories
- Duplicate files wasting disk space
- Folder structure grown organically and no longer makes sense
- Preparing to archive old projects or migrate machines
- Setting up organization for a new directory

**When NOT to use:**
- Git repository internals (use git tools instead)
- Application data directories (`~/Library/` on macOS, `~/.local/share/` on Linux)
- Cloud-synced directories you don't own (shared team drives)

## Quick Reference

| Phase | Action | Key Rule |
|-------|--------|----------|
| **Scope** | Ask: which directory, what problem, what to avoid, how aggressive | Never assume — always confirm scope |
| **Detect** | Run `uname -s` to determine macOS vs Linux | Use matching command variants from reference |
| **Analyze** | Survey file types, sizes, dates using safe read-only commands | See `commands-reference.md` for platform-specific commands |
| **Categorize** | Group by type, purpose, or date | Match user's mental model, not yours |
| **Plan** | Present tree diagram + change list + "needs decision" bucket | User must approve before any changes |
| **Execute** | `mkdir -p` then `mv` with logging | One category at a time; stop on conflicts |
| **Verify** | Show before/after summary + maintenance tips | Confirm nothing was lost |

## Safety Rules (NON-NEGOTIABLE)

1. **Always confirm** before any `mv`, `rm`, or rename operation
2. **Never delete without asking** — prefer archiving over deletion
3. **Exclude dangerous paths**: `.git/`, `.dotfiles/`, `node_modules/`, bare repo metadata
4. **Stay on the filesystem** — use `find -x` (macOS) or `find -xdev` (Linux) to prevent scanning mounted volumes, network shares, or backup trees
5. **Quote all paths** — spaces, special chars, and option-like names break unquoted commands
6. **Warn about cloud storage** — on macOS, `file`/`md5`/`cat` can trigger downloads of iCloud-evicted files. Check for dataless stubs first.
7. **Preserve timestamps** — use `mv` (preserves by default) or `cp -p` when copying
8. **Log all moves** — maintain a record so operations can be reversed
9. **Handle dotfiles explicitly** — `du *` and `ls *` skip hidden files; `find` includes them. Be consistent.
10. **Never touch bare git repos** — `~/.dotfiles` and similar `GIT_DIR` setups look like junk but are critical infrastructure

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Using GNU-only `find -printf` on macOS | BSD find has no `-printf`. Use `stat` or `-exec basename`. See `commands-reference.md` |
| Scanning without filesystem boundary flag | Accidentally includes mounted volumes and backups. Always use `-x` (macOS) or `-xdev` (Linux) |
| Wrong `md5`/`md5sum` pipeline for dedup | macOS uses `md5 -r`, Linux uses `md5sum`. Output format differs — see reference for correct `awk` pipeline |
| Deleting "duplicates" that are hardlinks | Check inodes first — see hardlink check in reference |
| Running `du -sh *` for size survey | Misses hidden directories. Use `du -shx .[!.]* *` or explicit `find` |
| Organizing inside app data dirs | `~/Library/` (macOS) and `~/.local/share/` (Linux) — reorganizing breaks apps |
| Moving cloud-synced files without warning | Triggers re-sync; can delete across devices if not careful |

## Reference Files

- `commands-reference.md` — platform-aware commands for analysis, duplicate detection, and organization. Shows macOS/Linux variants where they differ, portable commands where they don't.
