import { FEATURE_SIZE } from './FeatureEncoder.js';
import { MAX_ACTIONS } from './ActionSpace.js';

export interface PPONetworkWeights {
  // Shared backbone
  w1: number[]; b1: number[]; // FEATURE_SIZE -> HIDDEN
  w2: number[]; b2: number[]; // HIDDEN -> HIDDEN
  w3: number[]; b3: number[]; // HIDDEN -> HIDDEN (+ residual from h1)
  // LayerNorm params (gamma=scale, beta=shift)
  ln1g: number[]; ln1b: number[];
  ln2g: number[]; ln2b: number[];
  ln3g: number[]; ln3b: number[];
  // Policy head
  wp: number[]; bp: number[]; // HIDDEN -> MAX_ACTIONS
  // Value head (2-layer MLP)
  wv1: number[]; bv1: number[]; // HIDDEN -> VALUE_HIDDEN
  wv2: number[]; bv2: number[]; // VALUE_HIDDEN -> 1
  // Legacy (ignored)
  wv?: number[]; bv?: number[];
}

export interface PPOFullState {
  weights: PPONetworkWeights;
  adam: {
    step: number;
    mw1: number[]; mb1: number[];
    mw2: number[]; mb2: number[];
    mw3: number[]; mb3: number[];
    mln1g: number[]; mln1b: number[];
    mln2g: number[]; mln2b: number[];
    mln3g: number[]; mln3b: number[];
    mwp: number[]; mbp: number[];
    mwv1: number[]; mbv1: number[];
    mwv2: number[]; mbv2: number[];
    vw1: number[]; vb1: number[];
    vw2: number[]; vb2: number[];
    vw3: number[]; vb3: number[];
    vln1g: number[]; vln1b: number[];
    vln2g: number[]; vln2b: number[];
    vln3g: number[]; vln3b: number[];
    vwp: number[]; vbp: number[];
    vwv1: number[]; vbv1: number[];
    vwv2: number[]; vbv2: number[];
  };
}

const HIDDEN = 512;
const VALUE_HIDDEN = 128;
const LN_EPS = 1e-5;

const MAX_GRAD_NORM = 0.5;
const ADAM_BETA1 = 0.9;
const ADAM_BETA2 = 0.999;
const ADAM_EPS = 1e-8;

function initRandom(size: number, scale: number): Float32Array {
  const arr = new Float32Array(size);
  for (let i = 0; i < size; i++) arr[i] = (Math.random() - 0.5) * 2 * scale;
  return arr;
}

function initOnes(size: number): Float32Array {
  const arr = new Float32Array(size);
  for (let i = 0; i < size; i++) arr[i] = 1;
  return arr;
}

export interface ForwardResult {
  probs: Float32Array;
  value: number;
  logits: Float32Array;
}

export class PPONetwork {
  // Shared backbone weights
  w1: Float32Array; b1: Float32Array;
  w2: Float32Array; b2: Float32Array;
  w3: Float32Array; b3: Float32Array;
  // LayerNorm parameters (gamma=scale, beta=shift)
  ln1g: Float32Array; ln1b: Float32Array;
  ln2g: Float32Array; ln2b: Float32Array;
  ln3g: Float32Array; ln3b: Float32Array;
  // Policy head
  wp: Float32Array; bp: Float32Array;
  // Value head (2-layer MLP)
  wv1: Float32Array; bv1: Float32Array;
  wv2: Float32Array; bv2: Float32Array;

  // Gradient accumulators
  private gw1: Float32Array; private gb1: Float32Array;
  private gw2: Float32Array; private gb2: Float32Array;
  private gw3: Float32Array; private gb3: Float32Array;
  private gln1g: Float32Array; private gln1b: Float32Array;
  private gln2g: Float32Array; private gln2b: Float32Array;
  private gln3g: Float32Array; private gln3b: Float32Array;
  private gwp: Float32Array; private gbp: Float32Array;
  private gwv1: Float32Array; private gbv1: Float32Array;
  private gwv2: Float32Array; private gbv2: Float32Array;
  private gradCount = 0;

  // Adam moments (m=first moment, v=second moment)
  private mw1: Float32Array; private mb1: Float32Array;
  private mw2: Float32Array; private mb2: Float32Array;
  private mw3: Float32Array; private mb3: Float32Array;
  private mln1g: Float32Array; private mln1b: Float32Array;
  private mln2g: Float32Array; private mln2b: Float32Array;
  private mln3g: Float32Array; private mln3b: Float32Array;
  private mwp: Float32Array; private mbp: Float32Array;
  private mwv1: Float32Array; private mbv1: Float32Array;
  private mwv2: Float32Array; private mbv2: Float32Array;
  // Adam v (second moment) — prefixed with a_ to avoid clash with value head weights
  private a_vw1: Float32Array; private a_vb1: Float32Array;
  private a_vw2: Float32Array; private a_vb2: Float32Array;
  private a_vw3: Float32Array; private a_vb3: Float32Array;
  private a_vln1g: Float32Array; private a_vln1b: Float32Array;
  private a_vln2g: Float32Array; private a_vln2b: Float32Array;
  private a_vln3g: Float32Array; private a_vln3b: Float32Array;
  private a_vwp: Float32Array; private a_vbp: Float32Array;
  private a_vwv1: Float32Array; private a_vbv1: Float32Array;
  private a_vwv2: Float32Array; private a_vbv2: Float32Array;
  private adamStep = 0;

