/**
 * Vendor the plugin's runtime dependency closure into git so the
 * `github:owner/repo` install channel is loadable.
 *
 * Why this is needed: DSH installs a plugin either from an npm registry tarball
 * (where `bundleDependencies` are copied out of the local node_modules at pack
 * time) or straight from git. For a git source, npm/pnpm pack the CHECKED-OUT
 * tree, and `bundleDependencies` are never fetched from the registry because the
 * source is not a registry package. A git clone has no node_modules (upstream
 * ignores the whole directory), so every bare `import 'qrcode' | 'ws' |
 * 'tweetnacl' | 'zod'` in lib/ fails at load time.
 *
 * That is not theoretical: the live profile installs
 * `@harness-remote/dsh-wechat-remote` from github and its gate cannot even load
 * ("Cannot find package 'qrcode' imported from .../lib/gate-runtime.js"), which
 * is the real cause of "扫了码但连不上 / 一直没有状态" on git-installed nodes.
 *
 * Fix: track the runtime closure in git, un-ignoring exactly those package
 * roots, and list them in `files` so `npm pack` and the git packing path carry
 * identical bytes. `pnpm` (installer-only, ~40 MB, never imported by lib/) stays
 * out of the core package.
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.argv[2]
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
const pkgs = lock.packages || {}
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

const roots = Object.keys(manifest.dependencies || {}).filter(name => name !== 'pnpm')
const seen = new Set()
const queue = roots.map(name => `node_modules/${name}`)
const children = key => {
  const entry = pkgs[key]
  if (!entry?.dependencies) return []
  const out = []
  for (const name of Object.keys(entry.dependencies)) {
    const nested = `${key}/node_modules/${name}`
    if (pkgs[nested]) out.push(nested)
    else if (pkgs[`node_modules/${name}`]) out.push(`node_modules/${name}`)
  }
  return out
}
while (queue.length) {
  const key = queue.pop()
  if (seen.has(key) || !pkgs[key]) continue
  seen.add(key)
  for (const child of children(key)) queue.push(child)
}
// Flat npm layout: nested copies live inside their parent package and are
// covered by the parent's whitelist, so only root-level keys need listing.
const topLevel = [...seen].filter(k => /^node_modules\/(@[^/]+\/[^/]+|[^/]+)$/.test(k)).sort()
for (const key of topLevel) {
  if (!fs.existsSync(path.join(root, key, 'package.json'))) throw new Error(`not installed: ${key}`)
}

fs.writeFileSync(path.join(root, 'vendored-deps.json'), JSON.stringify({
  purpose: 'runtime closure tracked in git so github: installs can load lib/; bundleDependencies are not fetched for git sources',
  generatedBy: 'scripts/vendor-runtime-deps.mjs',
  packages: topLevel.map(k => ({ path: k, version: pkgs[k].version })),
}, null, 2) + '\n', 'utf8')

const gitignorePath = path.join(root, '.gitignore')
const MARK = '# vendored runtime closure: keeps the github: install channel loadable'
let current = fs.readFileSync(gitignorePath, 'utf8')
const cut = current.indexOf(MARK)
if (cut >= 0) current = current.slice(0, cut).replace(/\s+$/, '') + '\n'
const base = current
  .split('\n')
  .filter(line => line.trim() !== 'node_modules/' && line.trim() !== '/node_modules/*')
  .join('\n')
  .replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '')
const block = `${MARK}
# replaces the upstream "node_modules/" rule: git can never re-include a child
# of an excluded directory, so only node_modules' children are ignored here and
# the runtime closure below is re-included. Anything inside a whitelisted
# package (including its nested node_modules) stays tracked.
# scripts/vendor-runtime-deps.mjs regenerates this block.
/node_modules/*
${topLevel.map(k => `!/${k}`).join('\n')}
`
fs.writeFileSync(gitignorePath, `${base}\n\n${block}`, 'utf8')

// .gitattributes: vendored npm payloads stay byte-exact.
const gaPath = path.join(root, '.gitattributes')
const gaMark = '# vendored npm packages are byte-exact; never normalize their line endings'
let attrs = fs.existsSync(gaPath) ? fs.readFileSync(gaPath, 'utf8') : ''
if (!attrs.includes(gaMark)) attrs = attrs.replace(/\s*$/, '\n') + `${gaMark}\n/node_modules/** -text\n`
fs.writeFileSync(gaPath, attrs, 'utf8')

// package.json: explicit `files` entries so the packed tree carries the closure.
const keepFiles = (manifest.files || []).filter(entry => !entry.startsWith('node_modules/'))
manifest.files = [...keepFiles, ...topLevel]
fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')

const dirBytes = dir => {
  let total = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) total += dirBytes(full)
    else if (entry.isFile()) total += fs.statSync(full).size
  }
  return total
}
console.log(JSON.stringify({
  packages: topLevel.length,
  megabytes: +(topLevel.reduce((n, k) => n + dirBytes(path.join(root, k)), 0) / 1048576).toFixed(2),
  excluded: ['pnpm (installer-only)'],
  first: topLevel.slice(0, 4),
}, null, 1))
