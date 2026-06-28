function noChunkingStrategy() {
  return {
    name: 'no_chunking',
    chunk({ text }) {
      const trimmed = (text || '').trim()
      return trimmed ? [{ text: trimmed }] : []
    },
  }
}

module.exports = { noChunkingStrategy }