  // Pre-allocated activation caches
  private lastInput: Float32Array = new Float32Array(0);
  private lastH1Lin: Float32Array;   // after linear, before LN
  private lastH1Norm: Float32Array;  // after LN, before ReLU
  private lastH1: Float32Array;      // after ReLU
  private lastH1Mean: number = 0;
  private lastH1InvStd: number = 0;
  private lastH2Lin: Float32Array;
  private lastH2Norm: Float32Array;
  private lastH2: Float32Array;
  private lastH2Mean: number = 0;
  private lastH2InvStd: number = 0;
  private lastH3Lin: Float32Array;
  private lastH3Norm: Float32Array;
  private lastH3: Float32Array;
  private lastH3Mean: number = 0;
  private lastH3InvStd: number = 0;
  private lastLogits: Float32Array;
  private lastProbs: Float32Array;
  private lastValue: number = 0;
  private lastVH1Pre: Float32Array;
  private lastVH1: Float32Array;

  // Pre-allocated backprop temp buffers
  private _dLogits: Float32Array;
  private _dH3p: Float32Array;
  private _dH3v: Float32Array;
  private _dH3Norm: Float32Array;
  private _dH3Lin: Float32Array;
  private _dH2: Float32Array;
  private _dH1r: Float32Array;
  private _dH2Norm: Float32Array;
  private _dH2Lin: Float32Array;
  private _dH1f: Float32Array;
  private _dH1Norm: Float32Array;
  private _dH1Lin: Float32Array;
  private _dVH1: Float32Array;
  private _dVH1Pre: Float32Array;

