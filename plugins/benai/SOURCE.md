# Where the benai mods came from

The eight mods in this folder came from a "benai-mods" zip that Colin dropped in Slack on 2026-10-26.
Each plugin.json names the author as Ben AI (https://www.benai.co).
Replay Theater is the exception: it is Anthropic's sample mod, with one change by Ben AI.

## What we kept

cache-clock, chat-inventory, handoff, helper-desk, mods, reflect, replay-theater, screen-share.

We left out brain-dump.

## Conduit changes

- handoff 0.1.1: removed the Claude Pet hand-off. Start new chat always opens the app link (claude://code/new?q=...). The test now checks that link instead of the pet request file.
- mods 0.3.1: removed brain-dump from the known list. That list always shows in the /mods pane, so brain-dump would have shown even though it is not installed. The test now uses reflect and a six-row table.
- Mac and Windows (2026-10-26). Every mod now finds the home folder on either kind of slash, and each one has a small `hooks/platform` file for what differs by system. The engine's `$.fs.write` makes missing folders, so the `mkdir -p` calls are gone. Deleting a file uses `rm -f` on Mac and Linux and `del` on Windows.
  - cache-clock 0.3.1: reads the cache length in TypeScript (`hooks/ttl.ts`) instead of `bin/ttl.py`, so it needs no `python3`. The `bin/` folder is gone, because claude.ai skips a plugin that ships one. A chat log over 4 MB is read with `tail` on Mac and Linux, or PowerShell on Windows.
  - chat-inventory 0.2.1: skill files, temp files and file names are matched on either slash, and the Windows temp folder is left out.
  - handoff 0.1.2: Copy uses the engine's clipboard first, then `pbcopy` on Mac, PowerShell on Windows, or `wl-copy` or `xclip` on Linux. The hint names Ctrl+V on Windows and Linux. Open and Start new chat use `open` on Mac, the Windows link handler (`rundll32 url.dll`) on Windows, and `xdg-open` on Linux. Windows file paths now count as files used.
  - helper-desk 0.4.1: file names and folders on the cards split on either slash.
  - mods 0.3.2: `CLAUDE_CODE_PLUGIN_DIRS` is split on `;` on Windows. The description says "this computer" instead of "this Mac".
  - reflect 0.1.1: Open uses the right opener for the system, and a typed rules folder like `C:\Users\you\rules` is accepted.
  - replay-theater 0.1.1: a Windows path shows relative to the working folder. Its first tests are in `hooks/replay-theater.test.ts`.
  - screen-share 0.2.1: home folder only.
- helper-desk 0.4.2 (2026-10-28): where an organization manages Claude Code (managed settings on the computer, or a Team or Enterprise plan), the built-in `cc-plugin-sec-default` plugin runs first and sends `prompt.compose` on past every plugin a person installs. So the plan section never reached the model, and Claude Code said "its prompt.compose hook was skipped". When a main-chat turn ends without that hook running, the same guidance now goes beside each prompt instead, without the "no TodoWrite" line. TodoWrite lists still feed the bar, as before. Tests cover both cases.
- Each changed file starts with a one-line "Conduit change" comment.

Everything else is as received.

## License

No license file came with the benai mods, except replay-theater.
Replay Theater is Apache License 2.0, Anthropic's sample from anthropics/claude-code-playground. Its LICENSE file is in its folder.
Keep this repo private and do not redistribute the benai mods.
