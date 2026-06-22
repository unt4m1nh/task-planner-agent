function hasEditFields(slots) {
  const hasFields = slots.fields && typeof slots.fields === 'object' && Object.keys(slots.fields).length > 0
  const hasAppend = slots.append?.field && slots.append?.value
  return hasFields || hasAppend
}

function validateTodoSlots(slots) {
  if (!slots?.intent) return { ok: false, question: 'What would you like to do?', missingSlot: 'intent' }

  switch (slots.intent) {
    case 'add':
      if (!slots.title) return { ok: false, question: 'What should the new task be called?', missingSlot: 'title' }
      break
    case 'read':
      if (!slots.id) return { ok: false, question: 'Which task? Please provide its ID.', missingSlot: 'id' }
      break
    case 'edit':
      if (!slots.id) return { ok: false, question: 'Which task do you want to edit?', missingSlot: 'id' }
      if (!hasEditFields(slots)) return { ok: false, question: 'What changes should I make?', missingSlot: 'fields' }
      break
    case 'delete':
      if (!slots.id) return { ok: false, question: 'Which task should I delete? Please provide its ID.', missingSlot: 'id' }
      break
  }

  return { ok: true }
}

function isDestructive(slots) {
  return slots?.intent === 'delete' || slots?.intent === 'edit'
}

function describeAction(slots) {
  switch (slots?.intent) {
    case 'edit':   return `Edit task [${slots.id}]?`
    case 'delete': return `Permanently delete task [${slots.id}]?`
    default:       return `Proceed with ${slots?.intent}?`
  }
}

module.exports = { validateTodoSlots, isDestructive, describeAction }
