const { splitSentences } = require('./sentences')
const defaultConfig = require('./config').fixedSize

// Greedily accumulates sentences up to targetSize, carrying back trailing
// sentences within overlapSize into the next chunk so an idea spanning a
// boundary survives on both sides. A single sentence longer than targetSize
// is hard-split — the only place a mid-sentence cut is allowed.
function fixedSizeSplit(text, { targetSize, overlapSize } = defaultConfig) {
  const sentences = splitSentences((text || '').trim())
  if (!sentences.length) return []

  const chunks = []
  let current = []
  let currentLen = 0

  const flush = () => {
    if (current.length) chunks.push(current.join(' '))
  }

  for (const sentence of sentences) {
    if (sentence.length > targetSize) {
      flush()
      current = []
      currentLen = 0
      const step = Math.max(1, targetSize - overlapSize)
      for (let i = 0; i < sentence.length; i += step) {
        chunks.push(sentence.slice(i, i + targetSize))
      }
      continue
    }

    const addedLen = sentence.length + (current.length ? 1 : 0)
    if (current.length && currentLen + addedLen > targetSize) {
      flush()
      const overlap = []
      let overlapLen = 0
      for (let i = current.length - 1; i >= 0; i--) {
        const candidateLen = current[i].length + (overlap.length ? 1 : 0)
        if (overlapLen + candidateLen > overlapSize) break
        overlap.unshift(current[i])
        overlapLen += candidateLen
      }
      current = overlap
      currentLen = overlapLen
    }

    currentLen += sentence.length + (current.length ? 1 : 0)
    current.push(sentence)
  }
  flush()

  return chunks.filter(Boolean)
}

function fixedSizeStrategy(cfg) {
  return {
    name: 'fixed_size',
    chunk({ text }) {
      return fixedSizeSplit(text, cfg || defaultConfig).map(t => ({ text: t }))
    },
  }
}

module.exports = { fixedSizeSplit, fixedSizeStrategy }
