import { describe, expect, it } from 'vitest'
import { applyIosConfig } from '../scripts/apply-native-config.mjs'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const NATIVE_CONFIG = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'native-config')

const SAMPLE_PBXPROJ = `// !$*UTF8*$!
{
\tobjects = {
/* Begin PBXBuildFile section */
\t\t111111111111111111111111 /* Assets.xcassets in Resources */ = {isa = PBXBuildFile; fileRef = 222222222222222222222222 /* Assets.xcassets */; };
/* End PBXBuildFile section */
/* Begin PBXFileReference section */
\t\t222222222222222222222222 /* Assets.xcassets */ = {isa = PBXFileReference; lastKnownFileType = folder.assetcatalog; path = Assets.xcassets; sourceTree = "<group>"; };
\t\t333333333333333333333333 /* Info.plist */ = {isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = "<group>"; };
/* End PBXFileReference section */
/* Begin PBXGroup section */
\t\t444444444444444444444444 /* ieumoffice-mobile_iOS */ = {
\t\t\tisa = PBXGroup;
\t\t\tchildren = (
\t\t\t\t333333333333333333333333 /* Info.plist */,
\t\t\t);
\t\t\tpath = "ieumoffice-mobile_iOS";
\t\t\tsourceTree = "<group>";
\t\t};
/* End PBXGroup section */
/* Begin PBXResourcesBuildPhase section */
\t\t555555555555555555555555 /* Resources */ = {
\t\t\tisa = PBXResourcesBuildPhase;
\t\t\tbuildActionMask = 2147483647;
\t\t\tfiles = (
\t\t\t\t111111111111111111111111 /* Assets.xcassets in Resources */,
\t\t\t);
\t\t\trunOnlyForDeploymentPostprocessing = 0;
\t\t};
/* End PBXResourcesBuildPhase section */
\t};
}
`

