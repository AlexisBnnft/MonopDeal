// Legacy REINFORCE network -- kept for backward compatibility with old models.
// Uses its own FEATURE_SIZE (128) which matches old saved weights.
const FEATURE_SIZE = 128;

export interface NetworkWeights {
  w1: number[];   // FEATURE_SIZE × HIDDEN1
  b1: number[];   // HIDDEN1
  w2: number[];   // HIDDEN1 × HIDDEN2
  b2: number[];   // HIDDEN2
  w3: number[];   // HIDDEN2 × MAX_ACTIONS
  b3: number[];   // MAX_ACTIONS
}

const HIDDEN1 = 128;
const HIDDEN2 = 64;
export const MAX_ACTIONS = 50;
const MAX_GRAD_NORM = 1.0;
const ADVANTAGE_CLIP = 2.0;

const ADAM_BETA1 = 0.9;
const ADAM_BETA2 = 0.999;
const ADAM_EPS = 1e-8;

function initRandom(size: number, scale: number): number[] {
  const arr = new Array(size);
  for (let i = 0; i < size; i++) {
    arr[i] = (Math.random() - 0.5) * 2 * scale;
  }
  return arr;
}

export class PolicyNetwork {
  w1: Float64Array; b1: Float64Array;
  w2: Float64Array; b2: Float64Array;
  w3: Float64Array; b3: Float64Array;

  // Gradient accumulators
  private gw1: Float64Array; private gb1: Float64Array;
  private gw2: Float64Array; private gb2: Float64Array;
  private gw3: Float64Array; private gb3: Float64Array;
  private gradCount = 0;

  // Adam first moment (mean)
  private mw1: Float64Array; private mb1: Float64Array;
  private mw2: Float64Array; private mb2: Float64Array;
  private mw3: Float64Array; private mb3: Float64Array;

  // Adam second moment (variance)
  private vw1: Float64Array; private vb1: Float64Array;
  private vw2: Float64Array; private vb2: Float64Array;
  private vw3: Float64Array; private vb3: Float64Array;

  private adamStep = 0;

  // Cached activations for backward pass
  private lastInput!: Float64Array;
  private lastH1Pre!: Float64Array;
  private lastH1!: Float64Array;
  private lastH2Pre!: Float64Array;
  private lastH2!: Float64Array;
  private lastLogits!: Float64Array;
  private lastProbs!: Float64Array;

  constructor(weights?: NetworkWeights) {
    if (weights) {
      this.w1 = Float64Array.from(weights.w1);
      this.b1 = Float64Array.from(weights.b1);
      this.w2 = Float64Array.from(weights.w2);
      this.b2 = Float64Array.from(weights.b2);
      this.w3 = Float64Array.from(weights.w3);
      this.b3 = Float64Array.from(weights.b3);
    } else {
      const s1 = Math.sqrt(2 / FEATURE_SIZE);
      const s2 = Math.sqrt(2 / HIDDEN1);
      const s3 = Math.sqrt(2 / HIDDEN2);
      this.w1 = Float64Array.from(initRandom(FEATURE_SIZE * HIDDEN1, s1));
      this.b1 = new Float64Array(HIDDEN1);
      this.w2 = Float64Array.from(initRandom(HIDDEN1 * HIDDEN2, s2));
      this.b2 = new Float64Array(HIDDEN2);
      this.w3 = Float64Array.from(initRandom(HIDDEN2 * MAX_ACTIONS, s3));
      this.b3 = new Float64Array(MAX_ACTIONS);
    }

    // Gradient accumulators
    this.gw1 = new Float64Array(FEATURE_SIZE * HIDDEN1);
    this.gb1 = new Float64Array(HIDDEN1);
    this.gw2 = new Float64Array(HIDDEN1 * HIDDEN2);
    this.gb2 = new Float64Array(HIDDEN2);
    this.gw3 = new Float64Array(HIDDEN2 * MAX_ACTIONS);
    this.gb3 = new Float64Array(MAX_ACTIONS);

    // Adam moments
    this.mw1 = new Float64Array(FEATURE_SIZE * HIDDEN1);
    this.mb1 = new Float64Array(HIDDEN1);
    this.mw2 = new Float64Array(HIDDEN1 * HIDDEN2);
    this.mb2 = new Float64Array(HIDDEN2);
    this.mw3 = new Float64Array(HIDDEN2 * MAX_ACTIONS);
    this.mb3 = new Float64Array(MAX_ACTIONS);

    this.vw1 = new Float64Array(FEATURE_SIZE * HIDDEN1);
    this.vb1 = new Float64Array(HIDDEN1);
    this.vw2 = new Float64Array(HIDDEN1 * HIDDEN2);
    this.vb2 = new Float64Array(HIDDEN2);
    this.vw3 = new Float64Array(HIDDEN2 * MAX_ACTIONS);
    this.vb3 = new Float64Array(MAX_ACTIONS);
  }

