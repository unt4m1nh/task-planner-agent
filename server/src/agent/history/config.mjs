export default {
  windowSize: 8,           // turns injected into classify() as recent-conversation context
  maxContentChars: 4000,   // hard cap per turn's stored content (defensive, not expected to trip)
  titleMaxChars: 60,       // derived session title length, from the first user turn
}
