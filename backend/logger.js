const serializeError = (error) => {
  if (!error) return undefined;
  return {
    name: error.name,
    message: error.message,
    stack: error.stack
  };
};

const write = (level, message, fields = {}) => {
  const payload = {
    time: new Date().toISOString(),
    level,
    message,
    ...fields
  };

  if (payload.error instanceof Error) {
    payload.error = serializeError(payload.error);
  }

  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
};

export const logger = {
  info: (message, fields) => write('info', message, fields),
  warn: (message, fields) => write('warn', message, fields),
  error: (message, fields) => write('error', message, fields)
};
