# File Organizer — Commands Reference

Commands are organized by task. Where macOS (BSD) and Linux (GNU) differ, both variants are shown. All paths are quoted. Filesystem boundaries are respected.

**Platform detection:** Run `uname -s` to determine the platform. If a required tool is missing (e.g., `md5` on Linux, `md5sum` on macOS), stop and explain rather than guessing.

| Tool | macOS (BSD) | Linux (GNU) |
|------|-------------|-------------|
| File hash | `md5 -r` | `md5sum` |
| Stat size+name | `stat -f '%z %N'` | `stat -c '%s %n'` |
| Stat mod date | `stat -f '%Sm' -t '%Y-%m-%d'` | `stat -c '%y' \| cut -d' ' -f1` |
| Find stay on device | `find -x` | `find -xdev` |
| iCloud dataless | `find -flags dataless` | N/A |

## Analysis Commands

### Directory overview
```bash
ls -la -- "$TARGET"
```

### File type breakdown (handles dotfiles and no-extension files)
```bash
# Portable (macOS + Linux)
find "$TARGET" -xdev -type f | awk -F. '{print ($NF == $0) ? "(no ext)" : tolower($NF)}' | sort | uniq -c | sort -rn
```
Note: Use `find -x` on macOS or `find -xdev` on Linux. The `-xdev` form shown here works on both GNU and modern BSD find.

### Largest items (includes hidden files)
```bash
du -shx "$TARGET"/.[!.]* "$TARGET"/* 2>/dev/null | sort -rh | head -20
```

### Files by modification date
```bash
# macOS
find -x "$TARGET" -type f -exec stat -f '%Sm %N' -t '%Y-%m-%d' {} + | sort -r | head -30

# Linux
find "$TARGET" -xdev -type f -exec stat -c '%y %n' {} + | cut -d' ' -f1,4- | sort -r | head -30
```

### Recently modified (last 7 days)
```bash
# Portable
find "$TARGET" -xdev -type f -mtime -7
```

### Total size
```bash
du -shx "$TARGET"
```

## Duplicate Detection

### By content hash
```bash
# macOS — md5 -r outputs "hash filename"
find -x "$TARGET" -type f -exec md5 -r {} + \
  | sort \
  | awk '
    {hash=$1; $1=""; file=substr($0,2)}
    prev==hash {
      if (!printed) { print prevfile }
      print file
      printed=1
    }
    prev!=hash {
      printed=0
    }
    {prev=hash; prevfile=file}
  '

# Linux — md5sum outputs "hash  filename"
find "$TARGET" -xdev -type f -exec md5sum {} + \
  | sort \
  | awk '
    {hash=$1; $1=""; file=substr($0,3)}
    prev==hash {
      if (!printed) { print prevfile }
      print file
      printed=1
    }
    prev!=hash {
      printed=0
    }
    {prev=hash; prevfile=file}
  '
```

### By filename only
```bash
# Portable
find "$TARGET" -xdev -type f -exec basename {} \; | sort | uniq -d
```

### By size (find same-size files, then hash to confirm)
```bash
# macOS
find -x "$TARGET" -type f -exec stat -f '%z %N' {} + \
  | sort -n \
  | awk 'prev==$1 {if(!p){print prevline} print; p=1} {prev=$1; prevline=$0; p=0}'

# Linux
find "$TARGET" -xdev -type f -exec stat -c '%s %n' {} + \
  | sort -n \
  | awk 'prev==$1 {if(!p){print prevline} print; p=1} {prev=$1; prevline=$0; p=0}'
```

### Check if files are hardlinks (same inode)
```bash
# macOS
stat -f '%i %N' "$FILE1" "$FILE2"

# Linux
stat -c '%i %n' "$FILE1" "$FILE2"
```

## Safe Paths — Exclusions

### Prune dangerous directories from find
```bash
# Portable (use -x instead of -xdev on macOS)
find "$TARGET" -xdev \
  -path '*/.git' -prune -o \
  -path '*/.dotfiles' -prune -o \
  -path '*/node_modules' -prune -o \
  -path '*/.Trash' -prune -o \
  -name '.DS_Store' -prune -o \
  -type f -print
```

### Check for iCloud-backed files (macOS only)
```bash
# Files evicted to iCloud are "dataless" stubs — reading them triggers download
find -x "$TARGET" -type f -flags dataless
```
This check is macOS-only. On Linux, skip this step.

## Organization Commands

### Create structure and move with logging
```bash
# Create target directories
mkdir -p "$DEST"/{Work/{Documents,Screenshots},Personal,Installers,Archive,ToSort}

# Move with logging (append to log for undo capability)
LOG="$TARGET/.file-organizer-moves.log"
mv -nv "$SRC" "$DEST" 2>&1 | tee -a "$LOG"
```

### Rename with date prefix
```bash
# macOS
DATE=$(stat -f '%Sm' -t '%Y-%m-%d' -- "$FILE")
mv -n -- "$FILE" "$(dirname "$FILE")/${DATE}-$(basename "$FILE")"

# Linux
DATE=$(stat -c '%y' -- "$FILE" | cut -d' ' -f1)
mv -n -- "$FILE" "$(dirname "$FILE")/${DATE}-$(basename "$FILE")"
```

### Bulk move by extension
```bash
# Portable
find "$TARGET" -xdev -maxdepth 1 -type f -iname '*.pdf' -exec mv -nv {} "$DEST/Documents/" \;
```

## Post-Organization

### Verify no files lost
```bash
# Portable
echo "Before: $(find "$TARGET" -xdev -type f | wc -l) files"
echo "After:  $(find "$TARGET" -xdev -type f | wc -l) files"
```

### Review move log for undo
```bash
cat "$TARGET/.file-organizer-moves.log"
```

### Remove empty directories left behind
```bash
# Portable
find "$TARGET" -xdev -type d -empty -delete
```