  constructor(weights?: PPONetworkWeights) {
    if (weights) {
      this.w1 = Float32Array.from(weights.w1);
      this.b1 = Float32Array.from(weights.b1);
      this.w2 = Float32Array.from(weights.w2);
      this.b2 = Float32Array.from(weights.b2);
      this.w3 = Float32Array.from(weights.w3);
      this.b3 = Float32Array.from(weights.b3);
      this.ln1g = weights.ln1g ? Float32Array.from(weights.ln1g) : initOnes(HIDDEN);
      this.ln1b = weights.ln1b ? Float32Array.from(weights.ln1b) : new Float32Array(HIDDEN);
      this.ln2g = weights.ln2g ? Float32Array.from(weights.ln2g) : initOnes(HIDDEN);
      this.ln2b = weights.ln2b ? Float32Array.from(weights.ln2b) : new Float32Array(HIDDEN);
      this.ln3g = weights.ln3g ? Float32Array.from(weights.ln3g) : initOnes(HIDDEN);
      this.ln3b = weights.ln3b ? Float32Array.from(weights.ln3b) : new Float32Array(HIDDEN);
      this.wp = Float32Array.from(weights.wp);
      this.bp = Float32Array.from(weights.bp);
      if (weights.wv1 && weights.bv1 && weights.wv2 && weights.bv2) {
        this.wv1 = Float32Array.from(weights.wv1);
        this.bv1 = Float32Array.from(weights.bv1);
        this.wv2 = Float32Array.from(weights.wv2);
        this.bv2 = Float32Array.from(weights.bv2);
      } else {
        const sv = Math.sqrt(2 / HIDDEN);
        this.wv1 = initRandom(HIDDEN * VALUE_HIDDEN, sv);
        this.bv1 = new Float32Array(VALUE_HIDDEN);
        this.wv2 = initRandom(VALUE_HIDDEN, 0.01);
        this.bv2 = new Float32Array(1);
      }
    } else {
      const s1 = Math.sqrt(2 / FEATURE_SIZE);
      const s2 = Math.sqrt(2 / HIDDEN);
      this.w1 = initRandom(FEATURE_SIZE * HIDDEN, s1);
      this.b1 = new Float32Array(HIDDEN);
      this.w2 = initRandom(HIDDEN * HIDDEN, s2);
      this.b2 = new Float32Array(HIDDEN);
      this.w3 = initRandom(HIDDEN * HIDDEN, s2);
      this.b3 = new Float32Array(HIDDEN);
      // LayerNorm: gamma=1, beta=0 (identity at init)
      this.ln1g = initOnes(HIDDEN); this.ln1b = new Float32Array(HIDDEN);
      this.ln2g = initOnes(HIDDEN); this.ln2b = new Float32Array(HIDDEN);
      this.ln3g = initOnes(HIDDEN); this.ln3b = new Float32Array(HIDDEN);
      // Policy head: small init for near-uniform initial policy
      this.wp = initRandom(HIDDEN * MAX_ACTIONS, 0.01);
      this.bp = new Float32Array(MAX_ACTIONS);
      // Value head
      const sv = Math.sqrt(2 / HIDDEN);
      this.wv1 = initRandom(HIDDEN * VALUE_HIDDEN, sv);
      this.bv1 = new Float32Array(VALUE_HIDDEN);
      this.wv2 = initRandom(VALUE_HIDDEN, 0.01);
      this.bv2 = new Float32Array(1);
    }

    const alloc = (n: number) => new Float32Array(n);

    // Gradient accumulators
    this.gw1 = alloc(FEATURE_SIZE * HIDDEN); this.gb1 = alloc(HIDDEN);
    this.gw2 = alloc(HIDDEN * HIDDEN); this.gb2 = alloc(HIDDEN);
    this.gw3 = alloc(HIDDEN * HIDDEN); this.gb3 = alloc(HIDDEN);
    this.gln1g = alloc(HIDDEN); this.gln1b = alloc(HIDDEN);
    this.gln2g = alloc(HIDDEN); this.gln2b = alloc(HIDDEN);
    this.gln3g = alloc(HIDDEN); this.gln3b = alloc(HIDDEN);
    this.gwp = alloc(HIDDEN * MAX_ACTIONS); this.gbp = alloc(MAX_ACTIONS);
    this.gwv1 = alloc(HIDDEN * VALUE_HIDDEN); this.gbv1 = alloc(VALUE_HIDDEN);
    this.gwv2 = alloc(VALUE_HIDDEN); this.gbv2 = alloc(1);

    // Adam first moments
    this.mw1 = alloc(FEATURE_SIZE * HIDDEN); this.mb1 = alloc(HIDDEN);
    this.mw2 = alloc(HIDDEN * HIDDEN); this.mb2 = alloc(HIDDEN);
    this.mw3 = alloc(HIDDEN * HIDDEN); this.mb3 = alloc(HIDDEN);
    this.mln1g = alloc(HIDDEN); this.mln1b = alloc(HIDDEN);
    this.mln2g = alloc(HIDDEN); this.mln2b = alloc(HIDDEN);
    this.mln3g = alloc(HIDDEN); this.mln3b = alloc(HIDDEN);
    this.mwp = alloc(HIDDEN * MAX_ACTIONS); this.mbp = alloc(MAX_ACTIONS);
    this.mwv1 = alloc(HIDDEN * VALUE_HIDDEN); this.mbv1 = alloc(VALUE_HIDDEN);
    this.mwv2 = alloc(VALUE_HIDDEN); this.mbv2 = alloc(1);
    // Adam second moments
    this.a_vw1 = alloc(FEATURE_SIZE * HIDDEN); this.a_vb1 = alloc(HIDDEN);
    this.a_vw2 = alloc(HIDDEN * HIDDEN); this.a_vb2 = alloc(HIDDEN);
    this.a_vw3 = alloc(HIDDEN * HIDDEN); this.a_vb3 = alloc(HIDDEN);
    this.a_vln1g = alloc(HIDDEN); this.a_vln1b = alloc(HIDDEN);
    this.a_vln2g = alloc(HIDDEN); this.a_vln2b = alloc(HIDDEN);
    this.a_vln3g = alloc(HIDDEN); this.a_vln3b = alloc(HIDDEN);
    this.a_vwp = alloc(HIDDEN * MAX_ACTIONS); this.a_vbp = alloc(MAX_ACTIONS);
    this.a_vwv1 = alloc(HIDDEN * VALUE_HIDDEN); this.a_vbv1 = alloc(VALUE_HIDDEN);
    this.a_vwv2 = alloc(VALUE_HIDDEN); this.a_vbv2 = alloc(1);

    // Pre-allocated activation buffers
    this.lastH1Lin = alloc(HIDDEN);
    this.lastH1Norm = alloc(HIDDEN);
    this.lastH1 = alloc(HIDDEN);
    this.lastH2Lin = alloc(HIDDEN);
    this.lastH2Norm = alloc(HIDDEN);
    this.lastH2 = alloc(HIDDEN);
    this.lastH3Lin = alloc(HIDDEN);
    this.lastH3Norm = alloc(HIDDEN);
    this.lastH3 = alloc(HIDDEN);
    this.lastLogits = alloc(MAX_ACTIONS);
    this.lastProbs = alloc(MAX_ACTIONS);
    this.lastVH1Pre = alloc(VALUE_HIDDEN);
    this.lastVH1 = alloc(VALUE_HIDDEN);

    // Pre-allocated backprop temp buffers
    this._dLogits = alloc(MAX_ACTIONS);
    this._dH3p = alloc(HIDDEN);
    this._dH3v = alloc(HIDDEN);
    this._dH3Norm = alloc(HIDDEN);
    this._dH3Lin = alloc(HIDDEN);
    this._dH2 = alloc(HIDDEN);
    this._dH1r = alloc(HIDDEN);
    this._dH2Norm = alloc(HIDDEN);
    this._dH2Lin = alloc(HIDDEN);
    this._dH1f = alloc(HIDDEN);
    this._dH1Norm = alloc(HIDDEN);
    this._dH1Lin = alloc(HIDDEN);
    this._dVH1 = alloc(VALUE_HIDDEN);
    this._dVH1Pre = alloc(VALUE_HIDDEN);
  }

