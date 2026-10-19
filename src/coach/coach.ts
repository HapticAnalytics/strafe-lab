// Optional AI coach (Claude artifact runtime). The app works fully without it. Never put an API key here.
// Coach only interprets numbers computed by analysis/; the prompt tells it to cite only values present in the data.
import type { SessionLog } from "../telemetry/schema";
import type { SessionResult } from "../analysis/result";
import { coachReport } from "../ui/results";

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;

export const COACH_FACTS = `HOW THE TEST WORKS
- Blind test: the player did not know which sensitivity each block used. Round 1 = 6 blocks log-spaced from fast to slow (wide sweep). Round 2 = 4 blocks at 0.86/0.95/1.05/1.16x of the round-1 peak. Order shuffled.
- Each block starts with 4 s of unscored adjustment, then four drills. Enemy movement is identical in every block (fixed random seed), so sensitivity is the only variable.
- Point-blank: enemy at 4 m, 10 s. Close SMG duel: 8 m, 12 s. Mid-range: 18 m, 12 s. 2v1: enemies at 7 m and 10 m, 200 HP each, 10 s limit, player deals R-99 damage while the crosshair is on them (198 DPS body, 306 DPS head).
- Score per block = 25% point-blank time-on-target + 30% close + 20% mid + 25% 2v1 damage rate (100 = never off target, body only).
- Recommended sens = peak of a quadratic fit of score vs ln(cm/360). bestCm360ByRange = the same fit per drill.
- peakStabilityPlusMinusPct = how far the peak moves when any one block is left out (smaller = more dialed in). fitRmsePoints = block-to-block noise around the curve.

APEX FACTS (verified)
- Sens: cm/360 = 360 / (0.022 x sens x DPI) x 2.54. Higher cm/360 = slower sens = more arm movement.
- Enemy speeds used: strafing with a weapon ~4.4 m/s (walk 5.07 m/s minus 13% for holding a gun), crouch-walking ~2.0 m/s, sprint 7.59 m/s. Crouch spam lowers the hitbox; jumps and slides change height. Hitbox approx 0.6 m wide, 1.8 m tall standing.
- R-99: 11 body / 17 head damage, 1080 RPM. A purple-shielded enemy has 200 effective HP, so a perfect body-only R-99 kill takes about 1.0 s.
- Typical enemy angular speeds: at 4 m a 4.4 m/s strafe is ~60 deg/s, at 8 m ~30 deg/s, at 18 m ~14 deg/s. targetSpeed in the data is the measured average.

METRICS (per drill)
- on: % of time crosshair on the enemy. head: % on the head.
- behind: of off-target time while the enemy moved, % trailing behind them (100 - behind = ahead, over-leading).
- vertMiss: % of off-target time where horizontal aim was right but height was wrong (crouch spam, jumps, slides).
- left / right: on-target % while the enemy moved left / right on screen.
- recover: ms to get back on the enemy after they reverse direction (0 = never lost them).
- jitter: degrees of high-frequency wobble near the enemy. oscPerSec: times per second the crosshair crossed back and forth over the enemy (over-correcting).
- pitchErr: mean degrees the crosshair sat below (+) or above (-) the chest.
- handTravel: cm the hand moved. handPeak: fastest hand speed in cm/s. Low handPeak at slow sens with low on% means the arm couldn't keep up; high jitter at fast sens means wrist instability.
- twoVsOne: killTime (s to kill both, null if not finished), firstKill, switchMs (from first kill until back on the second enemy), dealt (damage), headDmgPct.

CAUTIONS
- One session is noisy. Players also score slightly better near their current sens because of muscle memory, so a peak close to the current sens partly reflects habit. Say so if relevant.
- Only use numbers present in the data. Do not invent metrics, pro settings or claims about specific players.`;

