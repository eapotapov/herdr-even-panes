# even-panes

A mod for the [Herdr](https://herdr.dev) desktop app that keeps the panes
of a row or column equal.

Herdr's own split gives the new pane half of the pane it split, so three
splits to the right give 50 / 25 / 25. Closing a pane hands its share to the
neighbor on its left, so 33 / 33 / 33 becomes 67 / 33. This mod evens the
affected row or column out again.

## What it does

**Automatically.** Whenever a pane appears or disappears, in any tab, the
row or column that changed is evened out. Your normal keys keep working:
`cmd-d` and `cmd-shift-d` split, `cmd-shift-w` closes, a program exiting
closes its pane, and the result is equal panes every time. Dragging a divider
changes no pane set, so sizes you set by hand stay until the next split or
close in that row or column. Turn it off with `"props": { "auto": false }`
on the mod's block in the layout.

**On command.** Bind any of these in `~/.config/herdr-app/keys.json` as
`"even-panes.<command>"`:

| Command | Does |
| --- | --- |
| `equalize-tab` | even out every row and column of the focused tab |
| `equalize` | even out the focused pane's row or column only |
| `split-right` | split the focused pane to the right, then even out its row |
| `split-down` | split the focused pane downward, then even out its column |
| `close` | close the focused pane, then even out what is left |

The installer binds `cmd-shift-v` to `equalize-tab`. Set `EVEN_PANES_KEY`
or `EVEN_PANES_ACTION` before running it to choose another key or command.

## Install

```sh
./install.sh
```

The Herdr app must be running. The installer:

1. copies `mods/even-panes` into `~/.config/herdr-app/mods/`;
2. makes sure you are on a personal layout, because Herdr never adds mods to
   its shipped layouts: on `main` it clones it as `main-even` and switches
   to it (your theme and look carry over);
3. adds the mod to that layout as a floating block that draws nothing, so the
   app counts it as shown and delivers key commands to it;
4. binds the key, unless it is already taken;
5. runs `herdr-app check` on the mod.

Edits to `mods/even-panes/main.js` in the installed copy reload live. To
update from this repo, run `./install.sh` again.

## Uninstall

Delete `~/.config/herdr-app/mods/even-panes`, remove the `even-panes` entry
from the layout's `floating` list and the key from `keys.json`. To go back to
the shipped layout: `herdr-app do layout.switch --name main`.

## How it works

The app keeps spaces, tabs and splits in herdr-core's document for the app,
at `~/.local/state/herdr-core/default/docs.json`. The mod reads that file to
find rows and columns, and calls Herdr's `layout.resize` command on each
child with weight `1 / n`. Herdr re-renders every mod when live data
changes; when the set of panes differs from the last one seen, the mod waits
until the document lists exactly the panes on screen, compares each row and
column with the last tree it acted on, and evens out the ones whose children
changed.

## Limits

- Local machine only. Panes in spaces on other machines live in that
  machine's core document and are skipped.
- Assumes the default core session (`~/.local/state/herdr-core/default`).
- Evening out happens about a tenth of a second after the split or close,
  once the document has caught up.
