#!/usr/bin/env node

import { main } from './install.js';

main().catch((error) => {
  console.error('Installation failed: ' + error.message);
  process.exitCode = 1;
});