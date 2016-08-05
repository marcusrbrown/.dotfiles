#!bash
#
# Rust setup.

[ -d "$HOME/.cargo/bin" ] && export PATH="$PATH:$HOME/.cargo/bin"

# For Racer.
[ -d "$HOME/git/rust-lang/rust/src" ] && export RUST_SRC_PATH="$HOME/git/rust-lang/rust/src"