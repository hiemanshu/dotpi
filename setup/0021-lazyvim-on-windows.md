# 0021 — LazyVim on this Windows machine

**Status:** done
**Date:** 2026-10-31

## Goal

A working LazyVim install at the path Neovim actually reads its config from, opening clean with plugins fetched, and able to build tree-sitter parsers locally.

## Context

Checked on this machine, not assumed:

- Neovim 0.12.6, installed by winget, binary at `C:\Program Files\Neovim\bin\nvim`. LazyVim needs 0.11 or newer, so no upgrade is needed.
- `nvim --headless -c 'lua print(vim.fn.stdpath("config"))'` reports `C:\Users\hiema\AppData\Local\nvim`, which is the Windows spelling of `~/.config/nvim`. There is no config there yet, and no `~/.config/nvim` either.
- `C:\Users\hiema\AppData\Local\nvim-data` already exists (shada, swap, nvim.log), so Neovim has been launched once.
- git 2.56.0, mise 2026.10.23, winget 1.29.380, ripgrep 15.2.0, fd 10.5.0 are all present.
- No C compiler and no make: `gcc`, `cl`, `zig`, `make` all missing. This is the only genuine gap for LazyVim's tree-sitter setup.
- A Nerd Font is already installed and in use — Hiemanshu confirmed this, so nothing to do there.

## Non-goals

- Versioning the config. Hiemanshu chose to drop `.git` and keep a plain local config; a dotfiles repo is a later conversation.
- Changing how Neovim itself is installed. It stays winget-managed so `winget upgrade` handles it.
- Curating plugins or writing custom keymaps before the stock starter has run once.

## Steps

1. `git clone https://github.com/LazyVim/starter C:\Users\hiema\AppData\Local\nvim` — done.
2. Remove `.git` from that directory so the config is plain files, per Hiemanshu's choice — done.
3. C compiler — **changed mid-flight**. The plan said zig; it was installed, then found not to work. LazyVim's gate (`nvim-data/lazy/LazyVim/lua/lazyvim/util/treesitter.lua:65`) accepts only `$CC`, `cc`, `cl`, `cl.exe` under Visual Studio, or `gcc`, so zig is invisible to it. Replaced with `winget install --id BrechtSanders.WinLibs.POSIX.UCRT -e` (gcc 16.2.0, the install LazyVim recommends on Windows), and zig was uninstalled.
4. Launch `nvim` and let lazy.nvim clone plugins — done, 34 plugins.
5. Install all 23 `ensure_installed` parsers from LazyVim's spec — done, 24 libraries in `nvim-data/site/parser`.
6. `ripgrep` and `fd` turned out to be missing from the real PATH (only pi's bundled copies existed), so `winget install BurntSushi.ripgrep.MSVC sharkdp.fd` added them.

## Files touched

- `C:\Users\hiema\AppData\Local\nvim\**` (new)
- `C:\Users\hiema\AppData\Local\nvim-data\**` (plugins, parsers, state)

## Verification

Run against a refreshed PATH (machine + user from the registry, which is what a new terminal gets):

- `:checkhealth lazyvim` → `rg`, `fd`, `git`, `curl` ✅; `C compiler` ✅; `tree-sitter (CLI)` ✅. Only `lazygit` and `fzf` warn, both optional.
- `vim.treesitter.start(0, "lua")` on a lua buffer returns ok, and `vim.treesitter.query.get("lua", "highlights")` is non-nil.
- 24 parser libraries in `nvim-data/site/parser` (`bash`, `c`, `python`, `typescript`, `tsx`, `yaml`, `markdown`, …).
- `nvim --headless -c 'qa'` exits 0 with no output.

## Risks

- `git clone`, `rm -r` and the three installs each hit the permission gate. All were authorised by Hiemanshu's choices here, but the gate prompts regardless.
- **PATH staleness is the live footgun.** Both winget installs changed the user PATH, so any terminal opened before them does not see `gcc`, `rg` or `fd`. Restart the terminal before launching `nvim`, or tree-sitter reports the compiler missing again.
- The config is unversioned by choice. If the machine dies, the config is gone; a dotfiles repo is the fix when it matters.
- Removing the `.git` folder means `:Lazy` updates still work (it manages its own repos under `nvim-data/lazy`), but the config itself has no upstream to pull from.

## Open questions

- `lazygit` and `fzf` left uninstalled deliberately — LazyVim only warns. `winget install JesseDuffield.lazygit` whenever the git UI is wanted.
- Versioning the config in a dotfiles repo is a later conversation.
