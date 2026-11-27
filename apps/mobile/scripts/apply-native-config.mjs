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
  // Strip any template-generated FileProvider outside our managed markers so AndroidManifest.xml
  // does not declare two FileProvider entries with the same authority.
  const startMarker = '<!-- IEUM_MOBILE_NATIVE_CONFIG_START -->'
  const endMarker = '<!-- IEUM_MOBILE_NATIVE_CONFIG_END -->'
  const existingStart = manifest.indexOf(startMarker)
  const existingEnd = manifest.indexOf(endMarker)
  const stripTemplateProvider = (chunk) =>
    chunk.replace(
      /\s*<provider\b[^>]*android:name="androidx\.core\.content\.FileProvider"[\s\S]*?<\/provider>/g,
      '',
    )
  if (existingStart !== -1 && existingEnd !== -1 && existingEnd > existingStart) {
    manifest =
      stripTemplateProvider(manifest.slice(0, existingStart)) +
      manifest.slice(existingStart, existingEnd + endMarker.length) +
      stripTemplateProvider(manifest.slice(existingEnd + endMarker.length))
  } else {
    manifest = stripTemplateProvider(manifest)
  }
  manifest = replaceOrInsertBlock(
    manifest,
    startMarker,
    endMarker,
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

const PRIVACY_FILE_REF_ID = 'A1E011000000000000000001'
const PRIVACY_BUILD_FILE_ID = 'A1E011000000000000000002'

function findXcodeprojPbxproj(iosRoot) {
  for (const entry of readdirSync(iosRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith('.xcodeproj')) continue
    const candidate = join(iosRoot, entry.name, 'project.pbxproj')
    if (existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Idempotently adds PrivacyInfo.xcprivacy to the generated Xcode project's
 * file references, target group, and Resources build phase so archive builds
 * embed it at the root of the .app bundle.
 */
function wireIosPrivacyManifestInPbxproj(iosRoot, targetDirName) {
  const pbxPath = findXcodeprojPbxproj(iosRoot)
  if (!pbxPath) return { pbxprojPatched: false }

  let pbx = readFileSync(pbxPath, 'utf8')
  if (pbx.includes('PrivacyInfo.xcprivacy')) {
    return { pbxprojPatched: false, pbxPath }
  }

  const buildFileMarker = '/* Begin PBXBuildFile section */'
  const fileRefMarker = '/* Begin PBXFileReference section */'
  if (!pbx.includes(buildFileMarker) || !pbx.includes(fileRefMarker)) {
    throw new Error(`Unexpected project.pbxproj layout at ${pbxPath}`)
  }

  const buildFileEntry = `\t\t${PRIVACY_BUILD_FILE_ID} /* PrivacyInfo.xcprivacy in Resources */ = {isa = PBXBuildFile; fileRef = ${PRIVACY_FILE_REF_ID} /* PrivacyInfo.xcprivacy */; };`
  const fileRefEntry = `\t\t${PRIVACY_FILE_REF_ID} /* PrivacyInfo.xcprivacy */ = {isa = PBXFileReference; lastKnownFileType = text.xml; path = PrivacyInfo.xcprivacy; sourceTree = "<group>"; };`

  pbx = pbx.replace(buildFileMarker, `${buildFileMarker}\n${buildFileEntry}`)
  pbx = pbx.replace(fileRefMarker, `${fileRefMarker}\n${fileRefEntry}`)

  // Add the file reference to the group matching the Info.plist folder (or containing Info.plist).
  const groupPattern = new RegExp(
    `(isa = PBXGroup;[\\s\\S]*?children = \\()([\\s\\S]*?)(\\);[\\s\\S]*?path = "?${targetDirName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"?;)`,
  )
  if (groupPattern.test(pbx)) {
    pbx = pbx.replace(
      groupPattern,
      `$1\n\t\t\t\t${PRIVACY_FILE_REF_ID} /* PrivacyInfo.xcprivacy */,$2$3`,
    )
  } else {
    const fallbackGroup = /(isa = PBXGroup;[\s\S]*?children = \()([\s\S]*?Info\.plist[\s\S]*?)(\);)/
    if (fallbackGroup.test(pbx)) {
      pbx = pbx.replace(
        fallbackGroup,
        `$1\n\t\t\t\t${PRIVACY_FILE_REF_ID} /* PrivacyInfo.xcprivacy */,$2$3`,
      )
    }
  }

  // Add the build file to the first PBXResourcesBuildPhase so Xcode copies it into the .app bundle.
  const resourcesPhase = /(isa = PBXResourcesBuildPhase;[\s\S]*?files = \()/
  if (!resourcesPhase.test(pbx)) {
    throw new Error(`Could not locate PBXResourcesBuildPhase in ${pbxPath}`)
  }
  pbx = pbx.replace(
    resourcesPhase,
    `$1\n\t\t\t\t${PRIVACY_BUILD_FILE_ID} /* PrivacyInfo.xcprivacy in Resources */,`,
  )

  writeFileSync(pbxPath, pbx, 'utf8')
  return { pbxprojPatched: true, pbxPath }
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

  const targetDir = dirname(plistPath)
  const entitlementsOut = join(targetDir, 'IeumOfficeMobile.entitlements')
  copyFileSync(join(NATIVE_CONFIG, 'ios', 'Entitlements.plist'), entitlementsOut)

  const privacyManifestOut = join(targetDir, 'PrivacyInfo.xcprivacy')
  copyFileSync(join(NATIVE_CONFIG, 'ios', 'PrivacyInfo.xcprivacy'), privacyManifestOut)
  const targetDirName = targetDir.split(/[\\/]/).pop() ?? ''
  const { pbxprojPatched } = wireIosPrivacyManifestInPbxproj(iosRoot, targetDirName)

  return { applied: true, plistPath, entitlementsOut, privacyManifestOut, pbxprojPatched }
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
