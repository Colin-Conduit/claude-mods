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
- Each changed file starts with a one-line "Conduit change" comment.

Everything else is as received.

## License

No license file came with the benai mods, except replay-theater.
Replay Theater is Apache License 2.0, Anthropic's sample from anthropics/claude-code-playground. Its LICENSE file is in its folder.
Keep this repo private and do not redistribute the benai mods.
