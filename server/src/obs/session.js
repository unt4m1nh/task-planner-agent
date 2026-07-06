'use strict'
const { AsyncLocalStorage } = require('async_hooks')
const als = new AsyncLocalStorage()
module.exports = { als }
