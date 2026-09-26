import { EffectComposer } from 'postprocessing';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { getPrefs, subscribePrefs } from '../app/prefs';
import { graphicsProfile, setDetail, type GraphicsProfile } from './graphics';
import { buildPostChain, disposePostChain, type PostChain } from './post';

const TOUCH = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/**
 * A renderer for one scene outside the cabin (the safety card on the Terminal): the graphics setting's resolution,
 * shadows, reflections and effects chain, the same as the cabin's, following the setting as it changes.
 */
export class SceneStage {
  readonly renderer: THREE.WebGLRenderer;
  profile: GraphicsProfile;
  private readonly composer: EffectComposer;
  private readonly envMap: THREE.Texture;
  private chain: PostChain = { ao: null, effects: [] };
  private readonly offPrefs: () => void;
  private readonly resizeObserver: ResizeObserver;

  constructor(
    private readonly container: HTMLElement,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    /** The setting changed: shadows, reflections and the like, for the scene to follow. */
    private readonly onProfile: (profile: GraphicsProfile) => void,
    /** The size changed. */
    private readonly onResize: (width: number, height: number) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.classList.add('stage-gl');
    container.appendChild(this.renderer.domElement);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environmentIntensity = 0.3;
    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType });
    this.profile = graphicsProfile(getPrefs().quality, TOUCH);
    this.apply(this.profile);
    this.offPrefs = subscribePrefs((prefs) => {
      if (prefs.quality !== this.profile.quality) this.apply(graphicsProfile(prefs.quality, TOUCH));
      else this.resize();
    });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
  }

  /** Compile every shader before the first frame is needed (so nothing stutters when it slides into view). */
  async warm(): Promise<void> {
    this.resize();
    await this.renderer.compileAsync(this.scene, this.camera);
    this.present(0);
  }

  present(dt: number): void {
    if (this.profile.post === 'none') this.renderer.render(this.scene, this.camera);
    else this.composer.render(dt);
  }

  dispose(): void {
    this.offPrefs();
    this.resizeObserver.disconnect();
    disposePostChain(this.chain);
    this.composer.dispose();
    this.envMap.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private apply(profile: GraphicsProfile): void {
    const before = this.profile;
    this.profile = profile;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, profile.pixelRatio));
    this.renderer.toneMapping = profile.post === 'none' ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = profile.shadows;
    this.scene.environment = profile.environment ? this.envMap : null;
    setDetail(profile.detail, profile.anisotropy);
    this.onProfile(profile);
    if (before !== profile) {
      this.scene.traverse((o) => {
        const material = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        for (const m of Array.isArray(material) ? material : material ? [material] : []) m.needsUpdate = true;
      });
    }
    disposePostChain(this.chain);
    this.chain = buildPostChain(this.composer, this.scene, this.camera, profile, this.container.clientWidth || 1, this.container.clientHeight || 1);
    this.resize();
  }

  private resize(): void {
    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height, false);
    this.onResize(width, height);
  }
}
