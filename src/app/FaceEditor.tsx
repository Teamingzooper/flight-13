import { useEffect, useRef, useState } from 'preact/hooks';
import { FACE_MAX_CHARS, FACE_SIZE, FACE_TEMPLATES, decodeFace, encodeFace, stroke } from '../net/face';
import { HAIR_PATHS } from './Avatar';
import { faceUrl, paintFace } from './faceImage';

type Tool = 'fine' | 'bold' | 'eraser';
const RADIUS: Record<Tool, number> = { fine: 1.15, bold: 2.3, eraser: 3 };
const HISTORY = 40;
const HAIR_TINT = [40, 32, 26];

/**
 * Paint your face in black on your head's skin. The hairstyle shows faintly on top so you can see what
 * it will cover (traced from the 3D hair once that has loaded). Every finished stroke is reported as the
 * compact face text.
 */
export function FaceEditor({ face, skin, hair, onChange }: { face: string; skin: string; hair: number; onChange: (face: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ink = useRef<Uint8Array>(decodeFace(face) ?? new Uint8Array(FACE_SIZE * FACE_SIZE));
  const history = useRef<Uint8Array[]>([]);
  const last = useRef<{ x: number; y: number } | null>(null);
  const frame = useRef(0);
  const [tool, setTool] = useState<Tool>('fine');
  const [tooBusy, setTooBusy] = useState(false);
  const [, setVersion] = useState(0);
  const [hairMask, setHairMask] = useState<((style: number) => Uint8Array) | null>(null);
  const overlay = useRef<{ hair: number; image: HTMLCanvasElement } | null>(null);

  useEffect(() => {
    let alive = true;
    import('../world/hairMask')
      .then((m) => alive && setHairMask(() => m.hairMask))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // Adopt a face chosen elsewhere (a template, a reset) without losing strokes in progress.
  useEffect(() => {
    if (last.current) return;
    if (encodeFace(ink.current) !== face) ink.current = decodeFace(face) ?? new Uint8Array(FACE_SIZE * FACE_SIZE);
    draw();
  }, [face]);
  useEffect(() => draw(), [skin, hair, hairMask]);

  function draw(): void {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const size = canvas.width;
    const g = canvas.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, size, size);
    // The head, filling the drawing area (the grid runs ear to ear and brow to chin).
    g.fillStyle = skin;
    g.beginPath();
    g.ellipse(size / 2, size / 2, size * 0.49, size * 0.49, 0, 0, Math.PI * 2);
    g.fill();
    // Faint guides for eyes and mouth.
    g.strokeStyle = 'rgba(0,0,0,0.09)';
    g.setLineDash([size / 64, size / 40]);
    g.lineWidth = Math.max(1, size / 256);
    for (const y of [27, 45]) {
      g.beginPath();
      g.moveTo(size * 0.18, (y / 64) * size);
      g.lineTo(size * 0.82, (y / 64) * size);
      g.stroke();
    }
    g.setLineDash([]);
    g.drawImage(paintFace(ink.current, size), 0, 0);
    // Where your hair sits: traced from the 3D hair, or the portrait's hair until that has loaded
    // (the portrait's head spans 12..28 x 9..25 of its 40-unit box).
    const path = HAIR_PATHS[hair];
    if (hairMask) {
      if (overlay.current?.hair !== hair || overlay.current.image.width !== size) {
        overlay.current = { hair, image: paintFace(hairMask(hair), size, HAIR_TINT) };
      }
      g.globalAlpha = 0.34;
      g.drawImage(overlay.current.image, 0, 0);
      g.globalAlpha = 1;
    } else if (path) {
      const s = size / 16;
      g.setTransform(s, 0, 0, s, -12 * s, -9 * s);
      g.fillStyle = 'rgba(40, 32, 26, 0.3)';
      g.fill(new Path2D(path));
      g.setTransform(1, 0, 0, 1, 0, 0);
    }
  }

  const schedule = () => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      draw();
    });
  };

  const remember = () => {
    history.current.push(ink.current.slice());
    if (history.current.length > HISTORY) history.current.shift();
  };

  const commit = () => {
    const text = encodeFace(ink.current);
    if (text.length > FACE_MAX_CHARS) {
      // Too much detail to send: step back to the last stroke that fitted.
      setTooBusy(true);
      const previous = history.current.pop();
      if (previous) ink.current = previous;
      draw();
      return;
    }
    setTooBusy(false);
    onChange(text);
    setVersion((v) => v + 1);
  };

  const toGrid = (e: PointerEvent) => {
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * FACE_SIZE, y: ((e.clientY - rect.top) / rect.height) * FACE_SIZE };
  };

  const down = (e: PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
    remember();
    const p = toGrid(e);
    last.current = p;
    stroke(ink.current, p.x, p.y, p.x, p.y, RADIUS[tool], tool === 'eraser');
    schedule();
  };

  const move = (e: PointerEvent) => {
    if (!last.current) return;
    const p = toGrid(e);
    stroke(ink.current, last.current.x, last.current.y, p.x, p.y, RADIUS[tool], tool === 'eraser');
    last.current = p;
    schedule();
  };

  const up = () => {
    if (!last.current) return;
    last.current = null;
    commit();
  };

  const undo = () => {
    const previous = history.current.pop();
    if (!previous) return;
    ink.current = previous;
    draw();
    commit();
  };

  const replace = (next: Uint8Array) => {
    remember();
    ink.current = next;
    draw();
    commit();
  };

  return (
    <div class="face-editor">
      <canvas
        ref={canvasRef}
        class={`face-canvas tool-${tool}`}
        width={512}
        height={512}
        aria-label="Draw your face"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />
      <div class="face-tools">
        <div class="segmented">
          {(['fine', 'bold', 'eraser'] as const).map((t) => (
            <button key={t} type="button" class={tool === t ? 'on' : ''} onClick={() => setTool(t)}>
              {t === 'fine' ? 'Fine brush' : t === 'bold' ? 'Bold brush' : 'Eraser'}
            </button>
          ))}
        </div>
        <div class="row">
          <button type="button" class="btn small" disabled={history.current.length === 0} onClick={undo}>
            Undo
          </button>
          <button type="button" class="btn ghost small" onClick={() => replace(new Uint8Array(FACE_SIZE * FACE_SIZE))}>
            Clear
          </button>
        </div>
        {tooBusy && <p class="error-text">That is a lot of paint. Keep it a little simpler so it can reach everyone.</p>}
        <div class="label">Or start from</div>
        <div class="face-templates">
          {FACE_TEMPLATES.map((t) => (
            <button key={t.name} type="button" class="face-template" title={t.name} onClick={() => replace(decodeFace(t.face)!)}>
              <span class="face-template-head" style={{ background: skin }}>
                <img src={faceUrl(t.face) ?? ''} alt="" />
              </span>
              <span>{t.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
