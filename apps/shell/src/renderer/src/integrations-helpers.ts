import type { IntegrationsStatus } from '../../shared/integrations-api'

/** some detected assistant holds an older copy of the skill than the bundled one */
export const skillUpdateDue = (s: IntegrationsStatus): boolean =>
  s.agents.some((a) => a.state.older === true)
