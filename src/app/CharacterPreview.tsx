import { useEffect, useRef, useState } from 'preact/hooks';
import type { Look } from '../engine';
import type { CharacterStage, Framing } from '../world/stage';
import { Avatar } from './Avatar';

/**
 * Your passenger as they will look on the plane: a 3D turntable you can drag round. The flat portrait
 * stands in while it loads, and for good if the device has no WebGL.
 */
export function CharacterPreview({ look, face, framing }: { look: Look; face: string; framing: Framing }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stage = useRef<CharacterStage | null>(null);
  const latest = useRef({ look, face, framing });
  latest.current = { look, face, framing };
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let created: CharacterStage | null = null;
    import('../world/stage')
      .then(({ CharacterStage }) => {
        if (cancelled || !canvasRef.current) return;
        created = new CharacterStage(canvasRef.current);
        stage.current = created;
        created.set(latest.current.look, latest.current.face);
        created.setFraming(latest.current.framing, true);
        setReady(true);
      })
      .catch((err: unknown) => {
        console.warn('3D preview unavailable', err);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      created?.dispose();
      stage.current = null;
    };
  }, []);

  useEffect(() => stage.current?.set(look, face), [look, face]);
  useEffect(() => stage.current?.setFraming(framing), [framing]);

  return (
    <div class={`character-preview${ready ? ' ready' : ''}`}>
      {!ready && <Avatar look={look} face={face} size={180} />}
      {!failed && <canvas ref={canvasRef} aria-label="Your passenger in 3D. Drag to turn them round." />}
      {ready && <span class="preview-hint">Drag to turn</span>}
    </div>
  );
}
