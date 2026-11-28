#!/usr/bin/env node
/**
 * Deterministically (idempotently) injects IeumOffice Mobile Android and iOS
 * native configuration into Tauri's generated `src-tauri/gen/android` and
 * `src-tauri/gen/apple` projects after `tauri android init --ci` / `tauri ios init --ci`.
 */
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP_DIR = resolve(HERE, '..')
const NATIVE_CONFIG = join(APP_DIR, 'native-config')
const GEN_DIR = join(APP_DIR, 'src-tauri', 'gen')

function replaceOrInsertBlock(content, startMarker, endMarker, block, anchorRegex) {
  const startIdx = content.indexOf(startMarker)
  const endIdx = content.indexOf(endMarker)
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return content.slice(0, startIdx) + block.trim() + content.slice(endIdx + endMarker.length)
  }
  const match = anchorRegex.exec(content)
  if (!match) {
    throw new Error(`Could not locate anchor ${anchorRegex} for native config injection.`)
  }
  return content.slice(0, match.index) + block.trim() + '\n' + content.slice(match.index)
}

const GRADLE_SIGNING_BLOCK = `// IEUM_MOBILE_GRADLE_SIGNING_START
android {
    val ieumVersionCode = System.getenv("IEUM_ANDROID_VERSION_CODE")?.toIntOrNull()
    if (ieumVersionCode != null && ieumVersionCode > 0) {
        defaultConfig {
            versionCode = ieumVersionCode
        }
    }
    val ieumKeystorePath = System.getenv("ANDROID_KEYSTORE_PATH")
    val ieumKeystorePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
    val ieumKeyAlias = System.getenv("ANDROID_KEY_ALIAS")
    val ieumKeyPassword = System.getenv("ANDROID_KEY_PASSWORD")
    if (
        !ieumKeystorePath.isNullOrBlank() &&
        !ieumKeystorePassword.isNullOrBlank() &&
        !ieumKeyAlias.isNullOrBlank() &&
        !ieumKeyPassword.isNullOrBlank() &&
        file(ieumKeystorePath).exists()
    ) {
        signingConfigs {
            create("release") {
                storeFile = file(ieumKeystorePath)
                storePassword = ieumKeystorePassword
                keyAlias = ieumKeyAlias
                keyPassword = ieumKeyPassword
            }
        }
        buildTypes {
            getByName("release") {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }
}
// IEUM_MOBILE_GRADLE_SIGNING_END`

export function applyAndroidConfig(genRoot = GEN_DIR) {
  const androidAppDir = join(genRoot, 'android', 'app')
  const androidAppMain = join(androidAppDir, 'src', 'main')
  const manifestPath = join(androidAppMain, 'AndroidManifest.xml')
  if (!existsSync(manifestPath)) {
    return { applied: false, reason: 'gen/android not initialized' }
  }

  const xmlDir = join(androidAppMain, 'res', 'xml')
  mkdirSync(xmlDir, { recursive: true })
  copyFileSync(join(NATIVE_CONFIG, 'android', 'file_paths.xml'), join(xmlDir, 'file_paths.xml'))

  // Replace Tauri's default launcher icons with IeumOffice adaptive/legacy icons.
  const brandResSrc = join(NATIVE_CONFIG, 'android', 'res')
  const androidResDest = join(androidAppMain, 'res')
  if (existsSync(brandResSrc)) {
    cpSync(brandResSrc, androidResDest, { recursive: true, force: true })
    // Remove Tauri's default vector foreground so Android loads our @mipmap/ic_launcher_foreground.
    const defaultVectorFg = join(androidResDest, 'drawable-v24', 'ic_launcher_foreground.xml')
    if (existsSync(defaultVectorFg)) {
      rmSync(defaultVectorFg, { force: true })
    }
  }

  const providerBlock = readFileSync(
    join(NATIVE_CONFIG, 'android', 'provider-fragment.xml'),
    'utf8',
  )
  const intentBlock = readFileSync(
    join(NATIVE_CONFIG, 'android', 'intent-filters-fragment.xml'),
    'utf8',
  )

  let manifest = readFileSync(manifestPath, 'utf8')
  manifest = replaceOrInsertBlock(
    manifest,
    '<!-- IEUM_MOBILE_INTENT_FILTERS_START -->',
    '<!-- IEUM_MOBILE_INTENT_FILTERS_END -->',
    intentBlock,
    /<\/activity>/,
  )
  manifest = replaceOrInsertBlock(
    manifest,
    '<!-- IEUM_MOBILE_NATIVE_CONFIG_START -->',
    '<!-- IEUM_MOBILE_NATIVE_CONFIG_END -->',
    providerBlock,
    /<\/application>/,
  )
  writeFileSync(manifestPath, manifest, 'utf8')

  // Inject env-driven release signing & versionCode override into Gradle when present.
  const gradlePath = join(androidAppDir, 'build.gradle.kts')
  if (existsSync(gradlePath)) {
    let gradle = readFileSync(gradlePath, 'utf8')
    const anchor = /apply\s*\(\s*from\s*=\s*file\("tauri\.build\.gradle\.kts"\)\s*\)/
    if (gradle.includes('// IEUM_MOBILE_GRADLE_SIGNING_START') || anchor.test(gradle)) {
      gradle = replaceOrInsertBlock(
        gradle,
        '// IEUM_MOBILE_GRADLE_SIGNING_START',
        '// IEUM_MOBILE_GRADLE_SIGNING_END',
        GRADLE_SIGNING_BLOCK,
        anchor,
      )
    } else {
      gradle = `${gradle.trimEnd()}\n\n${GRADLE_SIGNING_BLOCK}\n`
    }
    writeFileSync(gradlePath, gradle, 'utf8')
  }

  return { applied: true, manifestPath, gradlePatched: existsSync(gradlePath) }
}

