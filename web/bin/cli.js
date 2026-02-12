#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import sirv from 'sirv';
import http from 'node:http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, '../dist');

const port = process.env.PORT || 3000;
const assets = sirv(distPath, {
  maxAge: 31536000, // 1Y
  immutable: true,
  single: true,
});

const server = http.createServer((req, res) => {
  assets(req, res);
});

server.listen(port, (err) => {
  if (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
  const url = `http://localhost:${port}`;
  console.log(`> OpenBot Web ready at ${url}`);
  
  // Automatically open the browser
  const start = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${start} ${url}`);
});
