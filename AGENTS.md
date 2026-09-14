# Connect Four booth app

- Next.js App Router, TypeScript, Tailwind; npm and package-lock.json are canonical.
- Read relevant installed Next.js guides in node_modules/next/dist/docs before changing routing or server APIs.
- Keep Platform API and Keycloak traffic in server-only modules. Never expose credentials through NEXT_PUBLIC variables or logs.
- The AppThrust actor owns game state. Matchmaking and the wall are single-process booth indexes, not durable storage.
- Match JSON uses version 1, six rows with row zero at the bottom, seven columns, and seats 1/2. Keep the development mock aligned with the actor contract.
- Verify with npm run lint, npm run build, and the real two-cookie mock flow in README.md. Keep mobile controls and reduced-motion support.
