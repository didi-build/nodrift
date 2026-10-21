export function writeStdout(text: string): Promise<void> {
  if (text.length === 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    process.stdout.write(text, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

export function writeStderr(text: string): Promise<void> {
  if (text.length === 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    process.stderr.write(text, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}
