import { useEffect, useState } from 'preact/hooks';
import { destinationOf, type PlayerView } from '../engine';
import { drawPostcard, postcardFileName } from '../app/postcard';

type Drawn = { url: string; file: File };

/** Can this browser share `file` (the phone's share sheet, mostly)? */
function canShare(file: File): boolean {
  try {
    return typeof navigator.share === 'function' && !!navigator.canShare?.({ files: [file] });
  } catch {
    return false;
  }
}

const canCopy = () => typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function';

/**
 * The landing postcard, drawn when the tab opens: `photo` is the 3D cabin's group shot (null in the 2D view, which
 * gets a class photo of everyone instead). Save it, share it, or copy it.
 */
export function PostcardView({ game, code, faces, photo }: { game: PlayerView; code: string; faces: ReadonlyMap<string, string>; photo: HTMLCanvasElement | null }) {
  const [drawn, setDrawn] = useState<Drawn | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const city = destinationOf(game.settings).city;

  useEffect(() => {
    let live = true;
    let url: string | null = null;
    drawPostcard({ game, code, faces, photo })
      .then((canvas) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png')))
      .then((blob) => {
        if (!live) return;
        if (!blob) throw new Error('no blob');
        url = URL.createObjectURL(blob);
        setDrawn({ url, file: new File([blob], postcardFileName(city), { type: 'image/png' }) });
      })
      .catch(() => live && setNote('The postcard could not be drawn on this device.'));
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
    // One postcard per photo: the flight is over, so nothing else changes under it.
  }, [photo]);

  const share = async () => {
    if (!drawn) return;
    try {
      await navigator.share({ files: [drawn.file], title: 'Flight 13', text: `Greetings from ${city}!` });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setNote('Sharing did not work here: save the picture instead.');
    }
  };
  const copy = async () => {
    if (!drawn) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': drawn.file })]);
      setNote('Copied: paste it into a chat.');
    } catch {
      setNote('Copying did not work here: save the picture instead.');
    }
  };

  return (
    <div class="postcard">
      <div class="postcard-frame">
        {drawn ? <img src={drawn.url} alt={`A postcard from ${city}: everyone aboard Flight 13 and how the flight ended`} /> : <div class="postcard-wait">Developing the photo…</div>}
      </div>
      <div class="row postcard-actions">
        <a class={`btn${drawn ? '' : ' disabled'}`} href={drawn?.url} download={drawn?.file.name} aria-disabled={!drawn}>
          Save picture
        </a>
        {drawn && canShare(drawn.file) && (
          <button class="btn" onClick={() => void share()}>
            Share
          </button>
        )}
        {drawn && canCopy() && (
          <button class="btn ghost" onClick={() => void copy()}>
            Copy
          </button>
        )}
        {note && <span class="muted">{note}</span>}
      </div>
    </div>
  );
}
