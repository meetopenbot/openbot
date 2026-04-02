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

You can start a run with a simple POST request:

```bash
curl \
  -H "Content-Type: application/json" \
  -H "x-openbot-conversation-id: dm_default" \
  -d '{"type":"agent:input","data":{"content":"Hello!"}}' \
  http://localhost:4001/api/runs
```

Then subscribe to live updates:

```bash
curl -N http://localhost:4001/api/conversations/dm_default/stream
```

That's it! OpenBot keeps running in the background and the stream can reconnect. 🚀
