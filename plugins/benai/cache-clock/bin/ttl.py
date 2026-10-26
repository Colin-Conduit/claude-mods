"""Prints 1h, 5m or unknown: the prompt-cache TTL this chat's main thread writes with."""
import glob, json, os, sys

sid = sys.argv[1] if len(sys.argv) > 1 else ''
paths = glob.glob(os.path.expanduser(f'~/.claude/projects/*/{sid}.jsonl')) if sid else []
if not paths:
    print('unknown'); sys.exit(0)
with open(paths[0], 'rb') as f:
    f.seek(0, 2)
    f.seek(max(0, f.tell() - 3_000_000))
    tail = f.read().decode('utf-8', 'ignore').splitlines()[1:]
answer = 'unknown'
for line in reversed(tail):
    try:
        j = json.loads(line)
    except Exception:
        continue
    if j.get('type') != 'assistant' or j.get('isSidechain'):
        continue
    cc = ((j.get('message') or {}).get('usage') or {}).get('cache_creation') or {}
    if (cc.get('ephemeral_1h_input_tokens') or 0) > 0:
        answer = '1h'; break
    if (cc.get('ephemeral_5m_input_tokens') or 0) > 0:
        answer = '5m'; break
print(answer)
