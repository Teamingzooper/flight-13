import {
  BlendFunction,
  BloomEffect,
  ChromaticAberrationEffect,
  type Effect,
  type EffectComposer,
  EffectPass,
  NoiseEffect,
  RenderPass,
  SMAAEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import * as THREE from 'three';
import type { GraphicsProfile } from './graphics';

/** The passes a graphics setting put in a composer (to point at another scene, or throw away). */
export interface PostChain {
  ao: N8AOPostPass | null;
  effects: Effect[];
}

/**
 * The effects chain for a graphics setting, into `composer` (its old passes removed): ambient occlusion straight
 * after the scene, then bloom, vignette, film grain and tone mapping, lens fringing, and SMAA to smooth edges.
 */
export function buildPostChain(
  composer: EffectComposer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  p: GraphicsProfile,
  width: number,
  height: number,
): PostChain {
  composer.removeAllPasses();
  composer.multisampling = p.multisampling;
  composer.addPass(new RenderPass(scene, camera));
  const chain: PostChain = { ao: null, effects: [] };
  if (p.post === 'none') return chain;
  if (p.ao !== 'off') {
    const ao = new N8AOPostPass(scene, camera, width, height);
    ao.configuration.aoRadius = 0.42;
    ao.configuration.distanceFalloff = 1;
    ao.configuration.intensity = 2.4;
    ao.configuration.color = new THREE.Color('#0b0d14');
    ao.configuration.gammaCorrection = false;
    ao.setQualityMode(p.ao);
    if (p.ao !== 'High') ao.configuration.halfRes = true;
    composer.addPass(ao);
    chain.ao = ao;
  }
  const main: Effect[] = [];
  if (p.bloom) {
    main.push(
      new BloomEffect({
        mipmapBlur: true,
        luminanceThreshold: p.tone === 'neutral' ? 0.88 : 0.82,
        luminanceSmoothing: 0.2,
        intensity: p.quality === 'ultra' ? 0.85 : 0.75,
        radius: p.quality === 'ultra' ? 0.72 : 0.65,
        levels: p.quality === 'ultra' ? 9 : 7,
      }),
    );
  }
  main.push(new VignetteEffect({ offset: 0.3, darkness: p.post === 'light' ? 0.45 : 0.6 }));
  if (p.grain > 0) {
    const noise = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY });
    noise.blendMode.opacity.value = p.grain;
    main.push(noise);
  }
  main.push(new ToneMappingEffect({ mode: p.tone === 'neutral' ? ToneMappingMode.NEUTRAL : ToneMappingMode.ACES_FILMIC }));
  chain.effects.push(...main);
  composer.addPass(new EffectPass(camera, ...main));
  if (p.fringe) {
    const fringe = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.0007, 0.0005), radialModulation: true, modulationOffset: 0.4 });
    chain.effects.push(fringe);
    composer.addPass(new EffectPass(camera, fringe));
  }
  if (p.smaa) {
    const smaa = new SMAAEffect();
    chain.effects.push(smaa);
    composer.addPass(new EffectPass(camera, smaa));
  }
  return chain;
}

export function disposePostChain(chain: PostChain): void {
  chain.ao?.dispose();
  for (const effect of chain.effects) effect.dispose();
}
