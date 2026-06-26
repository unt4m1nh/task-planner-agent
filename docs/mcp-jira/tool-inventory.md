# MCP Atlassian — Tool Inventory

> Captured from `sooperset/mcp-atlassian` ~v0.21.1 via MCP Inspector.
> **Fill in after running P0 manual validation.**

## Tool list

| Tool name | Description |
|-----------|-------------|
| `jira_search` | Search issues via JQL |
| `jira_get_issue` | Get a single issue by key |
| `jira_create_issue` | Create a new issue |
| `jira_update_issue` | Update fields on an existing issue |
| `jira_get_transitions` | List available transitions for an issue |
| `jira_transition_issue` | Move an issue through a workflow transition |
| `jira_delete_issue` | Delete an issue permanently |

## Input schemas

> TODO: paste exact schemas from Inspector after P0 run.

### `jira_search`
```json
{
  "jql": "string",
  "max_results": "number (optional)"
}
```

### `jira_get_issue`
```json
{
  "issue_key": "string"
}
```

### `jira_create_issue`
```json
{
  "project_key": "string",
  "summary": "string",
  "issue_type": "string",
  "description": "string (optional)",
  "priority": "string (optional)",
  "assignee": "string (optional)"
}
```

### `jira_update_issue`
```json
{
  "issue_key": "string",
  "summary": "string (optional)",
  "description": "string (optional)",
  "priority": "string (optional)",
  "assignee": "string (optional)"
}
```

### `jira_get_transitions`
```json
{
  "issue_key": "string"
}
```

### `jira_transition_issue`
```json
{
  "issue_key": "string",
  "transition_id": "string"
}
```

### `jira_delete_issue`
```json
{
  "issue_key": "string"
}
```
