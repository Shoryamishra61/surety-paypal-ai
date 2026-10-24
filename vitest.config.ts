import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The process-race test forks real child processes against SQLite;
    // serializing files keeps it deterministic on busy machines and CI.
    fileParallelism: false,
  },
});
