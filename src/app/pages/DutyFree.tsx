import { useMemo, useState } from 'preact/hooks';
import { ITEMS, ITEM_ORDER, type ItemId } from '../../engine';
import { ACCESSORIES, ACCESSORY_SLOTS } from '../../meta/accessories';
import { ACHIEVEMENTS } from '../../meta/achievements';
import { buy, buyAccessory, countOf, ownsAccessory, type ItemCounts } from '../../meta/bag';
import { redeem } from '../../meta/codes';
import { Credits } from '../../meta/Credits';
import { ItemIcon } from '../../meta/ItemIcon';
import { PRICES, whenLabel } from '../../meta/shop';
import { getBag, updateBag, useBag } from '../../meta/store';
import { Avatar } from '../Avatar';
import { loadProfile } from '../profile';

type Tab = 'shop' | 'accessories' | 'bag' | 'achievements' | 'code';

const TABS: { id: Tab; label: string }[] = [
  { id: 'shop', label: 'Shop' },
  { id: 'accessories', label: 'Accessories' },
  { id: 'bag', label: 'Your bag' },
  { id: 'achievements', label: 'Achievements' },
  { id: 'code', label: 'Redeem a code' },
];

function describeCounts(items: ItemCounts): string {
  return (Object.entries(items) as [ItemId, number][]).map(([id, n]) => `${n > 1 ? `${n} × ` : ''}${ITEMS[id].name}`).join(', ');
}

