# claude-mods

This is Colin's Claude Code mods marketplace. It is named `conduit-mods`.
It holds eight mods from Ben AI's benai-mods set, and a place for Conduit's own.
See `plugins/benai/SOURCE.md` for where they came from and what we changed.

## The mods

- cache-clock (`/cacheclock`, `/keepwarm`): counts down until the chat's prompt cache goes cold.
- chat-inventory (`/inventory`): a side pane listing the to-do list, connectors, files and skills this chat used.
- handoff (`/refresh`, `/handoff`): writes a handoff of a long chat and starts a new chat with it.
- helper-desk (`/helpers`): a task progress bar above the prompt and a card per subagent.
- mods (`/mods`): a pane that turns each mod on or off in every chat.
- reflect (`/reflect`): offers to save your corrections as lasting rules.
- replay-theater (`/replay`): steps through the file edits Claude made in the last turn.
- screen-share (`/screen-share`): hides emails, phone numbers, amounts and names on screen.

## Folder rules

- `plugins/benai/` stays as we received it. The only changes are listed in `SOURCE.md`.
- To change a benai mod, copy it into `plugins/conduit/` under a new name and edit the copy.
- New mods go in `plugins/conduit/`. Each one gets an entry in `.claude-plugin/marketplace.json`.

## Install

You need Claude Code 2.1.287 or later in the terminal, or 2.1.286 or later in the desktop Code tab.

Add the marketplace:

```
/plugin marketplace add Colin-Conduit/claude-mods
```

Install the mods you want:

```
/plugin install cache-clock@conduit-mods
/plugin install chat-inventory@conduit-mods
/plugin install handoff@conduit-mods
/plugin install helper-desk@conduit-mods
/plugin install mods@conduit-mods
/plugin install reflect@conduit-mods
/plugin install replay-theater@conduit-mods
/plugin install screen-share@conduit-mods
```

Then load them:

```
/reload-plugins
```

## Updating

1. Bump the version in the mod's `.claude-plugin/plugin.json` and in `.claude-plugin/marketplace.json`.
2. Push.
3. In Claude Code, run `/plugin marketplace update conduit-mods`.

## Notes

- The mods work on Mac and Windows. Linux should work too, but we have not tried it.
- Nothing extra to install. cache-clock no longer needs `python3`.
- On Windows, handoff's Copy button can fall back to PowerShell, which comes with Windows. cache-clock also uses PowerShell to read a chat log bigger than 4 MB.
- handoff's Start new chat opens a `claude://` link, so the Claude desktop app must be installed on that computer.
- On Linux, Open uses `xdg-open`, and Copy falls back to `wl-copy` or `xclip`.
- helper-desk adds an instruction to every chat to use its plan tool instead of the built-in to-do list.
- reflect writes to `~/.claude/CLAUDE.md`, or your rules folder, only when you press Save.
- cache-clock's handoff button needs handoff installed.
- chat-inventory's to-do list reads helper-desk's plan.
