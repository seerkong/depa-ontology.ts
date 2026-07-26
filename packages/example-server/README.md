# Depa example server

Private Bun/Elysia example backend for the Depa ontology workspace. It consumes
CozoDB, ontology, and Datalog capabilities through the public
`depa-ontology@0.1.0` workspace package; it does not depend on the legacy
`cozo-lib-bun` package or a cross-repository `file:` dependency.

## Prerequisites

- [Bun](https://bun.sh) 1.0 or newer
- macOS on arm64 for the current `depa-cozo@0.1.0` native package
- Dependencies installed from the repository root with `npm install`

## Commands

Run these commands from the repository root:

```bash
npm run dev --workspace=depa-example-server
npm run start --workspace=depa-example-server
npm test --workspace=depa-example-server
```

`dev` starts the service with watch mode, `start` starts it normally, and
`test` runs its Bun tests. The service listens on
`http://127.0.0.1:4175`.

The server source and tests live under `src/`. This package is an example
application and remains private; it is not published to npm.
