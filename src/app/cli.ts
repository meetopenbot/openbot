#!/usr/bin/env node
import { Command } from 'commander';
import { bootstrap } from './bootstrap.js';
import { startServer } from './server.js';

const program = new Command();
const REQUIRED_NODE_VERSION = '20.12.0';

function checkNodeVersion() {
  const [major, minor, patch] = process.versions.node.split('.').map(Number);
  const [reqMajor, reqMinor, reqPatch] = REQUIRED_NODE_VERSION.split('.').map(Number);

  const isOld =
    major < reqMajor ||
    (major === reqMajor && minor < reqMinor) ||
    (major === reqMajor && minor === reqMinor && patch < reqPatch);

  if (isOld) {
    console.warn(`\n⚠️  WARNING: You are using Node.js ${process.version}.`);
    console.warn(`   OpenBot works best with Node.js >=${REQUIRED_NODE_VERSION}.`);
    console.warn(
      `   You may encounter "ERR_REQUIRE_ESM" or other compatibility issues on older versions.\n`,
    );
  }
}

checkNodeVersion();

program.name('openbot').description('OpenBot CLI').version('0.5.2');

program
  .command('start')
  .description('Start the OpenBot harness')
  .option('-p, --port <number>', 'Port to listen on')
  .action(async (options) => {
    await bootstrap();
    await startServer(options);
  });

program.parse();
