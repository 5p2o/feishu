'use strict';

const PREFIX = '[feishu-forward]';

function stringify(details) {
  if (details === undefined || details === null) return '';
  try {
    return ' ' + JSON.stringify(details);
  } catch {
    return '';
  }
}

function info(message, details) {
  console.log(PREFIX + ' INFO ' + message + stringify(details));
}

function warn(message, details) {
  console.warn(PREFIX + ' WARN ' + message + stringify(details));
}

function error(message, details) {
  console.error(PREFIX + ' ERROR ' + message + stringify(details));
}

module.exports = { info, warn, error };
