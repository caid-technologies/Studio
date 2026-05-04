/* global importScripts, OpenSCAD */

let openscadInstance = null
let isInitializing = false

function generateFallbackSTL() {
  const triangles = [
    [[0,0,0],[1,0,0],[1,1,0]], [[0,0,0],[1,1,0],[0,1,0]],
    [[0,0,1],[1,1,1],[1,0,1]], [[0,0,1],[0,1,1],[1,1,1]],
    [[0,0,0],[0,1,0],[0,1,1]], [[0,0,0],[0,1,1],[0,0,1]],
    [[1,0,0],[1,0,1],[1,1,1]], [[1,0,0],[1,1,1],[1,1,0]],
    [[0,0,0],[0,0,1],[1,0,1]], [[0,0,0],[1,0,1],[1,0,0]],
    [[0,1,0],[1,1,0],[1,1,1]], [[0,1,0],[1,1,1],[0,1,1]],
  ]
  const buffer = new ArrayBuffer(84 + triangles.length * 50)
  const view = new DataView(buffer)
  view.setUint32(80, triangles.length, true)
  let offset = 84
  for (const [v1, v2, v3] of triangles) {
    view.setFloat32(offset,     0, true); offset += 4
    view.setFloat32(offset,     0, true); offset += 4
    view.setFloat32(offset,     1, true); offset += 4
    for (const v of [v1, v2, v3]) {
      view.setFloat32(offset,     v[0], true); offset += 4
      view.setFloat32(offset,     v[1], true); offset += 4
      view.setFloat32(offset,     v[2], true); offset += 4
    }
    view.setUint16(offset, 0, true); offset += 2
  }
  return buffer
}

async function initOpenSCAD() {
  if (openscadInstance) return openscadInstance
  if (isInitializing) return null
  isInitializing = true

  try {
    self.postMessage({
      type: 'status',
      message: 'Loading OpenSCAD WASM...'
    })
    importScripts('/openscad.js')
    openscadInstance = await OpenSCAD({ noInitialRun: true })
    self.postMessage({
      type: 'status',
      message: 'OpenSCAD WASM ready'
    })
    isInitializing = false
    return openscadInstance
  } catch (err) {
    self.postMessage({
      type: 'status',
      message: 'WASM unavailable — using fallback geometry',
    })
    isInitializing = false
    return null
  }
}

self.onmessage = async function (e) {
  if (e.data.type !== 'compile') return

  const { code } = e.data
  self.postMessage({ type: 'status', message: 'Compiling geometry...' })

  const instance = await initOpenSCAD()

  if (!instance) {
    const fallback = generateFallbackSTL()
    self.postMessage({ type: 'result', stl: fallback }, [fallback])
    return
  }

  try {
    instance.FS.writeFile('/input.scad', code)
    instance.callMain(['/input.scad', '--enable=manifold', '-o', '/output.stl'])
    const stlData = instance.FS.readFile('/output.stl')
    const buffer = stlData.buffer.slice(
      stlData.byteOffset,
      stlData.byteOffset + stlData.byteLength
    )
    self.postMessage({ type: 'result', stl: buffer }, [buffer])
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    })
    const fallback = generateFallbackSTL()
    self.postMessage({ type: 'result', stl: fallback }, [fallback])
  }
}
