/**
 * @typedef {Object} JiraIssue
 * @property {string} id
 * @property {string} key
 * @property {string} summary
 * @property {string|null} description
 * @property {string} status        - e.g. "To Do", "In Progress", "Done"
 * @property {string} issueType     - e.g. "Story", "Bug", "Task"
 * @property {string|null} priority - e.g. "High", "Medium", "Low"
 * @property {string|null} assignee - display name
 * @property {string|null} dueDate  - ISO date string or null
 * @property {string} createdAt     - ISO datetime string
 * @property {string} updatedAt     - ISO datetime string
 * @property {string} url           - browse URL for the issue
 */

/**
 * @typedef {Object} CreateIssueInput
 * @property {string} projectKey
 * @property {string} summary
 * @property {string} [issueType]   - defaults to "Task"
 * @property {string} [description]
 * @property {string} [priority]
 * @property {string} [assignee]    - account ID or display name
 */

/**
 * @typedef {Object} UpdateIssueInput
 * @property {string} [summary]
 * @property {string} [description]
 * @property {string} [priority]
 * @property {string} [assignee]
 */

module.exports = {}