interface Sampler { json(prompt: string, o: { signal: AbortSignal; modelTier: string }): Promise<Record<string, any>> }
const esc = (t: unknown) => String(t ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export async function setupCoach(s: SessionLog, r: SessionResult): Promise<void> {
  const report = coachReport(s, r);
  const btn = $<HTMLButtonElement>("#coachBtn"), stop = $<HTMLButtonElement>("#coachStop"), out = $("#coachOut"), note = $("#coachNote");
  let sample: Sampler | null = null;
  try { const w = window as any; sample = await (w.claude?.use ? w.claude.use("sample") : null); } catch { sample = null; }
  if (!sample) { note.textContent = "The AI coach runs when this page is opened in Claude. Your sens result and mouse-data findings above work everywhere."; return; }
  btn.hidden = false;
  let ctl: AbortController | undefined;
  stop.onclick = () => ctl?.abort();
  btn.onclick = async () => {
    btn.disabled = true; stop.hidden = false; ctl = new AbortController();
    out.innerHTML = `<p class="thinking">Reading your tracking data… this takes up to a minute.</p>`;
    const prompt = `You are an expert Apex Legends tracking coach for mouse and keyboard players, focused on SMG fights at close and mid range. The player says they are weakest at close and mid-range SMG tracking and currently wrist-aims. Using ONLY the data below, (1) confirm or question the recommended sensitivity by explaining how their tracking changed from fast to slow sens, range by range, and whether arm or wrist aim looks better for them; (2) diagnose their tracking weaknesses; (3) give specific practice. Cite numbers for every claim. Plain, direct language. No hype.

${COACH_FACTS}

Reply with only JSON in exactly this shape:
{"headline": "one sentence: the core diagnosis",
 "sensVerdict": "3-4 sentences: which sens to use, why, how confident, and what changed between fast and slow blocks",
 "armOrWrist": "2 sentences on whether the data supports moving toward arm aim, citing hand speed, jitter and on-target trends",
 "ranges": [{"range": "Point-blank | Close duel | Mid-range | 2v1 fight", "verdict": "one sentence", "evidence": "numbers"}],
 "findings": [{"title": "short", "evidence": "numbers", "meaning": "what it costs them in a real Apex fight"}],
 "drills": [{"name": "short", "how": "exactly what to do in R5 Reloaded 1v1s, the Firing Range dummies on strafe settings, or a tracking scenario in an aim trainer", "goal": "a measurable target, using the same metrics"}],
 "focus": "the single thing to fix first, one sentence"}
Give all 4 ranges, 3-4 findings (most impactful first) and 3 drills.

DATA:
${JSON.stringify(report)}`;

    try {
      const res = await sample!.json(prompt, { signal: ctl.signal, modelTier: "complex" });
      out.innerHTML = `
        <p style="font-size:19px;font-family:var(--f-display)">${esc(res.headline)}</p>
        <p>${esc(res.sensVerdict)}</p>
        ${res.armOrWrist ? `<div class="focus"><span class="eyebrow">Arm or wrist</span>${esc(res.armOrWrist)}</div>` : ""}
        <h3>By range</h3>${(res.ranges || []).map((x: any) => `<div class="item"><b>${esc(x.range)}: ${esc(x.verdict)}</b><span>${esc(x.evidence)}</span></div>`).join("")}
        <h3>Findings</h3>${(res.findings || []).map((f: any) => `<div class="item"><b>${esc(f.title)}</b><span>${esc(f.evidence)}</span><span>${esc(f.meaning)}</span></div>`).join("")}
        <h3>Drills</h3>${(res.drills || []).map((d: any) => `<div class="item"><b>${esc(d.name)}</b><span>${esc(d.how)}</span><span>Goal: ${esc(d.goal)}</span></div>`).join("")}
        <div class="focus"><span class="eyebrow">Fix this first</span>${esc(res.focus)}</div>`;
    } catch (e: any) {
      const msg = ({ not_granted: "The coach needs your OK to use Claude. Reload the page to be asked again.", rate_limited: "You've hit a usage limit. Try again in a bit.", session_expired: "Sign in to Claude again, then retry.", invalid_json: "The coach's answer came back garbled. Try again.", cancelled: "" } as Record<string, string>)[e?.code] ?? "Coaching couldn't load this time. Try again.";
      out.innerHTML = msg ? `<p class="note">${msg}</p>` : "";
      if (["not_granted", "sampling_disabled", "not_declared", "capability_disabled"].includes(e?.code)) btn.hidden = true;
    } finally { btn.disabled = false; stop.hidden = true; }
  };
}
