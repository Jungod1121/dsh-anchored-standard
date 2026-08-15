# dsh-anchored-standard

[中文说明](./README.zh-CN.md)

An experimental DeepSeek Harness (DSH) agent preset that bootstraps the first
model request with a Minimal-aligned prompt and two tools (`bash` + `read`),
then exposes the complete Standard tool catalog after the first durable tool
call or reply. Ships in two forms: an **installer bundle** (`dsh plugin add`)
and a **manual preset directory**.

This is a community project. It is not an official DeepSeek preset and is not
affiliated with or endorsed by DeepSeek.

## Why

DeepSeek V4 Pro conditions strongly on the API-visible tool catalog of the
FIRST request. The community evaluation at
[`xiaobright/modeltest`](https://github.com/xiaobright/modeltest) measured the
official Minimal preset at 99/96 and Standard / PTC at 91/92 on the same
frozen task; a two-phase preset (Minimal bootstrap, then the full 25-tool
Standard catalog) scored 98/99 — the gain comes from the first-request
trajectory anchor, not from keeping the tool surface small forever. The
original design is [`xiaobright/dsh-anchored-standard`](https://github.com/xiaobright/dsh-anchored-standard);
this repository is an independent implementation verified on harness
`0.1.0-rc.6` with wire-level `request/header` evidence (2 tools on the first
request, the full catalog from request #2 on).

How it works, per session:

1. The system prompt is the Minimal preset's complete prompt,
   `You are a helpful software engineer assistant.`
2. The first model request exposes only the platform shell (`bash`/`pwsh`)
   plus `read`.
3. After the session records its first durable promotion signal — a
   `tool/call` OR the first `assistant/message`, whichever comes first —
   every later request exposes the full Standard catalog. Request #1 always
   sees the bootstrap catalog; request #2 always sees the full catalog, so a
   text-only first reply can never trap the session in bootstrap.

The phase is derived from durable session events, so resume and reload
preserve it.

## Install

### Option A — installer bundle (recommended)

```sh
dsh plugin --profile web add github:Jungod1121/dsh-anchored-standard
```

Then fully restart DeepSeek Harness. On boot the bundle copies the preset
into the user preset root
(`$DSH_HOME/.agent-presets/anchored-standard/`, idempotent — existing files
are never overwritten), and the preset appears in the session preset list.
Create a blank session and select **Anchored Standard (experimental)**. Do
not switch an active session from a different preset.

To make it the default preset for new sessions, set
`agent-presets.default: anchored-standard` in `$DSH_HOME/settings.yaml`.

### Option B — manual preset directory

Clone this repository, then copy the entire `preset` directory into the user
preset root under the id `anchored-standard`:

```sh
dsh_home="${DSH_HOME:-$HOME/.dsh}"
mkdir -p "$dsh_home/.agent-presets"
cp -R preset "$dsh_home/.agent-presets/anchored-standard"
```

The roster discovers user presets while the process is running; create a
blank session and select **Anchored Standard (experimental)**.

## Uninstall

```sh
dsh plugin --profile web remove dsh-anchored-standard
```

Uninstalling the bundle never deletes the installed preset. Remove the
preset itself with:

```sh
rm -rf "${DSH_HOME:-$HOME/.dsh}/.agent-presets/anchored-standard"
```

## Verify

Export the session JSONL and inspect `request/header` events: the first
header should contain only `bash/read` (or `pwsh/read` on Windows), and every
later header should contain the full Standard catalog.

## Compatibility

Developed and tested against DeepSeek Harness `0.1.0-rc.6`. The harness is a
developer preview with breaking changes; review upstream changes before using
this preset with a newer release.

## Results and evidence

The mechanism (first-request bootstrap catalog, full catalog afterwards) is
verified on rc.6 at the wire level. The 98/99 ability scores come from
[`xiaobright/modeltest`](https://github.com/xiaobright/modeltest) Project2
V4.1b — n=2 on one frozen task. They are reproducible evidence for that
task, **not** a claim of universal improvement across models or workloads.

## License

MIT. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
