// Picking another PDF to take pages from (spec 3.9): the web view's own file input,
// as the HWP picture picker does (editors/pickPicture.ts). The app's document open
// (`client.pickOpenFile`) is never used here: it would switch the open session and
// add the file to the recent list. The system picker asks for no permission.

/** Opens the system picker for one PDF; its bytes, or null when nothing was picked. */
export function pickPdfFile(doc: Document = document): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const input = doc.createElement('input')
    input.type = 'file'
    input.accept = 'application/pdf'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) {
        resolve(null)
        return
      }
      file.arrayBuffer().then(
        (buffer) => resolve(new Uint8Array(buffer)),
        () => resolve(null),
      )
    }
    input.addEventListener('cancel', () => resolve(null))
    input.click()
  })
}
