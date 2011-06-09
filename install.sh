#!/bin/sh

cutstring="DO NOT EDIT BELOW THIS LINE"

install() # src, target
{
  src=$1
  dst=$2

  if [ -e $dst ]; then
    if [ ! -L $dst ]; then
      cutline=`grep -n -m1 "$cutstring" "$dst" | sed "s/:.*//"`
      if [[ -n $cutline ]]; then
        let "cutline = $cutline - 1"
        echo "Updating $dst"
        head -n $cutline "$dst" > update_tmp
        startline=`tail -r "$src" | grep -n -m1 "$cutstring" | sed "s/:.*//"`
        if [[ -n $startline ]]; then
          tail -n $startline "$src" >> update_tmp
        else
          cat "$src" >> update_tmp
        fi
        mv update_tmp "$dst"
      else
        # TODO: force
        # if force: warn about overwrite, overwrite
        # else
        # vvvvvv
        echo "WARNING: $dst exists but is not a symlink."
      fi
    fi
  else
    echo "Creating $dst"
    if [[ -n `grep "$cutstring" "$src"` ]]; then
      cp "$PWD/$src" "$dst"
    else
      ln -s "$PWD/$src" "$dst"
    fi
  fi
}

# make sure we're installing from the right directory
cd `dirname $0`

for name in *; do
  target="$HOME/.$name"

  if [[ ! `grep "^$name$" $PWD/do_not_install` ]]; then
    if [ -d $target -a ! -L $target ]; then
      for subname in $name/*; do
        subtarget=$HOME/.$subname
        # echo "install $subname $subtarget"
        install $subname $subtarget
      done
    else
      # test
      # echo "install $name $target"
      install $name $target
    fi
  fi
done
