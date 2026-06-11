# CLAUDE.md (client)

Package-specific notes for the frontend. See the root `CLAUDE.md` for overall
architecture and how the client is expected to talk to the backend
(`POST /api/chat` only — no `GET /api/tasks`).

## Commands (run from `todo-agent/client/client/`)

```bash
npm run dev        # Start Vite dev server with HMR
npm run build      # Type-check (tsc -b) then Vite build
npm run lint       # ESLint
npm run preview    # Preview production build
```

## Conventions

- ESM + TypeScript, standard Vite + React 19 setup
- Entry point `src/main.tsx`, root component `src/App.tsx`
- ESLint configured with `typescript-eslint`, `eslint-plugin-react-hooks`,
  `eslint-plugin-react-refresh`

## Status

Still the default Vite/React scaffold (`App.tsx` is the "Get started" demo).
The chat UI and API client (`lib/api.ts`) have not been built yet.
