const MAX_CHARS = 1200
const OVERLAP = 150

function chunkText(text, { maxChars = MAX_CHARS, overlap = OVERLAP } = {}) {
  const clean = text.trim()
  if (!clean) return []
  if (clean.length <= maxChars) return [clean]

  const paragraphs = clean.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
  const chunks = []
  let current = ''

  for (const para of paragraphs) {
    const candidate = current ? `${current}\n\n${para}` : para
    if (candidate.length <= maxChars) {
      current = candidate
      continue
    }
    if (current) chunks.push(current)
    if (para.length <= maxChars) {
      current = para
    } else {
      for (let i = 0; i < para.length; i += maxChars - overlap) {
        chunks.push(para.slice(i, i + maxChars))
      }
      current = ''
    }
  }
  if (current) chunks.push(current)

  return chunks
}

module.exports = { chunkText }
