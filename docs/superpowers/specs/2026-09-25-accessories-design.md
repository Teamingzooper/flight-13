# Accessories (M20)

2026-09-25. The user picked "Accessories" from the ideas list: cosmetics for your passenger, sold at Duty Free. They then said "DO ALL" and "keep going", so the details below are my calls.

## What there is

Three new slots on every passenger, each empty by default. Accessories are purely cosmetic: they change nothing in play, and everyone on the flight sees them in 3D and on the 2D portraits.

| Slot | Accessories |
| --- | --- |
| Hat | Beanie, Captain's hat, Fedora, Party hat, Cowboy hat, Beret |
| Eyewear | Round glasses, Sunglasses, Aviators, Sleep mask (up on the forehead), Heart glasses |
| Neck | Scarf, Tie, Bow tie, Headphones, Lei, Gold chain |

- Prices run from 60 to 150 credits. The catalog order is the look index, so the list only ever grows at the end.

## Owning and wearing

- The bag keeps `wardrobe`: the accessory ids you own, never used up. Older bags start with none.
- **Duty Free** gets an Accessories tab. Each card shows your own passenger wearing the item, with its price and a Buy button, or ✓ Owned.
- **The wardrobe** gets an Extras section with a row per slot: None, then every accessory.
  - Owned ones are tiles you pick.
  - The rest show a lock and the price, and a Buy button when you can afford it.
  - "Surprise me" keeps your accessories.
- Bots wear random accessories: each slot is empty half the time.

## Data

- `Look` gains `hat`, `eyes` and `neck`, where 0 is none.
- `LOOK_LIMITS` grows to match, and `cleanLook` fills in 0 for older clients.
- `src/meta/accessories.ts` holds the catalog: id, slot, index, name, price and colours.

## Drawing

- **3D:** each accessory is one or more parts on the head, neck or chest joints, in `people.ts`, with its own fixed colours.
  - Like hair styles, a part is drawn only when the look wears that accessory.
  - Hats sit high enough to cover most hair. Eyewear sits at eye level in front of the face, and a painted face does not hide it.
  - Your own first-person head parts stay hidden, as they are now.
- **2D:** `Avatar.tsx` draws each accessory over the portrait: hats over the hair, eyewear at the eyes, and neck items at the collar.

## Tests

- **Catalog:** every slot's indices run 1…n with no gaps, and fit `LOOK_LIMITS`.
- **Bag:** buying an accessory costs its price, you can only buy each one once, and `cleanBag` drops unknown ids.
- **Protocol:** `cleanLook` keeps accessories, zeroes unknown indices, and fills in older looks.
- **Browser:** the wardrobe preview and a cabin full of accessorised bots.
