/** The npm bundle contains a nested core package, not a Loader-mounted core
 * entry. Its generated Host face therefore belongs to this gate fiber through
 * the public registry API. The standalone core keeps native Loader discovery.
 * Never leave a definition behind after disable/uninstall or fall back around
 * a withdrawn strict definition. */
import { apply as mountGate, inject as gateInject } from './lib/index.js'
import { TYPERT } from './lib/typert.host.js'

export const name = 'gate'
export const inject = [...gateInject, 'typert']

// Arrow function on purpose: Cordis treats a plain `function apply` as a
// class-style constructor, which breaks the host's shutdown/cleanup wiring.
// Upstream v1.7.16 shipped the `function` form here and its own verify.mjs
// flagged it; this fork keeps the verified form.
export const apply = (ctx) => {
  ctx.typert.register(TYPERT)
  return mountGate(ctx)
}
