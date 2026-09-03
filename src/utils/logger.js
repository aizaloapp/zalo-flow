/**
 * Structured Logger for Zalo-Flow
 */

function formatTimestamp() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

export const logger = {
  info: (msg, ...args) => {
    console.log(`[\x1b[36m${formatTimestamp()}\x1b[0m] [\x1b[32mINFO\x1b[0m] ${msg}`, ...args);
  },
  warn: (msg, ...args) => {
    console.warn(`[\x1b[36m${formatTimestamp()}\x1b[0m] [\x1b[33mWARN\x1b[0m] ${msg}`, ...args);
  },
  error: (msg, ...args) => {
    console.error(`[\x1b[36m${formatTimestamp()}\x1b[0m] [\x1b[31mERROR\x1b[0m] ${msg}`, ...args);
  },
  debug: (msg, ...args) => {
    if (process.env.DEBUG === 'true') {
      console.log(`[\x1b[36m${formatTimestamp()}\x1b[0m] [\x1b[35mDEBUG\x1b[0m] ${msg}`, ...args);
    }
  }
};
