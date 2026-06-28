const { recursiveSplit } = require('./recursive')
const { fixedSizeSplit } = require('./fixed-size')
const defaultConfig = require('./config').parentChild

// Parents: coarse, section-sized pieces via recursive (for context).
// Children: small pieces via fixed_size, one batch per parent (for matching).
// parentLocalId links a child to its parent within this single chunk() call —
// the ingestion writer resolves it to a real parent_id FK after inserting parents.
function parentChildSplit(text, cfg = defaultConfig) {
  const parents = recursiveSplit(text, { maxSize: cfg.parentMaxSize })
  const produced = []

  parents.forEach((parentText, parentLocalId) => {
    produced.push({ text: parentText, isParent: true, parentLocalId })
    const children = fixedSizeSplit(parentText, {
      targetSize: cfg.childTargetSize,
      overlapSize: cfg.childOverlapSize,
    })
    children.forEach(childText => {
      produced.push({ text: childText, parentLocalId })
    })
  })

  return produced
}

function parentChildStrategy(cfg) {
  return {
    name: 'parent_child',
    chunk({ text }) {
      return parentChildSplit(text, cfg || defaultConfig)
    },
  }
}

module.exports = { parentChildSplit, parentChildStrategy }
