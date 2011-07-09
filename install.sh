#!/bin/sh

#set -x

# make sure we're installing from the right directory
cd `dirname $0`

no_symlink=0
os=`uname -s`
case "$os" in
  MINGW* | CYGW*)
    mklink=`$PWD/testmklink.sh`
    if [ -z "$mklink" ]; then
      no_symlink=1
      echo "*** NOTE ***"
      echo "Couldn't find a program that creates real symbolic links."
      echo "All dotfiles installed by this script will replace their"
      echo "originals, with the originals backed up if backups don't"
      echo "already exist."
    fi
    ;;
esac

wpath() # posix
{
  # TODO: Use cygpath under Cygwin.
  cmd //c echo "$1" | sed 's/\//\\/g'
}

symlink() # target, link
{
  target=$1
  link=$2

  if [ $no_symlink -eq 0 ]; then
    if [ -n "$mklink" ]; then
      if [ -d "$target" ]; then
        $mklink //d "`wpath $link`" "`wpath $target`"
      else
        $mklink "`wpath $link`" "`wpath $target`"
      fi
    else
      ln -s "$target" "$link"
    fi
  else
    rm "$link"
    cp "$target" "$link"
  fi
}

issymlink() # link
{
  if [ $no_symlink -eq 0 ]; then
    if [ -n "$mklink" ]; then
      # The directory listing has the symlink's target following the link name, separated by a space.
      parent=`dirname "$1"`
      linkname=`basename "$1"`
      cmd //c dir //al "`wpath \"$parent\"`" | grep '<SYMLINK' | grep "$linkname " > /dev/null
    else
      test -L "$1"
    fi
  else
    return 1
  fi
}

backup_dir=".dotfile_backup"

backup() # original
{
  orig=$1
  bdir=$HOME/$backup_dir

  if [ ! -d "$bdir" ]; then
    mkdir "$bdir" || (echo "Couldn't create backup directory \"$bdir\""; exit 1)
    echo "Original dotfiles will be backed up to '$bdir/'."
  fi

  name=`basename "$orig"`
  bak=$bdir/$name
  if [ ! -f "$bak" ]; then
    echo "Backing up '$orig'"
    cp "$orig" "$bak"
    rm "$orig"
    return 0
  fi
  return 1
}

cutstring="DO NOT EDIT BELOW THIS LINE"

install() # src, target
{
  src=$1
  dst=$2

  if [ -e "$dst" ]; then
    if ! issymlink "$dst"; then
      cutline=`grep -n -m1 "$cutstring" "$dst" | sed "s/:.*//"`
      if [[ -n $cutline ]]; then
        let "cutline = $cutline - 1"
        echo "Updating '$dst'"
        head -n $cutline "$dst" > update_tmp
        startline=`tail -r "$src" | grep -n -m1 "$cutstring" | sed "s/:.*//"`
        if [[ -n $startline ]]; then
          tail -n $startline "$src" >> update_tmp
        else
          cat "$src" >> update_tmp
        fi
        mv update_tmp "$dst"
      else
        if backup "$dst"; then
          symlink "$PWD/$src" "$dst"
        fi
      fi
    fi
  else
    echo "Creating '$dst'"
    if [[ -n `grep "$cutstring" "$src"` ]]; then
      cp "$PWD/$src" "$dst"
    else
      symlink "$PWD/$src" "$dst"
    fi
  fi
}

for name in *; do
  target=$HOME/.$name

  if [[ ! `grep "^$name$" "$PWD/do_not_install"` ]]; then
    if [ -d "$target" ] && ! issymlink "$target"; then
      for subname in "$name/*"; do
        subtarget=$HOME/.$subname
        # echo "install '$subname' '$subtarget'"
        install "$subname" "$subtarget"
      done
    else
      # test
      # echo "install '$name' '$target'"
      install "$name" "$target"
    fi
  fi
done
