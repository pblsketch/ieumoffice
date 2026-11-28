declare module '*.hwp?url' {
  const url: string
  export default url
}

declare module '*.svg' {
  const url: string
  export default url
}

declare module '../hwp/scripts/rhwp-patches.mjs' {
  export function rhwpPatches(...names: string[]): unknown
}

declare module '../scripts/apply-native-config.mjs' {
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
}
