const OLLAMA_EMBED_URL = 'http://localhost:11434/api/embed'
const EMBED_MODEL = process.env.RAG_EMBED_MODEL || 'bge-m3'

async function embed(texts) {
  const input = Array.isArray(texts) ? texts : [texts]
  const res = await fetch(OLLAMA_EMBED_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Ollama embeddings ${res.status}: ${text}`)
  }
  const data = await res.json()
  const vectors = data.embeddings
  if (!Array.isArray(vectors) || vectors.length !== input.length) {
    throw new Error('Ollama embeddings response did not match input length')
  }
  return Array.isArray(texts) ? vectors : vectors[0]
}

module.exports = { embed, EMBED_MODEL }
