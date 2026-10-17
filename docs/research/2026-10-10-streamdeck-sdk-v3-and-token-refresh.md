# Stream Deck SDK v3 plugin basics and the cheapest OAuth token refresh for the Windows `claude` CLI

Date: 2026-10-10. Scope: read-only research. No repo code was changed. Scratch work lives outside the repo in `/tmp/sdk-probe` (WSL) and `%TEMP%`. No access or refresh token was printed or copied anywhere; only `expiresAt` and the file's `LastWriteTime` were read from `%USERPROFILE%\.claude\.credentials.json`.

Legend (same as `2026-10-10-technical.md`):
- **[V]** verified from a primary source, URL given (docs, npm package contents, schema).
- **[L]** verified locally on this machine (command output, file, process list). The command is named.
- **[I]** inferred or not tested. Treat as a design assumption to test.

Environment facts [L]: Windows 11 Pro 10.0.26200. Stream Deck app 7.6.0.23012 (from the `-info` argument of the running plugin processes). It bundles Node `20.20.0` and `24.13.1` in `%APPDATA%\Elgato\StreamDeck\NodeJS\`. Windows `claude` 2.1.287 at `C:\Users\Heinrich\.local\bin\claude.exe`. WSL Ubuntu: Node 24.19.0, pnpm 10.33.0, `networkingMode=mirrored` in `~/.wslconfig`. Devices known to the app: "Stream Deck" 5x3 (type 0), "Stream Deck Mobile" 3x2 (type 3), "MCP Deck" 8x4 (type 14). Type 14 is not in the `DeviceType` enum of `@elgato/schemas@0.5.2` (0..13, [V] package contents), so the app is newer than the SDK enum.

---

# Part 1. Stream Deck SDK v3

Package facts [V, `npm view @elgato/streamdeck`]: `latest` = **3.0.2** (published 2026-10-08; 3.0.0 on 2026-09-22), ESM only (`"type":"module"`), `engines.node >=20.5.1`, dependencies `ws`, `@elgato/schemas 0.5.2`, `@elgato/utils 0.6.1`. `@elgato/cli` `latest` = **1.10.2**, `engines.node >=20.1.0`.

## 1.1 Minimal plugin structure

### Folder layout

[V] https://docs.elgato.com/streamdeck/sdk/introduction/getting-started and the CLI template (`@elgato/cli@1.10.2` tarball, `template/`):

```
vibetribe/                          (project root, repo package)
  package.json  rollup.config.mjs  tsconfig.json
  src/plugin.ts                     entry point (template: src/plugin.ts, actions in src/actions/*.ts)
  dev.h2k.vibetribe.sdPlugin/  <- directory name MUST be "<manifest UUID>.sdPlugin"
    manifest.json
    bin/plugin.js                   (rollup output) + bin/package.json {"type":"module"}
    imgs/...                        (icons, key images)
    ui/...                          (optional property inspector HTML)
    logs/                           (created by the SDK logger at runtime)
```

[V] `streamdeck link` refuses names that do not end in `.sdPlugin` and requires reverse-DNS lowercase `[a-z0-9.-]` (checked in `bin/streamdeck.mjs` of the CLI package).

### manifest.json fields

[V] https://docs.elgato.com/streamdeck/sdk/references/manifest and the official JSON schema https://schemas.elgato.com/streamdeck/plugins/manifest.json (the schema branches on `Software.MinimumVersion`; I read the `7.6` branch):

| Field | Required | Notes |
|---|---|---|
| `UUID` | yes | reverse DNS, regex `^([a-z0-9-]+)(\.[a-z0-9-]+)+$`. Cannot change after Marketplace publication. |
| `Name`, `Author`, `Description`, `Version` | yes | `Version` format `{major}.{minor}.{patch}.{build}`, e.g. `0.1.0.0`. |
| `Icon` | yes | plugin icon (Marketplace). The CLI validator demands a **PNG** here (`Icon file not found ... File must be .png`) [L, `streamdeck validate`]. |
| `CodePath` | yes | relative path inside the plugin dir, e.g. `bin/plugin.js`. Pattern forbids leading `./`, `..`, `/` [V schema]. Optional `CodePathWin` / `CodePathMac`. |
| `SDKVersion` | yes | enum `[2, 3]`; "version 3 is recommended" [V]. |
| `Software.MinimumVersion` | yes | enum `"6.4"` ... `"7.6"`. The CLI template uses `"7.1"` with Node 24; the Getting Started page says Node 24 plugins need Stream Deck 7.1+ [V]. |
| `OS` | yes | 1..2 entries `{Platform: "windows"|"mac", MinimumVersion}`. |
| `Nodejs` | optional | `{Version: "20"|"24", Debug?: "enabled"|"break"|<custom args>, GenerateProfilerOutput?: bool}`. `Version` is required inside the object. |
| `Actions[]` | yes | per action required: `UUID`, `Name`, `Icon`, `States`. Optional: `Controllers`, `Tooltip`, `SupportedInMultiActions`, `UserTitleEnabled`, `DisableAutomaticStates`, `PropertyInspectorPath`, `VisibleInActionsList`, `OS`. |
| `Actions[].Controllers` | optional | 1..3 of `Keypad`, `Encoder`, `Neo`. Default Keypad. |
| `Actions[].States[]` | yes | each state requires `Image` (path **without extension**, PNG/SVG/GIF, 72 px and 144 px @2x). Optional `ShowTitle`, `Title`, `TitleAlignment`, `FontSize`, ... |
| `Category`, `CategoryIcon` | optional | group name and icon in the action list. |

Action `Icon`: 20x20 / 40x40, white on transparent [V manifest page].

I validated this manifest with the official validator, `node bin/streamdeck.mjs validate <dir>` from the `@elgato/cli@1.10.2` tarball, result `Validation successful` [L]. Image files must exist (SVG is accepted for action icon and state image; the plugin-level `Icon` must be PNG). Full file below.

```json
{
  "$schema": "https://schemas.elgato.com/streamdeck/plugins/manifest.json",
  "UUID": "dev.h2k.vibetribe",
  "Name": "VibeTribe",
  "Version": "0.1.0.0",
  "Author": "Heinrich",
  "Description": "Shows Claude Code session states on Stream Deck keys.",
  "Icon": "imgs/plugin/marketplace",
  "Category": "VibeTribe",
  "CategoryIcon": "imgs/plugin/category-icon",
  "CodePath": "bin/plugin.js",
  "SDKVersion": 3,
  "Nodejs": { "Version": "24", "Debug": "enabled" },
  "Software": { "MinimumVersion": "7.1" },
  "OS": [ { "Platform": "windows", "MinimumVersion": "10" } ],
  "Actions": [
    {
      "UUID": "dev.h2k.vibetribe.slot",
      "Name": "Session Slot",
      "Tooltip": "Shows the state of one Claude Code session.",
      "Icon": "imgs/actions/slot/icon",
      "Controllers": [ "Keypad" ],
      "SupportedInMultiActions": false,
      "UserTitleEnabled": false,
      "States": [ { "Image": "imgs/actions/slot/key", "ShowTitle": false } ]
    }
  ]
}
```

Remove `"Debug": "enabled"` for release builds (the template ships it enabled) [V template].

### Entry point and registration

[V] `registerAction` JSDoc in `@elgato/streamdeck@3.0.2` (`dist/plugin/actions/service.d.ts`) and https://docs.elgato.com/streamdeck/sdk/guides/actions: register all actions, then call `streamDeck.connect()` last. Template entry (`template/src/plugin.ts`):

```ts
import streamDeck from "@elgato/streamdeck";
import { IncrementCounter } from "./actions/increment-counter";
streamDeck.logger.setLevel("trace");
streamDeck.actions.registerAction(new IncrementCounter());
streamDeck.connect();
```

`registerAction` throws if `action.manifestId` is undefined or not present in the manifest's `Actions` [V `dist/plugin/actions/service.js`].

### Decorators: `@action` vs. no decorator

- **The template uses the `@action({ UUID })` decorator** [V `template/src/actions/increment-counter.ts.ejs`].
- It is a **TC39 / TypeScript 5 standard decorator**, not the legacy one: the declared signature is `(target, context: ClassDecoratorContext)` [V `dist/plugin/actions/decorators.d.ts`]. The template `tsconfig.json` extends `@tsconfig/node20` and does **not** set `experimentalDecorators` [V template].
- **Setting `experimentalDecorators: true` breaks the build** [L]: `tsc --experimentalDecorators` gives `TS1238: Unable to resolve signature of class decorator ... The runtime will invoke the decorator with 1 arguments, but the decorator expects 2.` Do not enable it.
- The decorator is only sugar. Its implementation returns a subclass with a `manifestId = definition.UUID` field [V `dist/plugin/actions/decorators.js`]. A non-decorator alternative is therefore to set the field yourself: `class X extends SingletonAction { override readonly manifestId = "dev.h2k.vibetribe.slot"; }` [I, derived from the source, not compiled]. This is the escape hatch if the bundler (esbuild/tsx/vitest) does not handle standard decorators.
- Docs say nothing about decorators vs. `experimentalDecorators` [V actions guide, page checked]; the facts above come from the package and template.

### Events and the action API

[V] `SingletonAction` (`dist/plugin/actions/singleton-action.d.ts`) exposes: `onWillAppear`, `onWillDisappear`, `onKeyDown`, `onKeyUp`, `onDidReceiveSettings`, `onDialDown/Up/Rotate`, `onTouchTap`, `onTitleParametersDidChange`, `onSendToPlugin`, `onPropertyInspectorDidAppear/Disappear`, `onDidReceiveResources`. There are also global listeners on `streamDeck.actions.on*`, `streamDeck.devices.onDeviceDidConnect/Disconnect/Change`, `streamDeck.system.onSystemDidWakeUp`, `onApplicationDidLaunch/Terminate`, `onDidReceiveDeepLink`.

`onWillAppear` fires for every action that becomes visible (page/folder/profile change, and once per visible action at startup, after system wake) [V actions guide and system guide]. `onWillDisappear` is the inverse.

`ev.action` is an `Action`; narrow with `isKey()` / `isDial()` / `isNeoInfobar()` [V `action-base.d.ts`]. Handy members [V]:

- `action.id` (instance id), `action.manifestId`, `action.controllerType`
- `action.device` -> `Device { id, name, size: {columns, rows}, type, isConnected, actions }`
- `KeyAction.coordinates` -> `{ column, row }`, 0-indexed, or `undefined` inside a multi-action; `isInMultiAction()`
- `getSettings()`, `setSettings()`; `setImage()`, `setTitle()`, `setState()`, `showAlert()`, `showOk()` (key actions)
- Enumeration: `streamDeck.actions` / `this.actions` is an `Enumerable` of **currently visible** actions (`forEach`, `filter`, ...), `getActionById(id)` [V `store.d.ts`, `singleton-action.d.ts`: "Gets the visible actions"].

### Mapping slot keys in placement order

- Key order = reading order on the device: sort by `(coordinates.row, coordinates.column)`, grouped by `action.device.id`. `device.size.columns` gives the row width if you want a linear index `row * columns + column` [V types; sorting logic is the compiled snippet below].
- `onWillAppear` only reports **visible** keys; keys on a page or folder that was never shown are unknown to the plugin until the user navigates there. There is no API in the types to list placed-but-hidden actions [I, absence in the type definitions].
- Re-sort after every `onWillAppear`/`onWillDisappear`, because users drag keys around and switch pages [I].
- The same plugin action can sit on several devices at once (this machine has three), so key the state per `device.id` [L device list].

### `setImage` with an SVG string

- Signature `setImage(image?: string, options?: {state?: 0|1, target?: Target})` on `KeyAction`. The SDK forwards the string unchanged as `{event:"setImage", payload:{image,...}}` (`dist/plugin/actions/key.js`), so all validation happens inside the Stream Deck app [V].
- Accepted per JSDoc and guide: "a path to a local file within the plugin's folder, a base64 encoded string with the mime type declared (e.g. PNG, JPEG, etc.), or an SVG string" [V `key.d.ts`]. The guide lists supported formats SVG (`image/svg+xml`, recommended), JPEG, PNG, WEBP; animated formats (GIF) are not supported [V https://docs.elgato.com/streamdeck/sdk/guides/keys].
- **The only SVG form shown in the official guide is a data URL with percent-encoding**: `` `data:image/svg+xml,${encodeURIComponent(svg)}` `` [V same page, "From SVG" example, `<svg width="100" height="100">` without `xmlns`].
- A third-party plugin installed here, Agent Vitals, uses exactly `"data:image/svg+xml," + encodeURIComponent(...)` in `bin/plugin.mjs` [L, grep]. It is in daily use on this machine, so the form works on app 7.6.
- **Not verified:** passing a *raw* `<svg ...>` string (no `data:` prefix) and the `;charset=utf8` / `;base64` variants. The JSDoc says an "SVG string" is accepted but no example exists, and I did not run a plugin against the live app (that would install something into the user's Stream Deck) [I]. Recommendation: use the `encodeURIComponent` data URL, include `xmlns="http://www.w3.org/2000/svg"`, give a `viewBox="0 0 144 144"`.
- **Size limits:** none documented for pixel size, bytes or call rate [V keys guide: "No pixel size, file size, or timing limits"]. Manifest state images are specified as 72x72 and 144x144 @2x [V manifest page], so design the SVG on a 144 viewBox. The SDK's secondary sources claim larger native sizes on bigger devices (XL 96 px, + 120 px), unconfirmed by Elgato [I]. Because SVG is vector, one SVG works for all.
- Precedence: a user-defined image/title in the Stream Deck UI beats `setImage`/`setTitle`, which beat the manifest default [V keys guide]. So set `UserTitleEnabled: false` and ship no user override if the plugin must always control the key.
- `setTitle(title?, {state?, target?})` same rules [V]. `target` is `Target.Hardware | Software | HardwareAndSoftware`.

### Global settings

[V] `streamDeck.settings` (`dist/plugin/settings.d.ts`): `getGlobalSettings<T>()`, `setGlobalSettings<T>(obj)`, `onDidReceiveGlobalSettings(listener)`, `onDidReceiveSettings(listener)`, `useLegacySettingsBehavior` (default `false`, meaning the `onDidReceive*` events fire only on changes made elsewhere, not after your own `get*` call). Per-action settings: `action.getSettings()/setSettings()`. These are stored in the Stream Deck profile, in plain text [I]; do not put hook secrets there. Elgato also says not to ship secrets in a distributed plugin [V https://docs.elgato.com/streamdeck/sdk/introduction/plugin-environment].

### Logger

[V] `streamDeck.logger` (`@elgato/utils` Logger): `trace/debug/info/warn/error`, `setLevel("trace"|...)`, `createScope("Name")`. Default level INFO in production, DEBUG in debug mode; entries format `<iso_date> <LEVEL> [[scope]: ]<message>`. File target: `dest: path.join(cwd(), "logs")`, file name `<pluginUUID>`, `maxFileCount: 10` (`dist/plugin/logging/index.js`). Docs: `<plugin>.sdPlugin/logs/<uuid>.0.log`, 0 = newest, new file per start [V https://docs.elgato.com/streamdeck/sdk/guides/logging]. Console target is added only in debug mode. Discrepancy: docs say max 10 MiB per file, the 3.0.2 code says `50 * 1024 * 1024` [V both]. Stream Deck app logs are separate: `%APPDATA%\Elgato\StreamDeck\logs\StreamDeck.log` [V docs; L files present, they contain `ESDCustomPlugin::onSessionConnected [com.heinrich.mictoggle] Plugin connected` style lines for plugin start/stop].

### Opening URLs and `claude://` deep links

- `streamDeck.system.openUrl(url: string): Promise<void>` **exists in v3.0.2** [V `dist/plugin/system.d.ts` / `system.js`: sends `{event:"openUrl", payload:{url}}`].
- The docs state: "All URLs open in the default browser ... Custom URL schemes, for example `my-app://` are not yet supported by the SDK" [V https://docs.elgato.com/streamdeck/sdk/guides/system]. So `openUrl("claude://...")` should be assumed **not to work**; I did not test it live [I].
- Working alternative seen in the wild [L]: Agent Vitals launches Claude Desktop via `spawnDetached("rundll32.exe", ["url.dll,FileProtocolHandler", "claude://code/continue?session=<id>"])` (a child process from the plugin). The `claude` protocol is registered on this Windows machine [L, `reg query HKCR\claude` shows `URL Protocol`]. The snippet below uses the same call. `cmd /c start "" "claude://..."` should be equivalent [I].
- Plugins can also *receive* deep links `streamdeck://plugins/message/<PLUGIN_UUID>/<MESSAGE>` via `streamDeck.system.onDidReceiveDeepLink` [V `system.d.ts`]. Useful as an inbound trigger from outside.

### Long-press detection

[V] There is no long-press event; the guide documents only `onKeyDown` and `onKeyUp` and gives no timing. Implement it yourself: start a timer in `onKeyDown`, clear it in `onKeyUp`/`onWillDisappear`, treat "timer fired" as long press and "key up before timer" as short press. Implemented and compiled in the snippet below (500 ms) [L: `tsc` and `rollup` pass; runtime behaviour on a real key untested, [I]]. Caveat: if the page changes while a key is held, `onKeyUp` may never arrive, hence the cleanup in `onWillDisappear` [I].

### Minimal v3 action: files and a compiled snippet

Compiled with TypeScript 5.9 and bundled with the template's rollup config (output `bin/plugin.js` 89 KB plus `bin/package.json` `{ "type": "module" }`) in `/tmp/sdk-probe/compile` using `@elgato/streamdeck@3.0.2` [L]. It has **not been run inside Stream Deck**.

`tsconfig.json` (identical to the CLI template; no `experimentalDecorators`):

```json
{
  "extends": "@tsconfig/node20/tsconfig.json",
  "compilerOptions": {
    "customConditions": ["node"],
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "noImplicitOverride": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`package.json` devDependencies from the template [V CLI template]: `@elgato/cli`, `@rollup/plugin-commonjs ^29`, `@rollup/plugin-node-resolve ^15`, `@rollup/plugin-terser ^1`, `@rollup/plugin-typescript ^12`, `@tsconfig/node20`, `@types/node ~24.1.0`, `rollup ^4`, `tslib`, `typescript ^5`; dependency `@elgato/streamdeck`. Scripts: `"build": "rollup -c"`, `"watch": "rollup -c -w --watch.onEnd=\"streamdeck restart dev.h2k.vibetribe\""`. The rollup config bundles everything (including `ws` and the SDK) into one `bin/plugin.js`, so no `node_modules` ships in the plugin.

`src/plugin.ts`:

```ts
import streamDeck, {
	action,
	SingletonAction,
	type KeyAction,
	type KeyDownEvent,
	type KeyUpEvent,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";
import { spawn } from "node:child_process";

type Settings = { label?: string };
type SlotState = "idle" | "working" | "waiting" | "error";
const FILL: Record<SlotState, string> = {
	idle: "#3a3f47",
	working: "#d97706",
	waiting: "#2563eb",
	error: "#dc2626",
};

/** Raw SVG string -> data URL accepted by setImage (official docs example uses encodeURIComponent). */
function slotImage(state: SlotState, label: string): string {
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">` +
		`<rect width="144" height="144" rx="18" fill="${FILL[state]}"/>` +
		`<text x="72" y="84" font-family="Segoe UI, sans-serif" font-size="40" font-weight="700" ` +
		`text-anchor="middle" fill="#fff">${label}</text></svg>`;
	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Windows: open a custom-scheme URL (claude://...) without a console window. */
function openDeepLink(url: string): void {
	spawn("rundll32.exe", ["url.dll,FileProtocolHandler", url], {
		detached: true,
		stdio: "ignore",
		windowsHide: true,
	}).unref();
}

const LONG_PRESS_MS = 500;

@action({ UUID: "dev.h2k.vibetribe.slot" })
export class SlotAction extends SingletonAction<Settings> {
	/** Visible slot keys by action id. */
	readonly #keys = new Map<string, KeyAction<Settings>>();
	readonly #press = new Map<string, { timer: NodeJS.Timeout; fired: boolean }>();

	/** Keys of one device in placement (reading) order: row-major, left to right. */
	orderedKeys(deviceId: string): KeyAction<Settings>[] {
		return [...this.#keys.values()]
			.filter((k) => k.device.id === deviceId && k.coordinates !== undefined)
			.sort((a, b) => a.coordinates!.row - b.coordinates!.row || a.coordinates!.column - b.coordinates!.column);
	}

	override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
		if (!ev.action.isKey()) return;
		this.#keys.set(ev.action.id, ev.action);
		streamDeck.logger.info(`appear ${ev.action.id} dev=${ev.action.device.id} at=${JSON.stringify(ev.action.coordinates)}`);
		await ev.action.setImage(slotImage("idle", String(this.orderedKeys(ev.action.device.id).findIndex((k) => k.id === ev.action.id) + 1)));
	}

	override onWillDisappear(ev: WillDisappearEvent<Settings>): void {
		this.#keys.delete(ev.action.id);
		const p = this.#press.get(ev.action.id);
		if (p) clearTimeout(p.timer);
		this.#press.delete(ev.action.id);
	}

	override onKeyDown(ev: KeyDownEvent<Settings>): void {
		const id = ev.action.id;
		const entry = { fired: false, timer: setTimeout(() => {
			entry.fired = true;
			streamDeck.logger.info(`long press ${id}`);
			openDeepLink("claude://code/continue?session=<SESSION_ID>"); // URL form used by the third-party Agent Vitals plugin
		}, LONG_PRESS_MS) };
		this.#press.set(id, entry);
	}

	override onKeyUp(ev: KeyUpEvent<Settings>): void {
		const p = this.#press.get(ev.action.id);
		if (!p) return;
		clearTimeout(p.timer);
		this.#press.delete(ev.action.id);
		if (!p.fired) streamDeck.logger.info(`short press ${ev.action.id}`);
	}
}

streamDeck.logger.setLevel("debug");
streamDeck.actions.registerAction(new SlotAction());
streamDeck.connect();
```

Two typing notes found while compiling [L]: `KeyAction` is generic and needs a settings type argument (so give `SingletonAction<Settings>` your own settings type, no import of `JsonObject` from the transitive `@elgato/utils` needed), and `override` is required because the template sets `noImplicitOverride`.

## 1.2 Build and tooling

### CLI commands [V CLI help, https://docs.elgato.com/streamdeck/cli/intro]

`create`, `link [path]`, `unlink <uuid>`, `list`, `restart|r <uuid>`, `stop|s <uuid>`, `dev [--disable]`, `validate [path]`, `pack|bundle [path]` (writes a `.streamDeckPlugin`), `config`, alias binary `sd`.

What they actually do, read from `bin/streamdeck.mjs` of `@elgato/cli@1.10.2` [V source]:

| Command | Implementation |
|---|---|
| `link [path]` | requires dir name `<uuid>.sdPlugin`; refuses if a plugin with that UUID is already in the Plugins dir; then `symlinkSync(resolve(path), <PluginsDir>/<dirname>, "junction")`. Plugins dir on Windows: `%APPDATA%\Elgato\StreamDeck\Plugins`; macOS `~/Library/Application Support/com.elgato.StreamDeck/Plugins`. |
| `restart <uuid>` | plugin must exist in the Plugins dir; then runs `start streamdeck://plugins/restart/<uuid>` (Windows) / `open ... -g` (macOS). If `StreamDeck.exe` is not running it starts it. |
| `stop <uuid>` | same with `streamdeck://plugins/stop/<uuid>`. |
| `dev` | sets registry `HKCU\Software\Elgato Systems GmbH\StreamDeck` value `developer_mode` = 1 (`--disable` -> 0); macOS `defaults write com.elgato.StreamDeck developer_mode`. |
| `create` | wizard; enables developer mode, generates the template, runs `<pm> install`, `<pm> run build`, links the plugin and restarts it. |

Developer mode on this machine [L]: `reg query "HKCU\Software\Elgato Systems GmbH\StreamDeck" /v developer_mode` -> value not found, i.e. not enabled. Docs: dev mode allows attaching debuggers to Node plugins and debugging property inspectors at http://localhost:23654/ [V https://docs.elgato.com/streamdeck/cli/commands/dev]. Whether `Nodejs.Debug` is ignored without dev mode is undocumented [I].

### Recommended bundler

Rollup, as generated by `streamdeck create` (`@rollup/plugin-typescript`, `node-resolve`, `commonjs`, `terser` for release builds, sourcemaps while watching) [V template]. Works with TS standard decorators out of the box [L: built in `/tmp/sdk-probe/compile`, 2.4 s]. The template wires `watch` to `streamdeck restart <uuid>` after each build.

### Linking a repo that lives in WSL into Windows Stream Deck

This is the main tooling problem.

- The CLI makes an NTFS **junction** [V source]. A junction to a UNC target can be *created* but does not resolve [L]: `New-Item -ItemType Junction -Target '\\wsl.localhost\Ubuntu\tmp\sdk-probe'` succeeded, then `Get-ChildItem` through it failed with "Die Syntax für den Dateinamen, Verzeichnisnamen oder die Datenträgerbezeichnung ist falsch". A directory symlink to the UNC path could be created in the same test, but the CLI does not make symlinks and I did not test whether Stream Deck / Node can run a plugin from `\\wsl.localhost\...` [I]. Avoid; also the app would hold a 9P share open.
- Both plugins installed here are plain directories in the Plugins folder, not links [L, `Get-ChildItem -Force` shows `LinkType` empty for all four]. So copying also works as an install mechanism.
- Recommended approach [I, not executed because it would modify the user's Stream Deck install]:
  1. Keep sources in the WSL repo. Let rollup write the finished `.sdPlugin` folder to a Windows-local path, for example `C:\dev\vibetribe\dev.h2k.vibetribe.sdPlugin` (from WSL: `/mnt/c/dev/vibetribe/dev.h2k.vibetribe.sdPlugin`) via the rollup `output.file`, or a post-build `rsync`/`cp -r` of `manifest.json`, `bin/`, `imgs/`, `ui/`.
  2. Once, from Windows: `streamdeck dev` (optional) and `streamdeck link C:\dev\vibetribe\dev.h2k.vibetribe.sdPlugin` (needs the Windows `@elgato/cli`; install it globally with npm in Windows, not into the repo).
  3. After each build, restart without the CLI: `cmd.exe /c start "" streamdeck://plugins/restart/dev.h2k.vibetribe` from WSL (same URL the CLI uses). `/mnt/c` is reachable from WSL [L].
- Alternative: run the whole build with Windows Node against a clone on a Windows disk. Simpler linking, worse for the pnpm/WSL workflow.

### Restart, logs, debugging

- Restart: `streamdeck restart dev.h2k.vibetribe` (Windows CLI) or the `streamdeck://plugins/restart/<uuid>` URL [V source]. If the plugin does not show up after a fresh install, restart the Stream Deck app [V getting started].
- Logs: plugin `<sdPlugin>/logs/<uuid>.N.log` (1.1 above); app `%APPDATA%\Elgato\StreamDeck\logs\StreamDeck.log` [V docs, L files]. Third-party plugins here write their own logs, e.g. `agent-vitals.log` inside their plugin directory [L].
- Inspector: manifest `Nodejs.Debug` accepts `"enabled"` (`--inspect=127.0.0.1:{PORT}`, port auto-assigned by Stream Deck), `"break"` (`--inspect-brk`), or custom args such as `"--inspect=127.0.0.1:12345"` [V manifest page and schema description]. Use the fixed form to attach from VS Code or `chrome://inspect`. With the auto port you have to read it from the plugin's process command line [I].
- Launch line observed for a running plugin [L, `Get-CimInstance Win32_Process`]: `...\StreamDeck\NodeJS\24.13.1\node.exe --no-global-search-paths --enable-source-maps <plugin>\bin/plugin.js -port 28196 -pluginUUID <hex> -registerEvent registerPlugin -info {"application":{"platform":"windows","platformVersion":"10.0.26200","version":"7.6.0.23012",...},"devices":[...]}`. The parent process is `StreamDeck.exe` [L]. `--enable-source-maps` means rollup sourcemaps give readable stack traces.

## 1.3 DRM, Marketplace and where a plugin may write

- DRM applies only to plugins uploaded through Maker Console; "Plugins with DRM enabled are only protected after they have been uploaded and processed in Maker Console." Plugins created with CLI >= 1.6 have it enabled by default [V https://docs.elgato.com/streamdeck/sdk/introduction/distribution/]. A locally linked or copied dev plugin is not DRM-protected [I, follows from the previous sentence].
- DRM compatibility checklist [V same page]: Node SDK `@elgato/streamdeck` >= v2; "Files distributed in the plugin are immutable"; "Required files are generated at runtime"; "Distributed files are not modified afterward"; manifest treated as a protected asset; "The manifest JSON is not read at runtime" (keep non-sensitive data in a separate JSON or in code); `SDKVersion` is `3` and `Software.MinimumVersion` is `"6.9"` or higher. The page does not say "the plugin directory is read-only" in those words; the rule is "never modify what you shipped", and files you need must be created at runtime somewhere else.
- The SDK logger itself writes into `<cwd>/logs` (the plugin directory, [V source + docs]), and Agent Vitals keeps `agent-vitals.log` and `usage-cache.json` in its plugin directory on this machine [L, directory listing]. So writing *new* files there currently works, at least for non-DRM installs; but updates replace the directory and DRM treats shipped files as immutable [I].
- Recommendation [I]: put everything VibeTribe owns (hook port file, session state, secrets, cache) in a per-user directory outside the plugin dir. `%LOCALAPPDATA%\vibetribe` fits machine-local state; `%APPDATA%\vibetribe` (Roaming) is what the task asked for and is fine on a single machine. `process.env.APPDATA` is set in the plugin process [L, probe run with the bundled Node]. Use `streamDeck.settings` global settings only for small, non-secret values.

## 1.4 Runtime on Windows: platform, `node:http`, `child_process`

- The plugin process is the Windows build of Node that Stream Deck ships: `...\Elgato\StreamDeck\NodeJS\24.13.1\node.exe` for `Nodejs.Version: "24"` and `20.20.0` for `"20"` [L, process list; the Elgato docs say "Stream Deck 7.1 through 7.3 bundle Node.js 20.20.0 and 24.13.1" and that from 7.1 Node is updated automatically, https://docs.elgato.com/streamdeck/sdk/introduction/plugin-environment]. Plugins run locally and unsandboxed [I: no sandbox mentioned in docs; observed behaviour below].
- Probe run with that very binary (outside Stream Deck) [L]: `process.platform` = `win32`, arch `x64`, `v24.13.1`; `node:http` server on 127.0.0.1 answered a `fetch`; `child_process.spawnSync('cmd.exe', ...)` worked; `spawnSync('wsl.exe', ['-d','Ubuntu','--','echo','wsl-ok'])` printed `wsl-ok`.
- Inside Stream Deck, an installed plugin demonstrably does this [L]: Agent Vitals (Node 20 plugin, PID 10336, parent `StreamDeck.exe`) holds a listening socket `127.0.0.1:43623` (`Get-NetTCPConnection`), and its bundle imports `node:http` (`createServer`) and `child_process` (`spawn`, `execFile`). So an HTTP server plus child processes in a plugin work under SD 7.6.
- WSL reachability [L]: with `networkingMode=mirrored`, a Windows Node server on `127.0.0.1:48999` was reachable from WSL via `curl http://127.0.0.1:48999` (returned the response). WSL files are readable from Windows at `\\wsl.localhost\Ubuntu\...`. Agent Vitals comments in `2026-10-10-technical.md` mention port 45623 clashes with the WSL ephemeral range; `43623` is what is in use now.

---

# Part 2. Cheapest way to refresh the Windows `claude` OAuth token without a model call

## 2.1 What the credentials file looks like (secrets not read)

[L] `%USERPROFILE%\.claude\.credentials.json` has top-level keys `mcpOAuth` and `claudeAiOauth`. Read via a one-line node snippet that prints only `expiresAt`:

```
now       = 2026-10-10T18:21:12Z
mtime     = 2026-10-10T14:04:02.664Z   (LastWriteTime UTC)
expiresAt = 2026-10-10T22:04:01.586Z   = mtime + 8 h
scopes    = user:file_upload, user:inference, user:mcp_servers, user:plugins, user:profile, user:sessions:claude_code
subscriptionType = max
```

So the access token lives 8 h, and the last write came from the earlier `claude -p` run (matches what you observed). The file is unchanged by every command I ran today (listed below); expected, because the token is fresh (see 2.3).

Docs on storage [V https://code.claude.com/docs/en/authentication]: on Windows credentials are in `%USERPROFILE%\.claude\.credentials.json`; with `CLAUDE_CONFIG_DIR` the file lives under that directory.

## 2.2 Commands tried (Windows, PowerShell, `claude` 2.1.287)

Each row: `expiresAt` and mtime were identical before and after (token fresh). Cost/turn data comes from `--output-format json`.

| Command | Result [L] | Authenticates against the network? | Model call? |
|---|---|---|---|
| `claude auth status` (`--text`) | exit 0 in ~0.35 s; prints `loggedIn: true`, `authMethod: claude.ai`, org, subscription `max`. Exit 0 = logged in, 1 = not [V CLI reference]. | Almost certainly not (0.35 s, too fast) [I]. A GitHub issue reports it does **not** trigger a refresh: https://github.com/anthropics/claude-code/issues/44945 (closed as duplicate of #31095) [V]. | no |
| `claude doctor` | exit 0 in ~2.9 s; install and settings diagnostics only, "Organization policy: not applicable to Pro and Max accounts". | no auth info | no |
| `claude mcp list` | exit 0 in ~11.9 s; "Checking MCP server health", connected the claude.ai connectors (Docs, Calendar, Drive, Gmail) plus plugin MCP servers. | **yes**: the claude.ai connectors are reached with the OAuth bearer token | no |
| `claude -p "hi" --max-turns 0 --model haiku` | **makes a real model call**: `total_cost_usd 0.0278`, ~38k tokens of default context (11.8k cache creation + 26.3k cache read), 7.2 s. **`--max-turns 0` does not mean "no turns"**; the docs say "No limit by default" [V CLI reference]. | yes | **yes** |
| `claude -p "ok" --model haiku --tools "" --system-prompt "Reply with: ok" --disable-slash-commands --strict-mcp-config --setting-sources "" --no-session-persistence --effort low --output-format json` | result `ok`, `total_cost_usd 0.000927`, 532 input tokens, 79 output tokens, 1 turn, 4.5 s | yes | yes (tiny) |
| `claude -p "/cost" --output-format json --no-session-persistence` | **zero model calls**: `turns 0`, `cost 0`, `duration_api_ms 0`, 4.0 s. Output is the subscription usage ("Current session: 7% used ...", "Current week (all models): 89% used ..."). | **yes**: usage percentages can only come from an authenticated server call (the binary contains `/api/oauth/usage` strings) [I] | no |
| `claude -p "/status"` | `/status isn't available in this environment` (0 turns) | n/a | no |
| `claude -p "/context"` | prints local context table, 0 turns | no | no |
| `claude auth login/logout/setup-token` | not run (interactive or destructive) | | |

Not usable: `claude config`, `claude update --check`, `claude /status` equivalents either do not exist in 2.1.287's command list (`claude --help` shows `agents, attach, auth, auto-mode, doctor, gateway, import, install, logs, mcp, plugin, project, respawn, rm, setup-token, stop, ultrareview, update`) or install software (`update`). `--bare` is explicitly excluded: "Anthropic auth is strictly ANTHROPIC_API_KEY or apiKeyHelper ... (OAuth and keychain are never read)" [V `claude --help`], so never add `--bare` to a refresh command.

Side observation [L]: the week-limit row from `/cost` reads **89 % used**, resets Oct 12. Any extra model call counts against that, although 3 minimal calls a day are negligible (about $0.001 each at list price, subscription billing in reality).

## 2.3 When does the CLI refresh? (read from the 2.1.287 binary)

I extracted strings from `C:\Users\Heinrich\.local\bin\claude.exe` (247 MB; the JS is embedded as readable text). Findings [L, minified identifiers, so the call graph is incomplete]:

- Threshold function: `function pF(e,n=Date.now()){if(e===null)return!1;return n+300000>=e}`. The token is "due" when **now + 5 minutes >= expiresAt**, so a refresh happens only inside the last 5 minutes before expiry or after expiry. (A third-party script comment also claims a 5-minute buffer: [I] weaker evidence.)
- Refresh routine (`fl`, wrapped as `$i()`/`l8()`): re-reads the credentials, returns `"not_needed"` when `!pF(expiresAt)`, otherwise takes a **lock** in the config directory (`ELOCKED` retried up to 5 times, 1-2 s apart), re-reads, resolves races when another process already refreshed (`refresh_race_resolved`), and writes the new `accessToken`/`refreshToken`/`expiresAt` back. It also has outcomes `no_refresh_token`, `known_dead_refresh_token`, `account_on_hold`.
- It is called from several features before an authenticated request: policy-limits fetch, remote-settings fetch, claude.ai linked-account check, voice stream, the Cloud-gateway sign-in, and others. I could not map which top-level command reaches it without a model call.
- Consequence: **today's token (22:04:01Z) is fresh until 21:59:01Z, so no command can be shown to refresh it before then.** That is why none of my runs changed the file. A real test is only possible in the window `21:59:01Z` .. `22:04:01Z` (23:59:01 .. 00:04:01 local, Europe/Berlin = UTC+2 today) or after expiry.
- I did **not** fake an old `expiresAt` in a copy of the credentials. Refresh tokens rotate (reports: https://github.com/anthropics/claude-code/issues/42904 and #44945 mention rotation and concurrent-session races [V]), and a refresh from a copy could invalidate the real login.

Related known problems [V, GitHub, not verified by me]: "CLI does not proactively refresh" reports (#44945, #42904, #60503), refresh endpoint blocked from outside the CLI by Cloudflare ("there is no workaround available from outside the CLI", so do not implement your own `refresh_token` grant), and one report that a refresh rewrote the file without `expiresAt`/`scopes` (claudeissues.com issue 85262). Never write the credentials file yourself.

## 2.4 Recommendation

Principle: only act when the token is inside the CLI's own refresh window, and ask the CLI to do the refresh.

1. VibeTribe (or a Windows scheduled task) reads `expiresAt` every minute: file read plus `JSON.parse(...).claudeAiOauth.expiresAt`, never log the object.
2. When `expiresAt - now <= 4 min` (inside the 5-min window with margin) or already expired, run **primary**: `claude.exe -p "/cost" --output-format json --no-session-persistence` (cwd = a neutral temp dir). It is a zero-turn command that talks to the server with the OAuth token [L: no model call; I: refresh on that path is likely but unproven]. Expect 4 s.
3. Re-read `expiresAt`. If it moved forward (+~8 h), done.
4. If not, **fallback** (proven by your own observation that `claude -p` refreshes; I proved only that it authenticates and costs about $0.001):

   ```powershell
   claude -p "ok" --model haiku --tools "" --system-prompt "Reply with: ok" `
     --disable-slash-commands --strict-mcp-config --setting-sources "" `
     --no-session-persistence --effort low --output-format json
   ```

   (Cwd should have no `CLAUDE.md` to keep context at ~500 tokens; run it from a temp dir. 4.5 s, $0.0009.)

   > Not adopted (user decision, 2026-10-14): VibeTribe runs only `/cost`. The haiku fallback is a real model call and was dropped. Every attempt logs `token refresh: ok` or `token refresh: no change`, so the next expiry shows whether `/cost` alone refreshes the login.
5. If still unchanged, mark the token state as error on the Stream Deck, back off (5 min, 10 min, ...), and do not loop. The commands exit 0 even when auth silently fails, so decide by `expiresAt`, not by exit code.
6. Spawn with the absolute path (`%USERPROFILE%\.local\bin\claude.exe`), `windowsHide: true`, a 60 s timeout, and no inherited `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`/`CLAUDE_CODE_OAUTH_TOKEN` (those take precedence over the subscription login [V authentication page, precedence list]), otherwise the call would not touch `.credentials.json`.
7. Do not run this concurrently from several places; the CLI uses a lock, but one refresher is enough.

Alternative worth knowing: `claude setup-token` creates a 1-year token for `CLAUDE_CODE_OAUTH_TOKEN` ("can only make model requests, so it can't establish Remote Control sessions or fetch claude.ai connectors") [V authentication page]. It does not help if VibeTribe needs the normal login's usage data [I].

## 2.5 How to settle the open question tonight (no risk)

At about 21:58Z (23:58 local) run the following; it reads only `expiresAt` and the file time. Try the candidates in order and stop at the first that moves `expiresAt`.

```powershell
function Snap { $p="$env:USERPROFILE\.claude\.credentials.json"
  $e = node -e "const o=require(process.argv[1]).claudeAiOauth;console.log(new Date(o.expiresAt).toISOString())" $p
  "now=$((Get-Date).ToUniversalTime().ToString('o'))  mtime=$((Get-Item $p).LastWriteTimeUtc.ToString('o'))  expiresAt=$e" }
Set-Location $env:TEMP
Snap
claude -p "/cost" --output-format json --no-session-persistence | Out-Null; Snap     # candidate 1, no model call
# only if unchanged and expiresAt is within 5 min:
claude mcp list | Out-Null; Snap                                                      # candidate 2, no model call, 12 s
# only if still unchanged:
claude -p "ok" --model haiku --tools "" --system-prompt "Reply with: ok" --disable-slash-commands --strict-mcp-config --setting-sources "" --no-session-persistence --effort low --output-format json | Out-Null; Snap
```

Run it only when `expiresAt - now` is between 0 and 5 minutes, otherwise the CLI correctly does nothing and the test says nothing.

---

# Summary of what is verified vs. open

Verified: SDK 3.0.2 API surface, TS 5 standard decorators (breaks with `experimentalDecorators`), manifest schema and a manifest that passes `streamdeck validate`, working compile and rollup bundle, CLI `link` = junction, `restart` = `streamdeck://plugins/restart/<uuid>`, junction to `\\wsl.localhost` does not resolve, plugins run on Windows `node.exe` 24.13.1 (`win32`), `node:http` listener in a live plugin, `child_process` and `wsl.exe` from that Node, WSL mirrored networking reachable from WSL, `openUrl` exists but docs exclude custom schemes, DRM checklist, `--max-turns 0` still calls the model, `/cost` in `-p` is a zero-model-call authenticated command, CLI refresh threshold of 5 min.

Open (needs a live test): whether `setImage` accepts a raw `<svg>` string or `charset=utf8` data URL; whether `openUrl("claude://...")` is rejected by the app; long-press behaviour on real hardware; which no-model command triggers the token refresh (testable only 21:59-22:04Z today); behaviour of `Nodejs.Debug` without developer mode.