/** Spend flight credits on carry-on items, see what you own and what you have unlocked, and use codes. */
export function DutyFree() {
  const bag = useBag();
  const [tab, setTab] = useState<Tab>('shop');
  const [flash, setFlash] = useState<{ item: ItemId; at: number } | null>(null);
  const owned = ITEM_ORDER.filter((id) => countOf(bag, id) > 0);
  const unlocked = ACHIEVEMENTS.filter((a) => bag.achievements[a.id]).length;

  const purchase = (item: ItemId) => {
    updateBag((b) => buy(b, item) ?? b);
    setFlash({ item, at: Date.now() });
  };

  return (
    <div class="duty-free">
      <header class="df-head">
        <div>
          <a class="df-back" href="#/">
            ← Terminal
          </a>
          <h1>Duty Free</h1>
          <p class="muted">Pack up to three items for every flight. Earn credits by winning, surviving and saving lives.</p>
        </div>
        <div class="df-balance">
          <span class="label">Your credits</span>
          <Credits amount={bag.credits} />
        </div>
      </header>

      <nav class="segmented df-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} class={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === 'achievements' && <span class="df-count">{`${unlocked}/${ACHIEVEMENTS.length}`}</span>}
          </button>
        ))}
      </nav>

      {tab === 'shop' && (
        <ul class="df-grid">
          {ITEM_ORDER.map((id) => {
            const info = ITEMS[id];
            const price = PRICES[id];
            const have = countOf(bag, id);
            return (
              <li key={flash?.item === id ? `${id}:${flash.at}` : id} class={`df-item${flash?.item === id ? ' bought' : ''}`}>
                <div class="df-item-top">
                  <span class="df-icon">
                    <ItemIcon item={id} size={30} />
                  </span>
                  <span class={`when when-${info.automatic ? 'auto' : info.when}`}>{whenLabel(info.when, info.automatic)}</span>
                </div>
                <h3>{info.name}</h3>
                <p>{info.blurb}</p>
                <div class="df-item-foot">
                  <span class="muted">{have > 0 ? `You have ${have}` : 'None yet'}</span>
                  <button class="btn primary small" disabled={bag.credits < price} onClick={() => purchase(id)}>
                    Buy · <Credits amount={price} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {tab === 'accessories' && <AccessoryShop />}

      {tab === 'bag' &&
        (owned.length === 0 ? (
          <p class="df-empty">Your bag is empty. Win flights, unlock achievements or shop here to fill it.</p>
        ) : (
          <ul class="df-grid">
            {owned.map((id) => (
              <li key={id} class="df-item">
                <div class="df-item-top">
                  <span class="df-icon">
                    <ItemIcon item={id} size={30} />
                  </span>
                  <span class="df-owned">× {countOf(bag, id)}</span>
                </div>
                <h3>{ITEMS[id].name}</h3>
                <p>{ITEMS[id].blurb}</p>
              </li>
            ))}
          </ul>
        ))}

      {tab === 'achievements' && (
        <ul class="df-achievements">
          {ACHIEVEMENTS.map((a) => {
            const done = !!bag.achievements[a.id];
            return (
              <li key={a.id} class={done ? 'done' : ''}>
                <span class="df-badge" aria-hidden="true">
                  {done ? '✓' : '?'}
                </span>
                <div>
                  <h3>{a.name}</h3>
                  <p>{a.description}</p>
                </div>
                <span class="df-reward" title={`Unlocks ${ITEMS[a.reward].name}`}>
                  <ItemIcon item={a.reward} size={22} muted={!done} />
                  {ITEMS[a.reward].name}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {tab === 'code' && <RedeemForm />}

      <p class="df-note muted">Credits and items are kept in this browser. Clearing site data empties your bag.</p>
    </div>
  );
}

/** Hats, eyewear and things for the neck: each card shows your own passenger wearing it. Bought once, worn forever. */
function AccessoryShop() {
  const bag = useBag();
  const profile = useMemo(() => loadProfile(), []);
  const [flash, setFlash] = useState<{ id: string; at: number } | null>(null);
  const purchase = (id: string) => {
    updateBag((b) => buyAccessory(b, id) ?? b);
    setFlash({ id, at: Date.now() });
  };
  return (
    <>
      <p class="muted df-lead">Purely for looks. Wear them in the wardrobe (Customize); everyone on your flight sees them.</p>
      {ACCESSORY_SLOTS.map(({ slot, label }) => (
        <section key={slot} class="df-section">
          <h2>{label}</h2>
          <ul class="df-grid">
            {ACCESSORIES.filter((a) => a.slot === slot).map((a) => {
              const owned = ownsAccessory(bag, a.id);
              return (
                <li key={flash?.id === a.id ? `${a.id}:${flash.at}` : a.id} class={`df-item df-accessory${flash?.id === a.id ? ' bought' : ''}`}>
                  <div class="df-item-top">
                    <Avatar look={{ ...profile.look, [slot]: a.index }} face={profile.face} size={64} />
                  </div>
                  <h3>{a.name}</h3>
                  <p>{a.blurb}</p>
                  <div class="df-item-foot">
                    {owned ? (
                      <span class="df-owned">✓ Owned</span>
                    ) : (
                      <button class="btn primary small" disabled={bag.credits < a.price} onClick={() => purchase(a.id)}>
                        Buy · <Credits amount={a.price} />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}

function RedeemForm() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    const outcome = await redeem(getBag(), code);
    setBusy(false);
    if (!outcome.ok) {
      setResult({ ok: false, text: outcome.error });
      return;
    }
    updateBag(() => outcome.bag);
    const parts = [outcome.reward.credits ? `${outcome.reward.credits} credits` : '', describeCounts(outcome.reward.items ?? {})].filter(Boolean);
    setResult({ ok: true, text: `Added to your bag: ${parts.join(', ')}.` });
    setCode('');
  };
  return (
    <form class="df-redeem" onSubmit={submit}>
      <label class="label" for="df-code">
        Developer code
      </label>
      <div class="row">
        <input
          id="df-code"
          class="input code-input"
          placeholder="XXXX-XXXX"
          value={code}
          maxLength={32}
          autocomplete="off"
          spellcheck={false}
          onInput={(e) => setCode(e.currentTarget.value)}
        />
        <button class="btn primary" type="submit" disabled={busy || !code.trim()}>
          Redeem
        </button>
      </div>
      {result && <p class={result.ok ? 'df-ok' : 'error-text'}>{result.text}</p>}
    </form>
  );
}
