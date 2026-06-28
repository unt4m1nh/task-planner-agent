// Pragmatic sentence segmentation: splits after .?! followed by whitespace and
// an uppercase/digit/quote (a likely sentence start), or on a newline. Misses
// abbreviations like "Mr. Smith" and prose with no terminal punctuation —
// acceptable for this project's corpora (uploaded docs, daily-planner logs),
// not a general-purpose sentence boundary detector.
const SENTENCE_BOUNDARY = /(?<=[.?!])\s+(?=[A-ZĐ0-9"'(])|\n+/

function splitSentences(text) {
  return text.split(SENTENCE_BOUNDARY).map(s => s.trim()).filter(Boolean)
}

module.exports = { splitSentences }