  forward(input: Float32Array, validMask: boolean[], training = false): ForwardResult {
    this.lastInput = input;

    // Layer 1: input -> linear -> LayerNorm -> ReLU
    const h1lin = this.lastH1Lin;
    const { b1, w1, b2, w2, b3, w3, bp: bpol, wp } = this;
    for (let j = 0; j < HIDDEN; j++) h1lin[j] = b1[j];
    for (let i = 0; i < FEATURE_SIZE; i++) {
      const inp = input[i];
      const off = i * HIDDEN;
      for (let j = 0; j < HIDDEN; j++) h1lin[j] += inp * w1[off + j];
    }
    const h1norm = this.lastH1Norm;
    const [h1mean, h1invstd] = layerNormInto(h1lin, this.ln1g, this.ln1b, h1norm, HIDDEN);
    this.lastH1Mean = h1mean;
    this.lastH1InvStd = h1invstd;
    const h1 = this.lastH1;
    for (let j = 0; j < HIDDEN; j++) h1[j] = h1norm[j] > 0 ? h1norm[j] : 0;

    // Layer 2: h1 -> linear -> LayerNorm -> ReLU
    const h2lin = this.lastH2Lin;
    for (let j = 0; j < HIDDEN; j++) h2lin[j] = b2[j];
    for (let i = 0; i < HIDDEN; i++) {
      const val = h1[i];
      const off = i * HIDDEN;
      for (let j = 0; j < HIDDEN; j++) h2lin[j] += val * w2[off + j];
    }
    const h2norm = this.lastH2Norm;
    const [h2mean, h2invstd] = layerNormInto(h2lin, this.ln2g, this.ln2b, h2norm, HIDDEN);
    this.lastH2Mean = h2mean;
    this.lastH2InvStd = h2invstd;
    const h2 = this.lastH2;
    for (let j = 0; j < HIDDEN; j++) h2[j] = h2norm[j] > 0 ? h2norm[j] : 0;

    // Layer 3: h2 -> linear + residual(h1) -> LayerNorm -> ReLU
    const h3lin = this.lastH3Lin;
    for (let j = 0; j < HIDDEN; j++) h3lin[j] = b3[j] + h1[j]; // bias + residual
    for (let i = 0; i < HIDDEN; i++) {
      const val = h2[i];
      const off = i * HIDDEN;
      for (let j = 0; j < HIDDEN; j++) h3lin[j] += val * w3[off + j];
    }
    const h3norm = this.lastH3Norm;
    const [h3mean, h3invstd] = layerNormInto(h3lin, this.ln3g, this.ln3b, h3norm, HIDDEN);
    this.lastH3Mean = h3mean;
    this.lastH3InvStd = h3invstd;
    const h3 = this.lastH3;
    for (let j = 0; j < HIDDEN; j++) h3[j] = h3norm[j] > 0 ? h3norm[j] : 0;

    // Policy head: h3 -> logits -> softmax(masked)
    const logits = this.lastLogits;
    for (let j = 0; j < MAX_ACTIONS; j++) logits[j] = bpol[j];
    for (let i = 0; i < HIDDEN; i++) {
      const val = h3[i];
      const off = i * MAX_ACTIONS;
      for (let j = 0; j < MAX_ACTIONS; j++) logits[j] += val * wp[off + j];
    }
    let validCount = 0;
    for (let j = 0; j < MAX_ACTIONS; j++) {
      if (!validMask[j]) logits[j] = -1e9;
      else validCount++;
    }

    const probs = this.lastProbs;
    softmaxInto(logits, probs);

    if (!training && validCount > 0) {
      const PROB_FLOOR = 0.05;
      const uniform = 1 / validCount;
      for (let j = 0; j < MAX_ACTIONS; j++) {
        probs[j] = validMask[j]
          ? (1 - PROB_FLOOR) * probs[j] + PROB_FLOOR * uniform
          : 0;
      }
    }

    // Value head: h3 -> VALUE_HIDDEN -> 1
    const vh1pre = this.lastVH1Pre;
    const { wv1, bv1: bval1, wv2, bv2: bval2 } = this;
    for (let j = 0; j < VALUE_HIDDEN; j++) vh1pre[j] = bval1[j];
    for (let i = 0; i < HIDDEN; i++) {
      const val = h3[i];
      const off = i * VALUE_HIDDEN;
      for (let j = 0; j < VALUE_HIDDEN; j++) vh1pre[j] += val * wv1[off + j];
    }
    const vh1 = this.lastVH1;
    for (let j = 0; j < VALUE_HIDDEN; j++) vh1[j] = vh1pre[j] > 0 ? vh1pre[j] : 0;

    let vOut = bval2[0];
    for (let i = 0; i < VALUE_HIDDEN; i++) vOut += vh1[i] * wv2[i];
    this.lastValue = vOut;

    return { probs, value: vOut, logits };
  }

  sampleAction(probs: Float32Array): number {
    const r = Math.random();
    let cum = 0;
    for (let i = 0; i < probs.length; i++) {
      cum += probs[i];
      if (r < cum) return i;
    }
    return probs.length - 1;
  }

  entropy(probs: Float32Array): number {
    let h = 0;
    for (let i = 0; i < probs.length; i++) {
      if (probs[i] > 1e-10) h -= probs[i] * Math.log(probs[i]);
    }
    return h;
  }

