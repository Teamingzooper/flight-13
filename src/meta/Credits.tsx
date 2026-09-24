import { IconPlane } from '../tv/icons';

/** Flight credits, with the little plane that stands for them. */
export function Credits({ amount }: { amount: number }) {
  return (
    <span class="credits" aria-label={`${amount} flight credits`}>
      <IconPlane />
      {amount.toLocaleString()}
    </span>
  );
}
