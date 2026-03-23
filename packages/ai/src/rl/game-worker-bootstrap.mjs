/**
 * Bootstrap for game-worker in worker threads.
 * Uses tsx's tsImport to dynamically load the TS worker.
 */
import { tsImport } from 'tsx/esm/api';

await tsImport('./game-worker.ts', import.meta.url);