  /**
   * Accumulate PPO gradients for one transition.
   * Must be called immediately after forward() so cached activations are fresh.
   */
  accumulatePPOGradient(
    actionIdx: number,
    policyWeight: number,
    valueLossGrad: number,
    entropyBonus: number,
  ): void {
    // ─── Policy gradient on logits ───
    const dLogits = this._dLogits;
    let H = 0;
    for (let j = 0; j < MAX_ACTIONS; j++) {
      const p = this.lastProbs[j];
      if (p > 1e-10) H -= p * Math.log(p);
    }
    for (let j = 0; j < MAX_ACTIONS; j++) {
      const p = this.lastProbs[j];
      dLogits[j] = policyWeight * ((j === actionIdx ? 1 : 0) - p);
      if (p > 1e-10) {
        dLogits[j] += entropyBonus * p * (-H - Math.log(p));
      }
    }

    const dValue = valueLossGrad;

    // ─── Backprop through policy head ───
    const dH3_policy = this._dH3p;
    dH3_policy.fill(0);
    for (let j = 0; j < MAX_ACTIONS; j++) this.gbp[j] += dLogits[j];
    for (let i = 0; i < HIDDEN; i++) {
      const h3i = this.lastH3[i];
      const off = i * MAX_ACTIONS;
      let dH3i = 0;
      for (let j = 0; j < MAX_ACTIONS; j++) {
        this.gwp[off + j] += h3i * dLogits[j];
        dH3i += this.wp[off + j] * dLogits[j];
      }
      dH3_policy[i] = dH3i;
    }

    // ─── Backprop through 2-layer value head ───
    const dVOut = dValue;
    this.gbv2[0] += dVOut;
    const dVH1 = this._dVH1;
    for (let i = 0; i < VALUE_HIDDEN; i++) {
      this.gwv2[i] += this.lastVH1[i] * dVOut;
      dVH1[i] = this.wv2[i] * dVOut;
    }
    const dVH1Pre = this._dVH1Pre;
    for (let i = 0; i < VALUE_HIDDEN; i++) {
      dVH1Pre[i] = this.lastVH1Pre[i] > 0 ? dVH1[i] : 0;
    }
    const dH3_value = this._dH3v;
    dH3_value.fill(0);
    for (let j = 0; j < VALUE_HIDDEN; j++) this.gbv1[j] += dVH1Pre[j];
    for (let i = 0; i < HIDDEN; i++) {
      const h3i = this.lastH3[i];
      const off = i * VALUE_HIDDEN;
      let dH3i = 0;
      for (let j = 0; j < VALUE_HIDDEN; j++) {
        this.gwv1[off + j] += h3i * dVH1Pre[j];
        dH3i += this.wv1[off + j] * dVH1Pre[j];
      }
      dH3_value[i] = dH3i;
    }

    // ─── Combined dH3: policy only (stop-gradient on value to prevent backbone interference) ───
    const dH3Norm = this._dH3Norm;
    for (let i = 0; i < HIDDEN; i++) {
      dH3Norm[i] = this.lastH3Norm[i] > 0 ? dH3_policy[i] : 0; // ReLU backward
    }

    // ─── Backprop through LayerNorm 3 ───
    const dH3Lin = this._dH3Lin;
    layerNormBackward(dH3Norm, this.lastH3Lin, this.ln3g, this.lastH3Mean, this.lastH3InvStd,
      this.gln3g, this.gln3b, dH3Lin, HIDDEN);

    // ─── Backprop through layer 3 linear + residual ───
    const dH2_fromL3 = this._dH2;
    dH2_fromL3.fill(0);
    const dH1_residual = this._dH1r;
    for (let j = 0; j < HIDDEN; j++) {
      this.gb3[j] += dH3Lin[j];
      dH1_residual[j] = dH3Lin[j]; // residual gradient flows directly
    }
    for (let i = 0; i < HIDDEN; i++) {
      const h2i = this.lastH2[i];
      const off = i * HIDDEN;
      let dH2i = 0;
      for (let j = 0; j < HIDDEN; j++) {
        this.gw3[off + j] += h2i * dH3Lin[j];
        dH2i += this.w3[off + j] * dH3Lin[j];
      }
      dH2_fromL3[i] = dH2i;
    }

    // ─── Backprop through ReLU 2 + LayerNorm 2 ───
    const dH2Norm = this._dH2Norm;
    for (let j = 0; j < HIDDEN; j++) dH2Norm[j] = this.lastH2Norm[j] > 0 ? dH2_fromL3[j] : 0;
    const dH2Lin = this._dH2Lin;
    layerNormBackward(dH2Norm, this.lastH2Lin, this.ln2g, this.lastH2Mean, this.lastH2InvStd,
      this.gln2g, this.gln2b, dH2Lin, HIDDEN);

    // ─── Backprop through layer 2 linear ───
    const dH1_fromL2 = this._dH1f;
    dH1_fromL2.fill(0);
    for (let j = 0; j < HIDDEN; j++) this.gb2[j] += dH2Lin[j];
    for (let i = 0; i < HIDDEN; i++) {
      const h1i = this.lastH1[i];
      const off = i * HIDDEN;
      let dH1i = 0;
      for (let j = 0; j < HIDDEN; j++) {
        this.gw2[off + j] += h1i * dH2Lin[j];
        dH1i += this.w2[off + j] * dH2Lin[j];
      }
      dH1_fromL2[i] = dH1i;
    }

    // ─── Backprop through ReLU 1 + LayerNorm 1 ───
    const dH1Norm = this._dH1Norm;
    for (let j = 0; j < HIDDEN; j++) {
      const dH1j = dH1_fromL2[j] + dH1_residual[j];
      dH1Norm[j] = this.lastH1Norm[j] > 0 ? dH1j : 0;
    }
    const dH1Lin = this._dH1Lin;
    layerNormBackward(dH1Norm, this.lastH1Lin, this.ln1g, this.lastH1Mean, this.lastH1InvStd,
      this.gln1g, this.gln1b, dH1Lin, HIDDEN);

    // ─── Backprop through layer 1 linear ───
    for (let j = 0; j < HIDDEN; j++) this.gb1[j] += dH1Lin[j];
    for (let i = 0; i < FEATURE_SIZE; i++) {
      const inp = this.lastInput[i];
      const off = i * HIDDEN;
      for (let j = 0; j < HIDDEN; j++) this.gw1[off + j] += inp * dH1Lin[j];
    }

    this.gradCount++;
  }

