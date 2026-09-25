# Playtest: a first-timer on the live site (2026-09-25)

Run by the playtester agent (`.claude/agents/playtester.md`; this time a general agent with the same instructions).

**How far it got:**
- Finished the tutorial ("Flight School", about 5 min, ended on Day 1).
- Looked around Duty Free (Shop, Accessories, Your bag, Achievements) and the wardrobe. Bought Sleeping pills and a Party hat.
- Booked a real flight (London, 5 nights, 10 seats) and was adding bots when it was stopped.

**Not seen:** a real flight, deaths or blasts, other roles, the 2D screen, voice, the Captain menu. The 3D view drew fine with the pane hidden.

## Overall

Polished and charming. The 3D packing, the cinematic boarding, the morning report and the end-of-flight postcard are lovely, and the pitch lands in seconds. The tutorial let it down: its hint text overlapped the seatback screen and couldn't be read, and it was so on-rails that its vote didn't matter. It would play again.

## Findings (most serious first)

1. **Major:** The tutorial hint is drawn over the seatback screen's Action tab with no background, so both texts are unreadable.
   - This happens at the key moments ("choose to stay", "Shine your Pocket flashlight under 3C"). The hint stays pinned while the cards scroll under it.
   - On the Map tab it has a solid background and reads fine.
2. **Minor, leaning major:** The flashlight result isn't shown where you use it.
   - The Action tab only says "Used: Pocket flashlight". The result is a small bomb icon on the Map, and the words only come in the morning report.
3. **Minor:** In the tutorial, the player's choices don't matter.
   - The bots put Mia at 4 votes before the player opened the vote. The washroom was "Not now". Advertised as 3 nights, it ended after one day.
4. **Minor:** Timers are missing or contradict the rules.
   - The seatback header shows no countdown at night or during the discussion, and still says "NIGHT 1 OF 3" in the day.
   - The tutorial lobby rules say "nights 90s, discussion 150s", but the timers ran about 30 minutes.
5. **Minor:** "Press Ready to vote", but the button is only on the Chat tab. The Vote tab says "Nothing to vote on yet" with no button.
6. **Polish:** The tutorial hint card stretches to fill empty space on the Vote and Chat tabs, squeezing the chat log.
7. **Minor:** On the end screen, Leave says "If you leave, the flight pauses for everyone" and offers "End flight for everyone", even though the flight is over.
8. **Minor:** Jargon is never explained: "turns rogue 30% (never if the saboteurs would stop being outnumbered)", "seatbelt sign", "Mastermind", "No meal service".
   - The Passenger card says "No special ability" right above the "Look under your seat" ability.
9. **Minor:** The tutorial lobby shows full host controls (Remove bots, Edit rules, Add bot, invite link), so a newcomer could break the script.
   - It also says "up to 6 passengers" while booking says "4–16".
10. **Minor:** Filling a flight with bots takes one click per bot, each showing up after about a second. There's no "fill with bots".
11. **Minor:** Duty Free buys on one click with no confirm or undo, and the wardrobe charges for an accessory as soon as you pick it (you can't try it on first).
12. **Minor / polish:** The flight recorder says "Mia (bot) looked under 3C and found a bomb" (she was the Bomber), and the Black box tab is blank with no "nothing recorded" note.
13. **Polish:** The packing hint says "press Ready" but the button is "Done packing". "5/6 packed" next to three item slots reads like an item count.
14. **Polish:** The gesture bar covers the end of the takeoff announcement in 3D.
15. **Polish:** At 1024 px, "New here? Take the tutorial flight" overflows its button.
16. **Polish:** Actions pause with no feedback.
    - Chat sent with Enter stays in the box for about a second.
    - "Close doors", "Add bot" and "Flash it" have similar pauses, and "Flash it" gives no confirmation.
17. **Polish:** A small top-left status icon (a "zzz", later a waving hand) is never explained, and the vote cards read as blank buttons to a screen reader.

## What worked well

- The home page pitch and its five steps; clear messages when a name is missing.
- The boarding-pass role reveal.
- The 3D packing scene, with a hover tooltip on every item.
- The cinematic boarding, and the camera dipping under the seat.
- The morning report's "ONLY YOU" tags; the Map legend.
- Believable bot chat; Whisper listing nearby seats.
- Live vote tallies and a clear verdict card.
- The end screen: credits, achievements, roles, the flight recorder and the postcard.
- The wardrobe (face drawing, instant preview) and witty shop copy.
- The Book a flight screen's destinations, twists and pace presets.
