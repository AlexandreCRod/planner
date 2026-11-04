// Settings → Looks → "Display check" (364): a page for judging the phone's screen and its colour modes on the
// app's own colours, before the colour work of 2.10.3 (332b, 363). Full-strength swatches (the categories, the
// flags, the training colours, the highlight), a smooth colour fade and a grey ramp (banding shows as steps),
// true black beside the near-blacks (OLED black), and a photo-like strip (skin tones, greens, reds). Dark only:
// the page draws on black whatever the theme, as the user always uses it. Nothing here changes a setting.
import { cssColor } from "../../domain/types.ts";
import { useSnapshot } from "../../store/store.ts";
import { Scaffold, SectionHeader } from "./chrome.tsx";
import { BLACKS, displaySwatches } from "./displayColours.ts";
import { GYM, PAIN, RUN, WEIGHT } from "./ProgressChart.tsx";

/** Photo-like tones: skin from light to deep, leaves, and reds (each a soft fade, as in a photo). */
const PHOTO: [string, string][] = [
  ["#f6d7c3", "#e8b896"], ["#e0ac69", "#c68642"], ["#a86b3c", "#6b3f20"], ["#4a2a17", "#2b1709"],
  ["#1b5e20", "#7cb342"], ["#2e7d32", "#c5e1a5"], ["#7f0000", "#e53935"], ["#c62828", "#ff8a80"],
];

export function PhoneDisplayCheck() {
  const s = useSnapshot();
  const groups = displaySwatches(s.categories.map((c) => ({ name: c.name, color: cssColor(c.color) })),
    [{ name: "Run chart", color: RUN }, { name: "Gym chart", color: GYM }, { name: "Weight", color: WEIGHT }, { name: "Pain", color: PAIN }]);
  return (
    <Scaffold title="Display check" back flush>
      <div className="p-content dc">
        <div className="dc-line">Flip your phone's colour mode while this is open.</div>
        {groups.map((g) => g.list.length > 0 && <div key={g.title}>
          <SectionHeader>{g.title}</SectionHeader>
          <div className="dc-swatches">
            {g.list.map((w) => <div key={w.name} className="dc-sw"><span style={{ background: w.color }} /><small>{w.name}</small></div>)}
          </div>
        </div>)}
        <SectionHeader>Colour fade</SectionHeader>
        <div className="dc-bar dc-hue" />
        <div className="dc-bar dc-acc" />
        <SectionHeader>Grey ramp</SectionHeader>
        <div className="dc-bar dc-grey" />
        <div className="dc-steps">{Array.from({ length: 16 }, (_, i) => <span key={i} style={{ background: `rgb(${i * 17} ${i * 17} ${i * 17})` }} />)}</div>
        <SectionHeader>Black</SectionHeader>
        <div className="dc-blacks">{BLACKS.map((b) => <div key={b.color} style={{ background: b.color }}><small>{b.name}<br />{b.color}</small></div>)}</div>
        <SectionHeader>Skin, leaves and reds</SectionHeader>
        <div className="dc-photo">{PHOTO.map(([a, b]) => <span key={a} style={{ background: `linear-gradient(135deg, ${a}, ${b})` }} />)}</div>
        <div className="p-endspace" />
      </div>
    </Scaffold>
  );
}
