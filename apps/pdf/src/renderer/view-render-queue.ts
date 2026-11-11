export interface ViewRenderJob<T> {
  promise: Promise<T>
  cancel(): void
}

interface PendingJob {
  thumbnail: boolean
  started: boolean
  start(): void
  reject(error: Error): void
}

/** Admit a small working set; obsolete pages never reach the native worker. */
export class ViewRenderQueue {
  private active = 0
  private pending: PendingJob[] = []

  constructor(private readonly concurrency = 2) {}

  schedule<T>(run: () => Promise<T>, thumbnail = false): ViewRenderJob<T> {
    let job!: PendingJob
    const promise = new Promise<T>((resolve, reject) => {
      job = {
        thumbnail,
        started: false,
        reject,
        start: () => {
          job.started = true
          this.active++
          try {
            void run()
              .then(resolve, reject)
              .finally(() => {
                this.active--
                this.pump()
              })
          } catch (error) {
            reject(error)
            this.active--
            this.pump()
          }
        },
      }
      this.pending.push(job)
      this.pump()
    })
    return {
      promise,
      cancel: () => {
        if (job.started) return
        this.pending = this.pending.filter((item) => item !== job)
        job.reject(new Error('pdf: view render cancelled'))
      },
    }
  }

  private pump(): void {
    while (this.active < this.concurrency && this.pending.length) {
      const visible = this.pending.findIndex((job) => !job.thumbnail)
      this.pending.splice(visible < 0 ? 0 : visible, 1)[0]!.start()
    }
  }
}
