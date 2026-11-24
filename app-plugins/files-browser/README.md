# Files browser

Files browser adds the side panel's Files tab, file previews, search and the
file actions in Chat. It is bundled and adopted once on upgrade. Disable or
remove it in Settings → Plugins; saved actions stay on disk. Chat images,
attachments, media and HTML browser links continue using Orc's shared services.

Use **Configure file actions** in the Files toolbar, or Settings → Plugins →
Files browser. Neovim is the initial action. Quick-add Neovim, Cursor, VS Code
or TextEdit, rename actions, select the default, or remove all of them. Click
**Save actions** to apply changes. Preset applications must be installed on
the computer that owns the run. GUI presets use macOS `open -a`; Neovim uses
`nvim` from the terminal's PATH.

Custom scripts run in a terminal tab, with the checkout as their working
directory. `<filepath>` inserts the selected file's full path; `<filename>`
inserts its basename including the extension; `<fileext>` inserts the extension
without its dot (`gz` for `notes.tar.gz`), or nothing for a file with no
extension, a dotfile such as `.gitignore`, or a folder. Without a selected file,
the path and name refer to the checkout directory. For example:

```sh
~/bin/review-file <filepath> <filename>
```

Tokens accept unquoted, single-quoted and double-quoted forms. Their values
are passed through environment variables rather than interpolated as shell
source. The variables `ORC_FILEPATH`, `ORC_FILENAME` and `ORC_FILEEXT` are also
available to the script. Script output and errors appear in its terminal tab. Paths must
resolve inside the run's checkout, including symlink targets. Configuration
writes are restricted to the local settings UI and preserve other config.

Settings are stored in `ui.filesBrowser` in `~/.orc/config.json`:

```json
{
  "actions": [
    { "id": "neovim", "name": "Neovim", "type": "neovim" },
    { "id": "review", "name": "Review file", "type": "custom", "command": "~/bin/review-file <filepath>" }
  ],
  "defaultAction": "neovim"
}
```

`icon.png` is rasterized from the authored `icon.svg`, using Orc's theme tokens.
