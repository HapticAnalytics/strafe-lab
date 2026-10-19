import { combatReport } from "../analysis/combatReport";
import { fmt } from "../core/math";
import { COMBAT_SCENARIOS } from "../sim/combat";
import { WEAPONS } from "../sim/weapons";
import { isEventLog, type SessionLog } from "../telemetry/schema";

export function combatResultsHTML(s: SessionLog): string {
  const d = Object.values(s.blocks[0]?.drills ?? {}).find(x => x && isEventLog(x) && x.combat);
  const header = `<header class="brand"><h1>Strafe<span>/</span>Lab</h1><span class="eyebrow">Combat lab · ${new Date(s.startedAt).toLocaleString()}</span></header>`;
  const back = `<div class="row"><button class="btn" id="againBtn" type="button">Run again</button><button class="btn ghost" id="setupBtn" type="button">Back to setup</button></div>`;
  if (!d || !isEventLog(d) || !d.combat) return `${header}<p class="warnbox">No combat drill was completed.</p>${back}`;
  const r = combatReport(d, s.settings.dpi)!, c = r.combat, m = r.mechanics, w = WEAPONS[c.weapon];
  return `${header}
    <section class="hero"><div><span class="eyebrow">${COMBAT_SCENARIOS[d.combat.scenario].name} · ${w.name} · ${c.mode === "ads" ? "ADS" : "hipfire"}</span><div class="bignum">${fmt(c.damage, 0)}<small>damage</small></div></div>
      <div class="facts">
        <div class="fact"><span class="v">${fmt(c.accuracyPct, 0)}%</span><span class="k">Accuracy</span></div>
        <div class="fact"><span class="v">${fmt(c.headshotPct, 0)}%</span><span class="k">Headshots</span></div>
        <div class="fact"><span class="v">${c.kills}</span><span class="k">Kills (200 HP)</span></div>
        <div class="fact"><span class="v">${c.meanTtkS != null ? fmt(c.meanTtkS, 2) + " s" : "—"}</span><span class="k">Mean time to kill</span></div>
      </div></section>
    <section class="panel"><h2 style="font-size:18px">Weapon result</h2>
      <p class="note">${c.shots} shots${w.pellets > 1 ? ` (${c.pellets} pellets)` : ""}, ${c.hits} hits (${c.headHits} head, ${c.legHits} legs), ${c.reloads} reloads. Damage efficiency ${fmt(c.efficiencyPct, 0)}% of all-body hits.</p>
      <p class="note">Weapon data: ${w.source} Recoil and spread are approximations, not Apex's real patterns. Recoil moves the bullets, not your view, so the mouse-control numbers below stay pure.</p></section>
    <section class="panel"><h2 style="font-size:18px">Mouse control (independent of the weapon)</h2>
      <div class="facts">
        <div class="fact"><span class="v">${fmt(m.onPct, 0)}%</span><span class="k">Time on target</span></div>
        <div class="fact"><span class="v">${fmt(m.errHNorm, 2)}</span><span class="k">H error × width</span></div>
        <div class="fact"><span class="v">${fmt(m.reversalLatencyMs, 0)} ms</span><span class="k">Reversal response</span></div>
        <div class="fact"><span class="v">${fmt(m.jitterHDeg, 3)}°</span><span class="k">Jitter</span></div>
      </div>
      <p class="note">These come from the same mouse events with no weapon involved; the same movement scores the same whichever weapon or mode you pick.</p></section>
    ${back}`;
}