  forward(input: Float64Array, validMask: boolean[]): { probs: Float64Array; logits: Float64Array } {
    this.lastInput = input;

    const h1pre = new Float64Array(HIDDEN1);
    for (let j = 0; j < HIDDEN1; j++) {
      let sum = this.b1[j];
      for (let i = 0; i < FEATURE_SIZE; i++) {
        sum += input[i] * this.w1[i * HIDDEN1 + j];
      }
      h1pre[j] = sum;
    }
    this.lastH1Pre = h1pre;
    const h1 = new Float64Array(HIDDEN1);
    for (let j = 0; j < HIDDEN1; j++) h1[j] = Math.max(0, h1pre[j]);
    this.lastH1 = h1;

    const h2pre = new Float64Array(HIDDEN2);
    for (let j = 0; j < HIDDEN2; j++) {
      let sum = this.b2[j];
      for (let i = 0; i < HIDDEN1; i++) {
        sum += h1[i] * this.w2[i * HIDDEN2 + j];
      }
      h2pre[j] = sum;
    }
    this.lastH2Pre = h2pre;
    const h2 = new Float64Array(HIDDEN2);
    for (let j = 0; j < HIDDEN2; j++) h2[j] = Math.max(0, h2pre[j]);
    this.lastH2 = h2;

    const logits = new Float64Array(MAX_ACTIONS);
    for (let j = 0; j < MAX_ACTIONS; j++) {
      let sum = this.b3[j];
      for (let i = 0; i < HIDDEN2; i++) {
        sum += h2[i] * this.w3[i * MAX_ACTIONS + j];
      }
      logits[j] = sum;
    }

    for (let j = 0; j < MAX_ACTIONS; j++) {
      if (!validMask[j]) logits[j] = -1e9;
    }
    this.lastLogits = logits;

    const probs = softmax(logits);
    this.lastProbs = probs;

    return { probs, logits };
  }

  sampleAction(probs: Float64Array): number {
    const r = Math.random();
    let cum = 0;
    for (let i = 0; i < probs.length; i++) {
      cum += probs[i];
      if (r < cum) return i;
    }
    return probs.length - 1;
  }

  /**
   * Accumulate REINFORCE gradient for one step.
   * MUST be called immediately after the corresponding forward() call
   * so that cached activations (lastProbs, lastH1, etc.) are correct.
   */
  accumulateGradient(actionIdx: number, advantage: number, entropyBonus: number): void {
    const clippedAdv = Math.max(-ADVANTAGE_CLIP, Math.min(ADVANTAGE_CLIP, advantage));

    const dLogits = new Float64Array(MAX_ACTIONS);
    for (let j = 0; j < MAX_ACTIONS; j++) {
      const p = this.lastProbs[j];
      dLogits[j] = clippedAdv * ((j === actionIdx ? 1 : 0) - p);
      if (p > 1e-10) {
        dLogits[j] += entropyBonus * (-(Math.log(p) + 1));
      }
    }

    const dH2 = new Float64Array(HIDDEN2);
    for (let j = 0; j < MAX_ACTIONS; j++) {
      this.gb3[j] += dLogits[j];
      for (let i = 0; i < HIDDEN2; i++) {
        this.gw3[i * MAX_ACTIONS + j] += this.lastH2[i] * dLogits[j];
        dH2[i] += this.w3[i * MAX_ACTIONS + j] * dLogits[j];
      }
    }

    const dH2Pre = new Float64Array(HIDDEN2);
    for (let j = 0; j < HIDDEN2; j++) {
      dH2Pre[j] = this.lastH2Pre[j] > 0 ? dH2[j] : 0;
    }

    const dH1 = new Float64Array(HIDDEN1);
    for (let j = 0; j < HIDDEN2; j++) {
      this.gb2[j] += dH2Pre[j];
      for (let i = 0; i < HIDDEN1; i++) {
        this.gw2[i * HIDDEN2 + j] += this.lastH1[i] * dH2Pre[j];
        dH1[i] += this.w2[i * HIDDEN2 + j] * dH2Pre[j];
      }
    }

    const dH1Pre = new Float64Array(HIDDEN1);
    for (let j = 0; j < HIDDEN1; j++) {
      dH1Pre[j] = this.lastH1Pre[j] > 0 ? dH1[j] : 0;
    }

    for (let j = 0; j < HIDDEN1; j++) {
      this.gb1[j] += dH1Pre[j];
      for (let i = 0; i < FEATURE_SIZE; i++) {
        this.gw1[i * HIDDEN1 + j] += this.lastInput[i] * dH1Pre[j];
      }
    }

    this.gradCount++;
  }

