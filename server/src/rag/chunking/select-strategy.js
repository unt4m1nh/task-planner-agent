const { shortTextMax, minHeadings, longDocMin } = require('./config').selector

function countHeadings(text) {
  return (text.match(/^#{1,6}\s/gm) || []).length
}

// sourceType is `documents.source` as stored ("upload" | "planner_log" | ...).
// See DECISIONS.md for why this differs from the plan's "planning_log" naming.
function selectStrategy(sourceType, text, metadata = {}) {
  if (sourceType === 'planner_log') return 'no_chunking'

  const length = (text || '').trim().length
  if (length < shortTextMax) return 'no_chunking'

  const headings = metadata.sectionCount ?? countHeadings(text)
  if (headings >= minHeadings) return 'recursive'
  if (length > longDocMin && headings < minHeadings) return 'parent_child'

  return 'fixed_size'
}

module.exports = { selectStrategy, countHeadings }
