/**
 * The AI work the app's screens started that is running now, so the shell can
 * say how much is running and stop all of it (turning AI off in Settings).
 * One job is one AI chat turn receiving its answer (per tab), one running
 * translation or AI reading job, one generation of the create window, one run
 * of the agent window, or one answer of home's ask box. Work the terminal
 * command or MCP started is not registered here: it is neither counted nor
 * stopped.
 *
 * In-process and Electron-free: the shell and the editor mains share it
 * because they run in the same main process.
 */

export type AiJobKind = 'chat' | 'document-job' | 'generate' | 'agent' | 'home-ask'

export interface AiJob {
  kind: AiJobKind
  /** stop the job; may finish later, a throw counts as stopped */
  stop: () => void | Promise<unknown>
}

const jobs = new Set<AiJob>()
const listeners = new Set<(count: number) => void>()

function changed(): void {
  const count = jobs.size
  for (const listener of [...listeners]) {
    try {
      listener(count)
    } catch {
      // one listener's failure does not keep the others uninformed
    }
  }
}

/**
 * Register a running job. The returned handle unregisters it; call it when
 * the job ends however it ends. A second call does nothing.
 */
export function registerAiJob(job: AiJob): () => void {
  const entry: AiJob = { kind: job.kind, stop: job.stop }
  jobs.add(entry)
  changed()
  return () => {
    if (jobs.delete(entry)) changed()
  }
}

export function runningAiJobCount(): number {
  return jobs.size
}

/**
 * Stop every job running now and wait for their stops. Each job leaves the
 * registry once its stop settled, even when the job forgets to unregister.
 * A job registered while this runs is not stopped. Answers how many it stopped.
 */
export async function stopAllAiJobs(): Promise<number> {
  const running = [...jobs]
  await Promise.all(
    running.map(async (job) => {
      try {
        await job.stop()
      } catch {
        // a stop that throws still counts: the job is no longer wanted
      }
      if (jobs.delete(job)) changed()
    }),
  )
  return running.length
}

/** Hear the running count after every change; returns the unsubscribe */
export function onAiJobsChanged(listener: (count: number) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
