import type { NodeObj } from 'mind-elixir'
import type { MapController } from './map/controller'

/** Requests the shell relays from the CLI's open and selection commands. */
export type ControlRequest = { cmd: 'goto'; target: { kind: string } } | { cmd: 'selection' }

export type ControlReply =
  | { status: 'ok'; result: Record<string, unknown> }
  | { status: 'not_ready' }
  | { status: 'error'; error: { reason: string; message: string } }

export interface MindmapControlState {
  status: 'loading' | 'ready' | 'failed' | 'error'
  controller: MapController | null
}

/** Reads only the active sheet's selected topics; it never saves the map. */
export function handleMindmapControl(
  req: ControlRequest,
  state: MindmapControlState,
): ControlReply {
  if (state.status === 'loading') return { status: 'not_ready' }
  if (state.status !== 'ready') {
    return {
      status: 'error',
      error: { reason: 'app_unavailable', message: 'the map could not be opened' },
    }
  }
  if (req.cmd !== 'selection') {
    return {
      status: 'error',
      error: { reason: 'unsupported', message: 'mind maps do not support a navigation target' },
    }
  }
  const map = state.controller
  if (!map) return { status: 'not_ready' }
  // As with the other map reads, include a title still being typed before reading it.
  map.commitEdit()
  const topics = map.selectedTopicIds().flatMap((id) => {
    const node = map.mind.getObjById(id, map.mind.nodeData)
    if (!node) return []
    const path: string[] = []
    for (let up: NodeObj | undefined = node; up; up = up.parent) path.push(up.topic)
    return [{ id: node.id, title: node.topic, path: path.reverse() }]
  })
  const sheet = map.sheetTitle
  return { status: 'ok', result: topics.length ? { sheet, topics } : { none: true, sheet } }
}
