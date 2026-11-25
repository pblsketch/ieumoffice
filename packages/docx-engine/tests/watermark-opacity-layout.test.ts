import { describe, expect, it } from 'vitest'
import { parseDocx, saveDocx } from '../src/index'
import { vmlFraction } from '../src/parse-vml'
import { readWatermarkShape } from '../src/watermark'
import { TINY_PNG_BASE64, buildDocx } from './helpers/build-docx'

const BODY = '<w:p><w:r><w:t>Hello body</w:t></w:r></w:p>'

async function buildDocxWithHeaderImage(headerInnerXml: string): Promise<Uint8Array> {
  return buildDocx({
    bodyXml: BODY,
    headerXml: headerInnerXml,
    headerRelsXml:
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>',
    binaryParts: [
      {
        path: 'word/media/image1.png',
        base64: TINY_PNG_BASE64,
        extension: 'png',
        contentType: 'image/png',
      },
    ],
  })
}

describe('watermark opacity and layout parsing', () => {
  it('vmlFraction parses fixed-point, decimals, and percentages', () => {
    expect(vmlFraction('32768f')).toBe(0.5)
    expect(vmlFraction('50%')).toBe(0.5)
    expect(vmlFraction('30%')).toBe(0.3)
    expect(vmlFraction('35%')).toBe(0.35)
    expect(vmlFraction('.25')).toBe(0.25)
  })

  it('readWatermarkShape handles percentage opacity, v:fill color, single quotes, and omitted z-index', () => {
    const pict =
      "<w:pict><v:shape id='PowerPlusWaterMarkObject1' style='position: absolute; width: 300pt; height: 100pt; rotation: 315; mso-position-horizontal: center; mso-position-vertical: center'>" +
      "<v:fill color='#888888' opacity='50%'/>" +
      "<v:textpath style='font-family:&quot;Malgun Gothic&quot;' string='CONFIDENTIAL'/>" +
      '</v:shape></w:pict>'
    const wm = readWatermarkShape(pict)
    expect(wm).toMatchObject({
      floating: true,
      behind: true,
      posH: 'center',
      posV: 'center',
      rotationDeg: 315,
      wordArt: {
        text: 'CONFIDENTIAL',
        colorHex: '888888',
        opacity: 0.5,
        fontFamily: 'Malgun Gothic',
      },
    })
  })

  it('parses VML picture watermarks with whitespace after style colons as floating behind-text with washout', async () => {
    const headerInnerXml =
      '<w:p><w:r><w:pict>' +
      '<v:shape id="WordPictureWatermark1" style="position: absolute; margin-left: 0; margin-top: 0; width: 300pt; height: 300pt; z-index: -251657216; mso-position-horizontal: center; mso-position-horizontal-relative: margin; mso-position-vertical: center; mso-position-vertical-relative: margin">' +
      '<v:imagedata r:id="rId1" o:title="watermark" gain="30%" blacklevel="35%"/>' +
      '</v:shape></w:pict></w:r></w:p>'
    const bytes = await buildDocxWithHeaderImage(headerInnerXml)
    const parsed = await parseDocx(bytes)
    const img = parsed.headerImages?.[0]
    expect(img).toMatchObject({
      floating: true,
      behind: true,
      watermark: true,
      posH: 'center',
      posV: 'center',
      posHRel: 'margin',
      posVRel: 'margin',
      washout: { gain: 0.3, blackLevel: 0.35 },
    })

    // untouched save returns original bytes identically
    const order = parsed.blocks
      .filter((b) => !b.hidden && b.docxIndex !== null)
      .map((b) => ({ kind: 'original' as const, docxIndex: b.docxIndex! }))
    const saved = await saveDocx(parsed, order)
    expect(Buffer.from(saved).equals(Buffer.from(bytes))).toBe(true)
  })

  it('parses DrawingML header watermark blip effects (a:lum, a:alphaModFix) and rotation (a:xfrm rot)', async () => {
    const headerInnerXml =
      '<w:p><w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251658240" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">' +
      '<wp:simplePos x="0" y="0"/>' +
      '<wp:positionH relativeFrom="margin"><wp:align>center</wp:align></wp:positionH>' +
      '<wp:positionV relativeFrom="margin"><wp:align>center</wp:align></wp:positionV>' +
      '<wp:extent cx="2857500" cy="2857500"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>' +
      '<wp:docPr id="1" name="Watermark"/><wp:cNvGraphicFramePr/>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
      '<pic:nvPicPr><pic:cNvPr id="1" name="Watermark"/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="rId1"><a:alphaModFix amt="25000"/><a:lum bright="70000" contrast="-70000"/></a:blip><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm rot="18900000"><a:off x="0" y="0"/><a:ext cx="2857500" cy="2857500"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>'
    const bytes = await buildDocxWithHeaderImage(headerInnerXml)
    const parsed = await parseDocx(bytes)
    const img = parsed.headerImages?.[0]
    expect(img).toMatchObject({
      floating: true,
      behind: true,
      posH: 'center',
      posV: 'center',
      posHRel: 'margin',
      posVRel: 'margin',
      rotationDeg: 315,
      effects: { bright: 0.7, contrast: -0.7, alpha: 0.25 },
    })
  })

  it('parses body DrawingML a:alphaModFix and centered VML behind-text image metadata', async () => {
    const bodyXml =
      '<w:p><w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251658240" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">' +
      '<wp:simplePos x="0" y="0"/>' +
      '<wp:positionH relativeFrom="margin"><wp:align>center</wp:align></wp:positionH>' +
      '<wp:positionV relativeFrom="margin"><wp:align>center</wp:align></wp:positionV>' +
      '<wp:extent cx="1905000" cy="1905000"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>' +
      '<wp:docPr id="1" name="BodyWatermark"/><wp:cNvGraphicFramePr/>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
      '<pic:nvPicPr><pic:cNvPr id="1" name="BodyWatermark"/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="rId10"><a:alphaModFix amt="30000"/></a:blip><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1905000" cy="1905000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>' +
      '<w:p><w:r><w:pict><v:shape id="VmlBodyWm" style="position: absolute; margin-left: 0; margin-top: 0; width: 200pt; height: 200pt; z-index: -1; mso-position-horizontal: center; mso-position-horizontal-relative: page; mso-position-vertical: center; mso-position-vertical-relative: page">' +
      '<v:imagedata r:id="rId10" gain="19661f" blacklevel="22938f"/>' +
      '</v:shape></w:pict></w:r></w:p>'
    const bytes = await buildDocx({
      bodyXml,
      withImage: true,
    })
    const parsed = await parseDocx(bytes)
    const imgs = parsed.blocks.filter((b) => b.type === 'image')
    expect(imgs).toHaveLength(2)
    expect(imgs[0]).toMatchObject({
      imageWrap: 'behind',
      imagePosH: 'center',
      imagePosV: 'center',
      imageRelH: 'margin',
      imageRelV: 'margin',
      imageEffects: { alpha: 0.3 },
    })
    expect(imgs[1]).toMatchObject({
      imageWrap: 'behind',
      imagePosH: 'center',
      imagePosV: 'center',
      imageRelH: 'page',
      imageRelV: 'page',
    })
    expect(imgs[1]!.imageOffsetXEmu).toBeUndefined()
    expect(imgs[1]!.imageOffsetYEmu).toBeUndefined()
    expect(imgs[1]!.imageEffects?.bright).toBeCloseTo(0.7, 2)
    expect(imgs[1]!.imageEffects?.contrast).toBeCloseTo(-0.7, 2)
  })
})
