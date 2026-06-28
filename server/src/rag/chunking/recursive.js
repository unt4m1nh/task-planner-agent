const { fixedSizeSplit } = require('./fixed-size')
const defaultConfig = require('./config').recursive

// Markdown-friendly separator hierarchy, largest natural boundary first.
// fixed_size (sentence-aware) is the terminal fallback once no separator
// helps anymore.
const SEPARATORS = [
  { name: 'heading', regex: /\n(?=#{1,6}\s)/, joinWith: '\n' },
  { name: 'paragraph', regex: /\n{2,}/, joinWith: '\n\n' },
  { name: 'line', regex: /\n/, joinWith: '\n' },
]

function splitAt(text, levelIndex, maxSize) {
  if (text.length <= maxSize) return [text]
  if (levelIndex >= SEPARATORS.length) {
    return fixedSizeSplit(text, { targetSize: maxSize, overlapSize: Math.round(maxSize * 0.15) })
  }

  const { regex, joinWith } = SEPARATORS[levelIndex]
  const pieces = text.split(regex).map(s => s.trim()).filter(Boolean)
  if (pieces.length <= 1) return splitAt(text, levelIndex + 1, maxSize)

  // Greedily re-merge sibling pieces back up to maxSize so a chunk only
  // straddles a boundary when both sides are already under the limit.
  const merged = []
  let buffer = ''
  for (const piece of pieces) {
    const candidate = buffer ? `${buffer}${joinWith}${piece}` : piece
    if (candidate.length <= maxSize) {
      buffer = candidate
      continue
    }
    if (buffer) merged.push(buffer)
    if (piece.length <= maxSize) {
      buffer = piece
    } else {
      merged.push(...splitAt(piece, levelIndex + 1, maxSize))
      buffer = ''
    }
  }
  if (buffer) merged.push(buffer)
  return merged
}

function recursiveSplit(text, { maxSize } = defaultConfig) {
  const trimmed = (text || '').trim()
  if (!trimmed) return []
  return splitAt(trimmed, 0, maxSize)
}

function recursiveStrategy(cfg) {
  return {
    name: 'recursive',
    chunk({ text }) {
      return recursiveSplit(text, cfg || defaultConfig).map(t => ({ text: t }))
    },
  }
}

module.exports = { recursiveSplit, recursiveStrategy, SEPARATORS }
