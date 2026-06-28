const { noChunkingStrategy } = require('./no-chunking')
const { fixedSizeStrategy } = require('./fixed-size')
const { recursiveStrategy } = require('./recursive')
const { parentChildStrategy } = require('./parent-child')
const { selectStrategy } = require('./select-strategy')
const config = require('./config')

const STRATEGIES = {
  no_chunking: noChunkingStrategy(),
  fixed_size: fixedSizeStrategy(),
  recursive: recursiveStrategy(),
  parent_child: parentChildStrategy(),
}

function getStrategy(name) {
  const strategy = STRATEGIES[name]
  if (!strategy) throw new Error(`unknown chunking strategy "${name}"`)
  return strategy
}

module.exports = { getStrategy, selectStrategy, STRATEGIES, config }
