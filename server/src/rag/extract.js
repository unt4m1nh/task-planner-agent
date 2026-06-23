const { PDFParse } = require('pdf-parse')
const mammoth = require('mammoth')

async function extractPdf(buffer) {
  const parser = new PDFParse({ data: buffer })
  try {
    const { text } = await parser.getText()
    return text
  } finally {
    await parser.destroy()
  }
}

async function extractDocx(buffer) {
  const { value } = await mammoth.extractRawText({ buffer })
  return value
}

// Dispatches on file extension — the only signal we get from a multipart upload.
async function extractText(buffer, filename) {
  const ext = (filename || '').toLowerCase().split('.').pop()
  if (ext === 'pdf') return extractPdf(buffer)
  if (ext === 'docx') return extractDocx(buffer)
  throw new Error(`unsupported file type "${ext}" — only .pdf and .docx are supported`)
}

module.exports = { extractText }