  applyGradients(lr: number): void {
    if (this.gradCount === 0) return;
    const scale = 1.0 / this.gradCount;

    scaleArr(this.gw1, scale); scaleArr(this.gb1, scale);
    scaleArr(this.gw2, scale); scaleArr(this.gb2, scale);
    scaleArr(this.gw3, scale); scaleArr(this.gb3, scale);
    scaleArr(this.gln1g, scale); scaleArr(this.gln1b, scale);
    scaleArr(this.gln2g, scale); scaleArr(this.gln2b, scale);
    scaleArr(this.gln3g, scale); scaleArr(this.gln3b, scale);
    scaleArr(this.gwp, scale); scaleArr(this.gbp, scale);
    scaleArr(this.gwv1, scale); scaleArr(this.gbv1, scale);
    scaleArr(this.gwv2, scale); scaleArr(this.gbv2, scale);

    const norm = gradNorm(
      this.gw1, this.gb1, this.gw2, this.gb2, this.gw3, this.gb3,
      this.gln1g, this.gln1b, this.gln2g, this.gln2b, this.gln3g, this.gln3b,
      this.gwp, this.gbp, this.gwv1, this.gbv1, this.gwv2, this.gbv2,
    );
    if (norm > MAX_GRAD_NORM) {
      const c = MAX_GRAD_NORM / norm;
      scaleArr(this.gw1, c); scaleArr(this.gb1, c);
      scaleArr(this.gw2, c); scaleArr(this.gb2, c);
      scaleArr(this.gw3, c); scaleArr(this.gb3, c);
      scaleArr(this.gln1g, c); scaleArr(this.gln1b, c);
      scaleArr(this.gln2g, c); scaleArr(this.gln2b, c);
      scaleArr(this.gln3g, c); scaleArr(this.gln3b, c);
      scaleArr(this.gwp, c); scaleArr(this.gbp, c);
      scaleArr(this.gwv1, c); scaleArr(this.gbv1, c);
      scaleArr(this.gwv2, c); scaleArr(this.gbv2, c);
    }

    this.adamStep++;
    adamUpdate(this.w1, this.gw1, this.mw1, this.a_vw1, lr, this.adamStep);
    adamUpdate(this.b1, this.gb1, this.mb1, this.a_vb1, lr, this.adamStep);
    adamUpdate(this.w2, this.gw2, this.mw2, this.a_vw2, lr, this.adamStep);
    adamUpdate(this.b2, this.gb2, this.mb2, this.a_vb2, lr, this.adamStep);
    adamUpdate(this.w3, this.gw3, this.mw3, this.a_vw3, lr, this.adamStep);
    adamUpdate(this.b3, this.gb3, this.mb3, this.a_vb3, lr, this.adamStep);
    adamUpdate(this.ln1g, this.gln1g, this.mln1g, this.a_vln1g, lr, this.adamStep);
    adamUpdate(this.ln1b, this.gln1b, this.mln1b, this.a_vln1b, lr, this.adamStep);
    adamUpdate(this.ln2g, this.gln2g, this.mln2g, this.a_vln2g, lr, this.adamStep);
    adamUpdate(this.ln2b, this.gln2b, this.mln2b, this.a_vln2b, lr, this.adamStep);
    adamUpdate(this.ln3g, this.gln3g, this.mln3g, this.a_vln3g, lr, this.adamStep);
    adamUpdate(this.ln3b, this.gln3b, this.mln3b, this.a_vln3b, lr, this.adamStep);
    adamUpdate(this.wp, this.gwp, this.mwp, this.a_vwp, lr, this.adamStep);
    adamUpdate(this.bp, this.gbp, this.mbp, this.a_vbp, lr, this.adamStep);
    adamUpdate(this.wv1, this.gwv1, this.mwv1, this.a_vwv1, lr, this.adamStep);
    adamUpdate(this.bv1, this.gbv1, this.mbv1, this.a_vbv1, lr, this.adamStep);
    adamUpdate(this.wv2, this.gwv2, this.mwv2, this.a_vwv2, lr, this.adamStep);
    adamUpdate(this.bv2, this.gbv2, this.mbv2, this.a_vbv2, lr, this.adamStep);

    this.gw1.fill(0); this.gb1.fill(0);
    this.gw2.fill(0); this.gb2.fill(0);
    this.gw3.fill(0); this.gb3.fill(0);
    this.gln1g.fill(0); this.gln1b.fill(0);
    this.gln2g.fill(0); this.gln2b.fill(0);
    this.gln3g.fill(0); this.gln3b.fill(0);
    this.gwp.fill(0); this.gbp.fill(0);
    this.gwv1.fill(0); this.gbv1.fill(0);
    this.gwv2.fill(0); this.gbv2.fill(0);
    this.gradCount = 0;
  }

