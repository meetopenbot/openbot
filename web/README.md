# 🌐 openbot-web

The official web interface for OpenBot. A high-performance, real-time dashboard for interacting with and debugging your AI agents.

## 🚀 Usage

You can launch the web interface directly using npx:

```bash
npx openbot-web
```

By default, it looks for an OpenBot server running at `http://localhost:4001`.

### Configuration

- `PORT`: Environment variable to change the listening port (default: 3000).
- `MELONY_BASE_URL`: Environment variable to point the web UI to a different agent server (default: http://localhost:4001).

## 🛠️ Development

If you want to contribute or run the web interface from source:

1. **Install dependencies**:
   ```bash
   pnpm install
   ```

2. **Run in development mode**:
   ```bash
   pnpm dev
   ```

3. **Build for production**:
   ```bash
   pnpm build
   ```

4. **Run production build locally**:
   ```bash
   node bin/cli.js
   ```

---

Powered by [Melony](https://github.com/melony-framework/melony) 🍈
