# File Organizer — macOS Commands Reference

All commands are BSD/macOS-safe. Paths are always quoted. Filesystem boundaries are respected.

## Analysis Commands

### Directory overview
```bash
ls -la -- "$TARGET"
```

### File type breakdown (handles dotfiles and no-extension files)
```bash
find -x "$TARGET" -type f | awk -F. '{print ($NF == $0) ? "(no ext)" : tolower($NF)}' | sort | uniq -c | sort -rn
```

### Largest items (includes hidden files)
```bash
du -shx "$TARGET"/.[!.]* "$TARGET"/* 2>/dev/null | sort -rh | head -20
```

### Files by modification date
```bash
find -x "$TARGET" -type f -exec stat -f '%Sm %N' -t '%Y-%m-%d' {} + | sort -r | head -30
```

### Recently modified (last 7 days)
```bash
find -x "$TARGET" -type f -mtime -7
```

### Total size
```bash
du -shx "$TARGET"
```

## Duplicate Detection

### By content hash (correct macOS pipeline)
```bash
# md5 -r outputs "hash filename" — group by hash, show groups with >1 file
find -x "$TARGET" -type f -exec md5 -r {} + | sort | awk '{hash=$1; $1=""; file=substr($0,2)} prev==hash {if(!printed){print prevfile} print file; printed=1} {prev=hash; prevfile=file; printed=0}'
```

### By filename only
```bash
find -x "$TARGET" -type f -exec basename {} \; | sort | uniq -d
```

### By size (find same-size files, then hash to confirm)
```bash
find -x "$TARGET" -type f -exec stat -f '%z %N' {} + | sort -n | awk 'prev==$1 {if(!p){print prevline} print; p=1} {prev=$1; prevline=$0; p=0}'
```

### Check if files are hardlinks (same inode)
```bash
stat -f '%i %N' "$FILE1" "$FILE2"
```

## Safe Paths — Exclusions

### Prune dangerous directories from find
```bash
find -x "$TARGET" \
  -path '*/.git' -prune -o \
  -path '*/.dotfiles' -prune -o \
  -path '*/node_modules' -prune -o \
  -path '*/.Trash' -prune -o \
  -name '.DS_Store' -prune -o \
  -type f -print
```

### Check for iCloud-backed files (evicted/cloud-only)
```bash
# Files with "com.apple.ubiquity.is-data-on-disk" xattr removed are cloud-only
# Simpler: check if file is a "dataless" stub
find -x "$TARGET" -type f -flags dataless
```

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
# Get file modification date for prefix
DATE=$(stat -f '%Sm' -t '%Y-%m-%d' -- "$FILE")
mv -n -- "$FILE" "$(dirname "$FILE")/${DATE}-$(basename "$FILE")"
```

### Bulk move by extension
```bash
# Move all PDFs to Documents (no clobber)
find -x "$TARGET" -maxdepth 1 -type f -iname '*.pdf' -exec mv -nv {} "$DEST/Documents/" \;
```

## Post-Organization

### Verify no files lost
```bash
# Compare file counts before/after
echo "Before: $(find -x "$TARGET" -type f | wc -l) files"
echo "After:  $(find -x "$TARGET" -type f | wc -l) files"
```

### Review move log for undo
```bash
cat "$TARGET/.file-organizer-moves.log"
```

### Remove empty directories left behind
```bash
find -x "$TARGET" -type d -empty -delete
```
