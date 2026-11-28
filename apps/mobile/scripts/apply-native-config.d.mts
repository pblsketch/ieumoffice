export function applyAndroidConfig(genRoot?: string): {
  applied: boolean
  manifestPath?: string
  reason?: string
}

export function applyIosConfig(genRoot?: string): {
  applied: boolean
  plistPath?: string
  entitlementsOut?: string
  reason?: string
}
