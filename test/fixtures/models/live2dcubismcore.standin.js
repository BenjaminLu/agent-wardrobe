// A stand-in for Live2D's Cubism Core, for the offline smoke only. It is not Live2D software: it ignores the .moc3
// and draws two textured quads (a body that turns with ParamAngleX / ParamBodyAngleX and a mouth that opens with
// ParamMouthOpenY), through the same API the real Core gives the Cubism Framework.
(() => {
  // the real Core is WebAssembly; this fails the same way when the page's CSP does not allow it
  new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
  const ids = ['ParamAngleX', 'ParamAngleY', 'ParamBodyAngleX', 'ParamEyeLOpen', 'ParamEyeROpen', 'ParamMouthOpenY', 'ParamMouthForm', 'ParamEyeBallX', 'ParamEyeBallY'];
  const min = [-30, -30, -10, 0, 0, 0, -1, -1, -1], max = [30, 30, 10, 1, 1, 1, 1, 1, 1], def = [0, 0, 0, 1, 1, 0, 0, 0, 0];
  const VISIBLE = 1, DOUBLE = 4, POSITIONS = 32, OPACITY = 4, ORDER = 16, VIS_CHANGED = 2, COLOR = 64;
  let log = null;
  class Moc { static fromArrayBuffer(buffer) { return new TextDecoder().decode(new Uint8Array(buffer, 0, 4)) === 'MOC3' ? new Moc() : null; } hasMocConsistency() { return 1; } _release() {} }
  class Model {
    constructor() {
      const n = ids.length;
      this.parameters = { count: n, ids, minimumValues: Float32Array.from(min), maximumValues: Float32Array.from(max), defaultValues: Float32Array.from(def), values: Float32Array.from(def), types: new Int32Array(n), repeats: new Int32Array(n), keyCounts: new Int32Array(n), keyValues: ids.map(() => new Float32Array(0)) };
      this.parts = { count: 1, ids: ['PartBody'], opacities: new Float32Array([1]), parentIndices: new Int32Array([-1]) };
      this.drawables = {
        count: 2, ids: ['ArtMeshBody', 'ArtMeshMouth'], constantFlags: new Uint8Array([DOUBLE, DOUBLE]), dynamicFlags: new Uint8Array([VISIBLE | POSITIONS, VISIBLE | POSITIONS]),
        textureIndices: new Int32Array([0, 0]), drawOrders: new Int32Array([0, 1]), renderOrders: new Int32Array([0, 1]), opacities: new Float32Array([1, 1]),
        maskCounts: new Int32Array([0, 0]), masks: [new Int32Array(0), new Int32Array(0)], vertexCounts: new Int32Array([4, 4]),
        vertexPositions: [new Float32Array(8), new Float32Array(8)], vertexUvs: [new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), new Float32Array([.4, .2, .6, .2, .4, .3, .6, .3])],
        indexCounts: new Int32Array([6, 6]), indices: [new Uint16Array([0, 1, 2, 2, 1, 3]), new Uint16Array([0, 1, 2, 2, 1, 3])],
        multiplyColors: new Float32Array([1, 1, 1, 1, 1, 1, 1, 1]), screenColors: new Float32Array(8), parentPartIndices: new Int32Array([0, 0]),
        resetDynamicFlags: () => { this.drawables.dynamicFlags[0] = VISIBLE; this.drawables.dynamicFlags[1] = VISIBLE; }
      };
      this.canvasinfo = { CanvasWidth: 1000, CanvasHeight: 1500, CanvasOriginX: 500, CanvasOriginY: 750, PixelsPerUnit: 1000 };
      this.update();
    }
    update() {
      const v = name => this.parameters.values[ids.indexOf(name)], turn = v('ParamAngleX') / 30 * .15 + v('ParamBodyAngleX') / 10 * .1, open = v('ParamMouthOpenY');
      const quad = (out, x0, x1, y0, y1) => out.set([x0, y1, x1, y1, x0, y0, x1, y0]);
      quad(this.drawables.vertexPositions[0], -.35 + turn, .35 + turn, -.75, .6);
      quad(this.drawables.vertexPositions[1], -.08 + turn * 1.4, .08 + turn * 1.4, .05, .07 + .12 * open);
      this.drawables.dynamicFlags[0] |= POSITIONS; this.drawables.dynamicFlags[1] |= POSITIONS;
    }
    release() {}
  }
  const bit = mask => flags => (flags & mask) === mask;
  window.Live2DCubismCore = {
    Version: { csmGetVersion: () => 0x05000000, csmGetLatestMocVersion: () => 5, csmGetMocVersion: () => 5 },
    Logging: { csmSetLogFunction: fn => { log = fn; }, csmGetLogFunction: () => log },
    Memory: { initializeAmountOfMemory() {} },
    Moc, Model: { fromMoc: moc => moc ? new Model() : null },
    Utils: { hasBlendAdditiveBit: bit(1), hasBlendMultiplicativeBit: bit(2), hasIsDoubleSidedBit: bit(DOUBLE), hasIsInvertedMaskBit: bit(8),
      hasIsVisibleBit: bit(VISIBLE), hasVisibilityDidChangeBit: bit(VIS_CHANGED), hasOpacityDidChangeBit: bit(OPACITY), hasDrawOrderDidChangeBit: bit(8), hasRenderOrderDidChangeBit: bit(ORDER),
      hasVertexPositionsDidChangeBit: bit(POSITIONS), hasBlendColorDidChangeBit: bit(COLOR) },
    standIn: true
  };
})();
