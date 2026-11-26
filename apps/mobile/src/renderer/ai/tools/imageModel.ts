/**
 * The model a generate_image request names, judged against the image route
 * already chosen in settings. Same rule as PC keyImageModelChoice
 * (packages/ai-search/src/image-model.ts, which imports the Node-only package
 * root): the provider's catalog models and its saved image model are served,
 * compared trimmed and without case, in their listed spelling; another
 * provider's catalog model and an unknown name are refused. A name never moves
 * the request to another provider.
 */
import { AI_MEDIA_PROVIDERS } from '@genoffice/ai-provider/browser'

export type MobileImageModelChoice =
  | { readonly kind: 'use'; readonly model: string }
  | { readonly kind: 'refuse'; readonly message: string }

function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

function listed(name: string, models: readonly string[]): string | undefined {
  return models.find((model) => same(model, name))
}

function modelsSentence(route: string, models: readonly string[]): string {
  return models.length > 0
    ? ` Models the current image route (${route}) can use: ${models.join(', ')}.`
    : ` The current image route (${route}) lists no models to choose from.`
}

export function mobileImageModelChoice(
  requested: unknown,
  provider: string,
  savedModel: string,
): MobileImageModelChoice {
  const name = typeof requested === 'string' ? requested.trim() : ''
  const stored = savedModel.trim()
  if (!name) return { kind: 'use', model: stored }
  const meta = AI_MEDIA_PROVIDERS.find((m) => m.id === provider)
  const own = [...new Set([...(stored ? [stored] : []), ...(meta?.imageModels ?? [])])]
  const match = listed(name, own)
  if (match) return { kind: 'use', model: match }
  const route = meta?.label ?? provider
  const owner = AI_MEDIA_PROVIDERS.find(
    (m) => m.id !== provider && !!m.imageProtocol && listed(name, m.imageModels) !== undefined,
  )
  return {
    kind: 'refuse',
    message: owner
      ? `The image model "${name}" belongs to ${owner.label}, which is not the image route in use, so no image was made.` +
        ' The image provider is changed under Settings > AI.' +
        modelsSentence(route, own)
      : `The image model "${name}" is not available on the current image route, so no image was made.` +
        modelsSentence(route, own),
  }
}
