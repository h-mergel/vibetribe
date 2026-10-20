# VibeTribe – Marketplace listing

Texts for the Elgato Maker Console (organisation **h2k.dev**, price: free). Media: `pnpm plugin:pack` writes the thumbnail, the gallery images and the app icon to `dist/marketplace/`.

## Name

VibeTribe

## Short description

All your Claude Code sessions on one deck: who needs you, for how long – one press takes you there.

## Long description

Running several Claude Code sessions at once? VibeTribe shows each one on its own key: whether it waits for your approval, has a question, hit an error or is done – and for how long. One press opens the session in Claude Desktop; the inbox key cycles through everything that is waiting.

- Sessions from Windows, WSL, the Code tab in Claude Desktop and Remote Control sessions on other machines
- Calm until you are needed: only sessions that need you get a thick frame; a new request breathes briefly
- Your 5-hour limit and weekly limit with a pace marker, and extra usage against your monthly cap
- Every state in color, shape and word, so it works without color vision too
- Local: the plugin is its own hub on 127.0.0.1. No telemetry, no prompts leave your machine

**Setup:** after installing, click any VibeTribe key in the Stream Deck app and choose "Set up hooks". Nothing on your machine changes before that click.

**What VibeTribe reads and changes**

- Reads Claude Code's local session files and hook events (event names, times, tool names, working folder – never your prompts or code). From Claude Desktop it reads the list of pinned sessions and, from its session files, when you last opened a session.
- Reads your Claude Code login (OAuth token) to ask Anthropic for your usage limits and your list of remote sessions; it never stores the token. When the login has expired, it may run your own `claude` CLI (`claude -p /cost`, no model call) so Claude Code refreshes its login.
- On your click only: adds its hooks and a statusline passthrough to `~/.claude/settings.json` (with a backup) and writes its reporter plus a copy of Stream Deck's Node.js (about 90 MB) to `%USERPROFILE%\.vibetribe`. "Remove hooks" takes the hooks out again; delete that folder to remove the files too.
- Runs a small HTTP server on 127.0.0.1 only, protected by a token.
- Uses interfaces of Claude Code and Claude Desktop that are not documented; an update of either can break parts of VibeTribe until it is updated.

**Requirements:** Windows 10 or later, Stream Deck app 7.1 or later, a Stream Deck MK.2 (other models work, but are not designed for), Claude Code or Claude Desktop signed in. Sessions in WSL need Node.js 20 or later inside WSL.

VibeTribe is an independent open-source project (MIT) and is not affiliated with, endorsed or sponsored by Anthropic. Claude and Claude Code are trademarks of Anthropic.

## Links

- Website: https://github.com/h-mergel/vibetribe
- Support: https://github.com/h-mergel/vibetribe/issues

## Category

Developer Tools

## Platform

Windows only.

## Release notes 1.0.0.0

First Marketplace release: set up Claude Code's hooks from the key settings, sessions from WSL with one more click, your default WSL distribution instead of a fixed one.