describe('store readiness native config', () => {
  describe('iOS PrivacyInfo.xcprivacy', () => {
    it('declares no tracking, no collected data types, and FileTimestamp required reasons', () => {
      const xml = readFileSync(join(NATIVE_CONFIG, 'ios', 'PrivacyInfo.xcprivacy'), 'utf8')
      expect(xml).toContain('<key>NSPrivacyTracking</key>')
      expect(xml).toContain('<false/>')
      expect(xml).toContain('<key>NSPrivacyTrackingDomains</key>')
      expect(xml).toContain('<key>NSPrivacyCollectedDataTypes</key>')
      expect(xml).toContain('<string>NSPrivacyAccessedAPICategoryFileTimestamp</string>')
      expect(xml).toContain('<string>C617.1</string>')
      expect(xml).toContain('<string>3B52.1</string>')
      expect(xml).toContain('<string>DDA9.1</string>')
    })

    it('copies PrivacyInfo.xcprivacy and wires it into project.pbxproj idempotently', () => {
      const tmp = mkdtempSync(join(tmpdir(), 'ieum-ios-privacy-'))
      try {
        const appleRoot = join(tmp, 'apple')
        const iosApp = join(appleRoot, 'ieumoffice-mobile_iOS')
        const xcodeproj = join(appleRoot, 'ieumoffice-mobile.xcodeproj')
        mkdirSync(iosApp, { recursive: true })
        mkdirSync(xcodeproj, { recursive: true })
        writeFileSync(
          join(iosApp, 'Info.plist'),
          '<?xml version="1.0"?><plist version="1.0"><dict>\n  <key>CFBundleName</key>\n  <string>IeumOffice</string>\n</dict>\n</plist>',
          'utf8',
        )
        const pbxPath = join(xcodeproj, 'project.pbxproj')
        writeFileSync(pbxPath, SAMPLE_PBXPROJ, 'utf8')

        const r1 = applyIosConfig(tmp)
        const r2 = applyIosConfig(tmp)
        expect(r1.applied).toBe(true)
        expect(r2.applied).toBe(true)
        expect(existsSync(join(iosApp, 'PrivacyInfo.xcprivacy'))).toBe(true)

        const pbx = readFileSync(pbxPath, 'utf8')
        expect(pbx.match(/PrivacyInfo\.xcprivacy in Resources/g)?.length).toBe(2)
        expect(pbx.match(/isa = PBXFileReference;[^}]*PrivacyInfo\.xcprivacy/g)?.length).toBe(1)
        expect(pbx.match(/isa = PBXBuildFile;[^}]*PrivacyInfo\.xcprivacy/g)?.length).toBe(1)
      } finally {
        rmSync(tmp, { recursive: true, force: true })
      }
    })
  })

  describe('unused v1 App Links and Associated Domains', () => {
    it('omits associated-domains from iOS Entitlements.plist', () => {
      const entitlements = readFileSync(join(NATIVE_CONFIG, 'ios', 'Entitlements.plist'), 'utf8')
      expect(entitlements).not.toContain('com.apple.developer.associated-domains')
      expect(entitlements).not.toContain('applinks:ieumoffice.com')
    })

    it('omits autoVerify HTTPS App Links from Android intent-filters-fragment.xml', () => {
      const fragment = readFileSync(
        join(NATIVE_CONFIG, 'android', 'intent-filters-fragment.xml'),
        'utf8',
      )
      expect(fragment).not.toContain('android:autoVerify')
      expect(fragment).not.toContain('ieumoffice.com')
      expect(fragment).not.toContain('/mobile/auth/callback')
    })
  })

  describe('iOS AppIcon.appiconset', () => {
    it('ships an opaque 1024x1024 RGB PNG (no alpha channel) and valid Contents.json', () => {
      const iconDir = join(NATIVE_CONFIG, 'ios', 'AppIcon.appiconset')
      const png = readFileSync(join(iconDir, 'AppIcon-1024.png'))
      // PNG signature
      expect(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true)
      expect(png.readUInt32BE(16)).toBe(1024)
      expect(png.readUInt32BE(20)).toBe(1024)
      expect(png[24]).toBe(8)
      // colorType 2 = truecolor RGB without alpha channel (required by App Store Connect)
      expect(png[25]).toBe(2)

      const contents = JSON.parse(readFileSync(join(iconDir, 'Contents.json'), 'utf8'))
      expect(contents.images).toEqual([
        {
          filename: 'AppIcon-1024.png',
          idiom: 'universal',
          platform: 'ios',
          size: '1024x1024',
        },
      ])
    })

    it('replaces Tauri default placeholder icons inside Assets.xcassets/AppIcon.appiconset', () => {
      const tmp = mkdtempSync(join(tmpdir(), 'ieum-ios-icon-'))
      try {
        const appleRoot = join(tmp, 'apple')
        const iosApp = join(appleRoot, 'ieumoffice-mobile_iOS')
        const defaultIconSet = join(appleRoot, 'Assets.xcassets', 'AppIcon.appiconset')
        mkdirSync(iosApp, { recursive: true })
        mkdirSync(defaultIconSet, { recursive: true })
        writeFileSync(
          join(iosApp, 'Info.plist'),
          '<?xml version="1.0"?><plist version="1.0"><dict>\n</dict>\n</plist>',
          'utf8',
        )
        writeFileSync(join(defaultIconSet, 'stale-tauri-icon.png'), 'placeholder', 'utf8')

        const r1 = applyIosConfig(tmp)
        const r2 = applyIosConfig(tmp)
        expect(r1.applied).toBe(true)
        expect(r2.applied).toBe(true)
        expect(existsSync(join(defaultIconSet, 'stale-tauri-icon.png'))).toBe(false)
        expect(existsSync(join(defaultIconSet, 'AppIcon-1024.png'))).toBe(true)
        expect(existsSync(join(defaultIconSet, 'Contents.json'))).toBe(true)
      } finally {
        rmSync(tmp, { recursive: true, force: true })
      }
    })
  })
})