  applyGradients(lr: number): void {
    if (this.gradCount === 0) return;
    const scale = 1.0 / this.gradCount;

    // Scale gradients by 1/count to get the mean
    scaleArray(this.gw1, scale); scaleArray(this.gb1, scale);
    scaleArray(this.gw2, scale); scaleArray(this.gb2, scale);
    scaleArray(this.gw3, scale); scaleArray(this.gb3, scale);

    // Gradient norm clipping on the mean gradients
    const norm = gradNorm(this.gw1, this.gb1, this.gw2, this.gb2, this.gw3, this.gb3);
    if (norm > MAX_GRAD_NORM) {
      const clipFactor = MAX_GRAD_NORM / norm;
      scaleArray(this.gw1, clipFactor); scaleArray(this.gb1, clipFactor);
      scaleArray(this.gw2, clipFactor); scaleArray(this.gb2, clipFactor);
      scaleArray(this.gw3, clipFactor); scaleArray(this.gb3, clipFactor);
    }

    this.adamStep++;

    adamUpdate(this.w1, this.gw1, this.mw1, this.vw1, lr, this.adamStep);
    adamUpdate(this.b1, this.gb1, this.mb1, this.vb1, lr, this.adamStep);
    adamUpdate(this.w2, this.gw2, this.mw2, this.vw2, lr, this.adamStep);
    adamUpdate(this.b2, this.gb2, this.mb2, this.vb2, lr, this.adamStep);
    adamUpdate(this.w3, this.gw3, this.mw3, this.vw3, lr, this.adamStep);
    adamUpdate(this.b3, this.gb3, this.mb3, this.vb3, lr, this.adamStep);

    this.gw1.fill(0); this.gb1.fill(0);
    this.gw2.fill(0); this.gb2.fill(0);
    this.gw3.fill(0); this.gb3.fill(0);
    this.gradCount = 0;
  }

  entropy(probs: Float64Array): number {
    let h = 0;
    for (let i = 0; i < probs.length; i++) {
      if (probs[i] > 1e-10) h -= probs[i] * Math.log(probs[i]);
    }
    return h;
  }

  toJSON(): NetworkWeights {
    return {
      w1: Array.from(this.w1), b1: Array.from(this.b1),
      w2: Array.from(this.w2), b2: Array.from(this.b2),
      w3: Array.from(this.w3), b3: Array.from(this.b3),
    };
  }

  static fromJSON(json: NetworkWeights): PolicyNetwork {
    return new PolicyNetwork(json);
  }

  clone(): PolicyNetwork {
    return PolicyNetwork.fromJSON(this.toJSON());
  }
}

function softmax(logits: Float64Array): Float64Array {
  const maxVal = Math.max(...logits);
  const exps = new Float64Array(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    exps[i] = Math.exp(logits[i] - maxVal);
    sum += exps[i];
  }
  for (let i = 0; i < logits.length; i++) {
    exps[i] /= sum;
  }
  return exps;
}

function gradNorm(...arrays: Float64Array[]): number {
  let sumSq = 0;
  for (const arr of arrays) {
    for (let i = 0; i < arr.length; i++) sumSq += arr[i] * arr[i];
  }
  return Math.sqrt(sumSq);
}

function scaleArray(arr: Float64Array, s: number): void {
  for (let i = 0; i < arr.length; i++) arr[i] *= s;
}

function adamUpdate(
  params: Float64Array, grads: Float64Array,
  m: Float64Array, v: Float64Array,
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
