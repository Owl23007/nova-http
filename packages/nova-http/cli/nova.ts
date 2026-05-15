#!/usr/bin/env node

import { runCli } from './shared';

void runCli(process.argv.slice(2), 'command');
