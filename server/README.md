# 👋 Meet OpenBot

OpenBot is your personal AI assistant that's always ready to help! Built with **Melony**, it can chat, browse the web, and manage files—giving you a powerful, real-time sidekick right in your terminal.

## Get Started in Seconds

Installing your new assistant is easy:

```bash
npm i -g openbot
```

To start your assistant's server, just run:

```bash
openbot server
```

OpenBot will start listening for you at `http://localhost:4001`.

## Say Hello

You can talk to OpenBot using a simple POST request:

```bash
curl -N \
  -H "Content-Type: application/json" \
  -d '{"event":{"type":"user:text","data":{"content":"Hello!"}}}' \
  http://localhost:4001/api/chat
```

That's it! OpenBot will stream its response right back to you. 🚀
