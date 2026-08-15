/**
 * Installer for the `anchored-standard` agent preset.
 *
 * This bundle plugin copies the bundled preset (preset/agent.cordis.yml,
 * preset/preset.yml, preset/tool-bootstrap.mjs) into the user preset root
 * `$DSH_HOME/.agent-presets/anchored-standard/` exactly once on boot, so
 * `dsh plugin --profile web add github:Jungod1121/dsh-anchored-standard`
 * also makes the preset selectable in the session preset list.
 *
 * Idempotent and non-destructive:
 *  - a missing target file is written;
 *  - an identical target file is left untouched (no-op);
 *  - a DIFFERENT target file is left untouched with a one-time-ish warning,
 *    so a locally edited preset is never overwritten.
 * Uninstalling this bundle never deletes the installed preset — delete the
 * `anchored-standard` directory under the user preset root manually if you
 * want it gone.
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'anchored-standard-installer'

const PRESET_ID = 'anchored-standard'
const PRESET_FILES = ['agent.cordis.yml', 'preset.yml', 'tool-bootstrap.mjs']

export async function apply(ctx) {
  const log = {
    info(message) {
      try {
        if (ctx.logger && typeof ctx.logger.info === 'function') ctx.logger.info(message)
      } catch {
        // logger unavailable — nothing to do
      }
    },
    warn(message) {
      try {
        if (ctx.logger && typeof ctx.logger.warn === 'function') ctx.logger.warn(message)
      } catch {
        // logger unavailable — nothing to do
      }
    },
  }

  try {
    const packageDir = dirname(fileURLToPath(import.meta.url))
    const sourceDir = join(packageDir, 'preset')
    const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
    const targetDir = join(dshHome, '.agent-presets', PRESET_ID)

    await mkdir(targetDir, { recursive: true })

    let installed = 0
    let kept = 0
    for (const file of PRESET_FILES) {
      const source = join(sourceDir, file)
      const target = join(targetDir, file)
      const content = await readFile(source)
      if (existsSync(target)) {
        const existing = await readFile(target)
        if (existing.equals(content)) continue
        log.warn(`${name}: ${target} exists with different content; leaving it untouched`)
        kept += 1
        continue
      }
      await writeFile(target, content)
      installed += 1
    }

    log.info(
      installed > 0
        ? `${name}: installed preset '${PRESET_ID}' (${installed} file(s)) at ${targetDir}`
        : kept > 0
          ? `${name}: preset '${PRESET_ID}' already present at ${targetDir} (${kept} locally edited file(s) kept untouched)`
          : `${name}: preset '${PRESET_ID}' already present and up to date at ${targetDir}`,
    )
    log.info(`${name}: the '${PRESET_ID}' preset is now selectable for new sessions; set settings 'agent-presets.default' to make it the default.`)
  } catch (error) {
    // An installer failure must never take the bundle down with it.
    log.warn(`${name}: preset install failed (plugin continues without it): ${String((error && error.message) || error)}`)
  }
}
