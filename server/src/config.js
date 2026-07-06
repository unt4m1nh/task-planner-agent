'use strict'
// Central config — eval scripts and CJS tooling access these values here.
// guardrails.mjs keeps its own CONFIG copy but honours the same env vars.
module.exports = {
  rag: {
    MAX_ITERATIONS: parseInt(process.env.RAG_MAX_ITERATIONS || '2', 10),
    SIMILARITY_THRESHOLD: parseFloat(process.env.RAG_SIMILARITY_THRESHOLD || '0.8'),
  },
  eval: {
    JUDGE_MODEL: process.env.EVAL_JUDGE_MODEL || 'gemini-2.5-flash',
  },
}
