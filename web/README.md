# @melony/studio

A local UI for interacting with and debugging Melony agents.

## Usage

You can run the studio directly using npx:

```bash
npx @melony/studio
```

### Options

- `-p, --port <port>`: Port to run the studio on (default: 4000)
- `-u, --url <url>`: Agent server BASE_URL (default: http://localhost:4001)

## Development

1. Install dependencies:
```bash
pnpm install
```

2. Build the studio:
```bash
pnpm build
```

3. Run locally:
```bash
node dist/cli.js
```