  toJSON(): PPONetworkWeights {
    return {
      w1: Array.from(this.w1), b1: Array.from(this.b1),
      w2: Array.from(this.w2), b2: Array.from(this.b2),
      w3: Array.from(this.w3), b3: Array.from(this.b3),
      ln1g: Array.from(this.ln1g), ln1b: Array.from(this.ln1b),
      ln2g: Array.from(this.ln2g), ln2b: Array.from(this.ln2b),
      ln3g: Array.from(this.ln3g), ln3b: Array.from(this.ln3b),
      wp: Array.from(this.wp), bp: Array.from(this.bp),
      wv1: Array.from(this.wv1), bv1: Array.from(this.bv1),
      wv2: Array.from(this.wv2), bv2: Array.from(this.bv2),
    };
  }

  toFullJSON(): PPOFullState {
    return {
      weights: this.toJSON(),
      adam: {
        step: this.adamStep,
        mw1: Array.from(this.mw1), mb1: Array.from(this.mb1),
        mw2: Array.from(this.mw2), mb2: Array.from(this.mb2),
        mw3: Array.from(this.mw3), mb3: Array.from(this.mb3),
        mln1g: Array.from(this.mln1g), mln1b: Array.from(this.mln1b),
        mln2g: Array.from(this.mln2g), mln2b: Array.from(this.mln2b),
        mln3g: Array.from(this.mln3g), mln3b: Array.from(this.mln3b),
        mwp: Array.from(this.mwp), mbp: Array.from(this.mbp),
        mwv1: Array.from(this.mwv1), mbv1: Array.from(this.mbv1),
        mwv2: Array.from(this.mwv2), mbv2: Array.from(this.mbv2),
        vw1: Array.from(this.a_vw1), vb1: Array.from(this.a_vb1),
        vw2: Array.from(this.a_vw2), vb2: Array.from(this.a_vb2),
        vw3: Array.from(this.a_vw3), vb3: Array.from(this.a_vb3),
        vln1g: Array.from(this.a_vln1g), vln1b: Array.from(this.a_vln1b),
        vln2g: Array.from(this.a_vln2g), vln2b: Array.from(this.a_vln2b),
        vln3g: Array.from(this.a_vln3g), vln3b: Array.from(this.a_vln3b),
        vwp: Array.from(this.a_vwp), vbp: Array.from(this.a_vbp),
        vwv1: Array.from(this.a_vwv1), vbv1: Array.from(this.a_vbv1),
        vwv2: Array.from(this.a_vwv2), vbv2: Array.from(this.a_vbv2),
      },
    };
  }

  static fromFullJSON(state: PPOFullState): PPONetwork {
    const net = new PPONetwork(state.weights);
    net.adamStep = state.adam.step;
    net.mw1 = Float32Array.from(state.adam.mw1); net.mb1 = Float32Array.from(state.adam.mb1);
    net.mw2 = Float32Array.from(state.adam.mw2); net.mb2 = Float32Array.from(state.adam.mb2);
    net.mw3 = Float32Array.from(state.adam.mw3); net.mb3 = Float32Array.from(state.adam.mb3);
    if (state.adam.mln1g) {
      net.mln1g = Float32Array.from(state.adam.mln1g); net.mln1b = Float32Array.from(state.adam.mln1b);
      net.mln2g = Float32Array.from(state.adam.mln2g); net.mln2b = Float32Array.from(state.adam.mln2b);
      net.mln3g = Float32Array.from(state.adam.mln3g); net.mln3b = Float32Array.from(state.adam.mln3b);
    }
    net.mwp = Float32Array.from(state.adam.mwp); net.mbp = Float32Array.from(state.adam.mbp);
    if (state.adam.mwv1) {
      net.mwv1 = Float32Array.from(state.adam.mwv1); net.mbv1 = Float32Array.from(state.adam.mbv1!);
      net.mwv2 = Float32Array.from(state.adam.mwv2!); net.mbv2 = Float32Array.from(state.adam.mbv2!);
    }
    net.a_vw1 = Float32Array.from(state.adam.vw1); net.a_vb1 = Float32Array.from(state.adam.vb1);
    net.a_vw2 = Float32Array.from(state.adam.vw2); net.a_vb2 = Float32Array.from(state.adam.vb2);
    net.a_vw3 = Float32Array.from(state.adam.vw3); net.a_vb3 = Float32Array.from(state.adam.vb3);
    if (state.adam.vln1g) {
      net.a_vln1g = Float32Array.from(state.adam.vln1g); net.a_vln1b = Float32Array.from(state.adam.vln1b);
      net.a_vln2g = Float32Array.from(state.adam.vln2g); net.a_vln2b = Float32Array.from(state.adam.vln2b);
      net.a_vln3g = Float32Array.from(state.adam.vln3g); net.a_vln3b = Float32Array.from(state.adam.vln3b);
    }
    net.a_vwp = Float32Array.from(state.adam.vwp); net.a_vbp = Float32Array.from(state.adam.vbp);
    if (state.adam.vwv1) {
      net.a_vwv1 = Float32Array.from(state.adam.vwv1); net.a_vbv1 = Float32Array.from(state.adam.vbv1!);
      net.a_vwv2 = Float32Array.from(state.adam.vwv2!); net.a_vbv2 = Float32Array.from(state.adam.vbv2!);
    }
    return net;
  }

