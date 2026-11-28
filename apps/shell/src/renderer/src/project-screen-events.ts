import type { ProjectFolderApi, ProjectId, ProjectScreenSection } from '@genoffice/project-store'

/** A request to show the screen at a project (and section), from `onOpenProjectScreen` */
export interface ProjectScreenRequest {
  projectId: ProjectId
  section?: ProjectScreenSection
  /** bumps on every request, so asking for the same project again still applies */
  seq: number
}

/**
 * Listen for "show the project screen" from main (an AI panel's "[view]").
 * Returns the unsubscribe function; a window without the bridge listens to nothing.
 */
export function subscribeProjectScreen(
  bridge: Pick<ProjectFolderApi, 'onOpenProjectScreen'> | null | undefined,
  onRequest: (request: ProjectScreenRequest) => void,
): () => void {
  if (!bridge || typeof bridge.onOpenProjectScreen !== 'function') return () => undefined
  let seq = 0
  return bridge.onOpenProjectScreen((event) => {
    seq += 1
    onRequest({
      projectId: event.projectId,
      ...(event.section ? { section: event.section } : {}),
      seq,
    })
  })
}