function findIosInfoPlist(iosRoot) {
  const direct = join(iosRoot, 'Info.plist')
  if (existsSync(direct)) return direct
  for (const entry of readdirSync(iosRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const candidate = join(iosRoot, entry.name, 'Info.plist')
    if (existsSync(candidate)) return candidate
  }
  return null
}

export function applyIosConfig(genRoot = GEN_DIR) {
  // Tauri 2 `tauri ios init --ci` outputs under `src-tauri/gen/apple/`.
  const appleRoot = join(genRoot, 'apple')
  const legacyIosRoot = join(genRoot, 'ios')
  const iosRoot = existsSync(appleRoot)
    ? appleRoot
    : existsSync(legacyIosRoot)
      ? legacyIosRoot
      : null
  if (!iosRoot) {
    return { applied: false, reason: 'gen/apple (or gen/ios) not initialized' }
  }

  const plistPath = findIosInfoPlist(iosRoot)
  if (!plistPath) {
    return { applied: false, reason: `Info.plist not found under ${iosRoot}` }
  }

  const fragment = readFileSync(join(NATIVE_CONFIG, 'ios', 'Info-fragment.plist'), 'utf8')
  let plist = readFileSync(plistPath, 'utf8')
  if (plist.includes('NSLocalNetworkUsageDescription')) {
    throw new Error('NSLocalNetworkUsageDescription must not be present in Cycle 1 iOS Info.plist')
  }
  plist = replaceOrInsertBlock(
    plist,
    '<!-- IEUM_MOBILE_IOS_PLIST_START -->',
    '<!-- IEUM_MOBILE_IOS_PLIST_END -->',
    fragment,
    /<\/dict>\s*<\/plist>/,
  )
  writeFileSync(plistPath, plist, 'utf8')

  const entitlementsOut = join(dirname(plistPath), 'IeumOfficeMobile.entitlements')
  copyFileSync(join(NATIVE_CONFIG, 'ios', 'Entitlements.plist'), entitlementsOut)
  return { applied: true, plistPath, entitlementsOut }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const target = process.argv[2] ?? 'all'
  const results = {}
  if (target === 'all' || target === 'android') {
    results.android = applyAndroidConfig()
  }
  if (target === 'all' || target === 'ios') {
    results.ios = applyIosConfig()
  }
  console.log(JSON.stringify(results, null, 2))
  if (target === 'android' && !results.android?.applied) {
    console.error(`Android native config injection failed: ${results.android?.reason}`)
    process.exit(1)
  }
  if (target === 'ios' && !results.ios?.applied) {
    console.error(`iOS native config injection failed: ${results.ios?.reason}`)
    process.exit(1)
  }
}