  static fromJSON(json: PPONetworkWeights): PPONetwork {
    return new PPONetwork(json);
  }

  clone(): PPONetwork {
    return PPONetwork.fromJSON(this.toJSON());
  }
}

// ─── LayerNorm utilities ────────────────────────────────────────────────────

/** Forward: out[j] = gamma[j] * (x[j] - mean) * invStd + beta[j]. Returns [mean, invStd]. */
function layerNormInto(
  x: Float32Array, gamma: Float32Array, beta: Float32Array,
  out: Float32Array, n: number,
): [number, number] {
  let mean = 0;
  for (let j = 0; j < n; j++) mean += x[j];
  mean /= n;
  let variance = 0;
  for (let j = 0; j < n; j++) { const d = x[j] - mean; variance += d * d; }
  variance /= n;
  const invStd = 1 / Math.sqrt(variance + LN_EPS);
  for (let j = 0; j < n; j++) {
    out[j] = gamma[j] * (x[j] - mean) * invStd + beta[j];
  }
  return [mean, invStd];
}

/** Backward through LayerNorm. Accumulates into gGamma/gBeta, writes dX into dxOut. */
function layerNormBackward(
  dOut: Float32Array, x: Float32Array, gamma: Float32Array,
  mean: number, invStd: number,
  gGamma: Float32Array, gBeta: Float32Array, dxOut: Float32Array,
  n: number,
): void {
  // Accumulate gamma/beta gradients
  for (let j = 0; j < n; j++) {
    const xhat = (x[j] - mean) * invStd;
    gGamma[j] += dOut[j] * xhat;
    gBeta[j] += dOut[j];
  }
  // dx = invStd * (dOut * gamma - mean(dOut * gamma) - xhat * mean(dOut * gamma * xhat))
  let sumDG = 0;
  let sumDGX = 0;
  for (let j = 0; j < n; j++) {
    const dg = dOut[j] * gamma[j];
    const xhat = (x[j] - mean) * invStd;
    sumDG += dg;
    sumDGX += dg * xhat;
  }
  const invN = 1 / n;
  for (let j = 0; j < n; j++) {
    const xhat = (x[j] - mean) * invStd;
    dxOut[j] = invStd * (dOut[j] * gamma[j] - sumDG * invN - xhat * sumDGX * invN);
  }
}

// ─── Math utilities ───────────────────────────────────────────────────────

/** Softmax writing directly into `out` buffer — zero allocations */
function softmaxInto(logits: Float32Array, out: Float32Array): void {
  let maxVal = -Infinity;
  for (let i = 0; i < logits.length; i++) if (logits[i] > maxVal) maxVal = logits[i];
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    out[i] = Math.exp(logits[i] - maxVal);
    sum += out[i];
  }
  for (let i = 0; i < logits.length; i++) out[i] /= sum;
}

function gradNorm(...arrays: Float32Array[]): number {
  let sumSq = 0;
  for (const arr of arrays) for (let i = 0; i < arr.length; i++) sumSq += arr[i] * arr[i];
  return Math.sqrt(sumSq);
}

function scaleArr(arr: Float32Array, s: number): void {
  for (let i = 0; i < arr.length; i++) arr[i] *= s;
}

function adamUpdate(
  params: Float32Array, grads: Float32Array,
  m: Float32Array, v: Float32Array,
  lr: number, step: number,
): void {
  const bc1 = 1 - Math.pow(ADAM_BETA1, step);
  const bc2 = 1 - Math.pow(ADAM_BETA2, step);
  for (let i = 0; i < params.length; i++) {
    m[i] = ADAM_BETA1 * m[i] + (1 - ADAM_BETA1) * grads[i];
    v[i] = ADAM_BETA2 * v[i] + (1 - ADAM_BETA2) * grads[i] * grads[i];
    const mHat = m[i] / bc1;
    const vHat = v[i] / bc2;
    params[i] += lr * mHat / (Math.sqrt(vHat) + ADAM_EPS);
  }
}
