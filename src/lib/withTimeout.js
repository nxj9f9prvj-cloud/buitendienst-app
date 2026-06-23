/**
 * Race a promise tegen een timeout — voorkomt oneindige loaders bij hangende netwerkcalls.
 */
export function withTimeout(promise, ms, label = 'Operatie') {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} duurde te lang (>${ms} ms)`)), ms)
    }),
  ])
}
