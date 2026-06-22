const Database = require('better-sqlite3');
const db = new Database('agent_vector.db', { verbose: console.log });