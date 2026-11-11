import type { Plugin } from 'vite'
export function patchPdfjsWorker(original: string, storage: string): string
export function buildSparsePdfWorker(): Promise<string>
export function sparsePdfWorkerPlugin(): Plugin
