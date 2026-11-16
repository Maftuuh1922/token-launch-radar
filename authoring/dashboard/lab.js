function labMap(e) {
    const a = $("#lab-map");
    if (!a) return;
    const t = "candidate" === tab ? "implied_value_usd" : "mcap_usd", s = e.filter(e => e.tvl_usd > 0 && e[t] > 0), o = data.reference, n = e => e.length ? [ Math.floor(Math.log10(Math.min(...e))), Math.ceil(Math.log10(Math.max(...e))) ] : [ 0, 1 ], l = n([ ...s, ...o ].map(e => e.tvl_usd)), i = n([ ...s.map(e => e[t]), ...o.map(e => e.mcap_usd) ]), r = (e, a) => 5 + 90 * (Math.log10(e) - a[0]) / (a[1] - a[0] || 1);
    a.innerHTML = `<div class="lab-heading"><div><p class="eyebrow">01 / VALUATION ATLAS</p><h2>Find your signal<span>_</span></h2></div><button id="lab-validation">Model audit [↗]</button></div><div class="map-key">+ ${s.length} filtered ${"candidate" === tab ? "candidates / model value" : "records / market cap"} <span>· ${o.length} traded anchors</span></div><div class="map-plot" role="group" aria-label="Log TVL against value"><div class="map-grid" aria-hidden="true"></div>${o.map(e => `<span class="map-anchor" style="left:${r(e.tvl_usd, l)}%;bottom:${r(e.mcap_usd, i)}%" title="${esc(e.name)} / measured ${money(e.mcap_usd)}">·</span>`).join("")}${s.map(e => `<button class="map-dot" data-map-slug="${esc(e.slug)}" style="left:${r(e.tvl_usd, l)}%;bottom:${r(e[t], i)}%" aria-label="Inspect ${esc(e.name)}" title="${esc(e.name)} | TVL ${money(e.tvl_usd)} | ${money(e[t])}">+</button>`).join("")}<span class="map-y"><span>${money(10 ** i[1])}</span><span>VALUE</span><span>^</span><span>${money(10 ** i[0])}</span></span></div><div class="map-axis"><span>${money(10 ** l[0])}</span>TVL / USD / LOG SCALE<span>${money(10 ** l[1])}</span></div><p class="note">Click + to inspect. Search overlapping points below. Snapshot only.</p>`,
    a.querySelector("#lab-validation").onclick = labValidation, a.onclick = e => {
        const a = e.target.closest("[data-map-slug]");
        a && detail(a.dataset.mapSlug);
    };
}

function labValidation() {
    const e = data.advanced, a = data.validation, t = e?.models || a.models;
    openDialog(`<div class="detail audit-detail"><p class="eyebrow">02 / OUT-OF-SAMPLE AUDIT</p><h2 id="dialog-title">Evidence before conviction.</h2><p class="lead">${e?.training_n ?? a?.n ?? 0} unique traded tokens. ${e ? "Nested validation: outer targets never choose their own model." : "Fixed folds; test targets excluded."}</p><table class="validation-table"><thead><tr><th>Model</th><th>Median error factor</th><th>Mean log10 error</th><th>Within 3×</th></tr></thead><tbody>${Object.values(t).map(e => `<tr><td>${esc(e.name)}</td><td data-label="Median error">${e.medianMultiplicativeError?.toFixed(2) ?? "Unavailable"}×</td><td data-label="Log10 error">${e.meanAbsoluteLog10Error?.toFixed(3) ?? "Unavailable"}</td><td data-label="Within 3×">${e.within3x == null ? "Unavailable" : (100 * e.within3x).toFixed(1)}%</td></tr>`).join("")}</tbody></table>${e ? `<p class="note"><b>Production:</b> ${esc(e.selected)}. ${esc(e.selection_rule)}<br><b>Range:</b> ${esc(e.band_label)}. Rank ranges use ${e.bootstrap_runs} seeded refits, conditional on the selected model.</p>` : ""}<p class="note">Lower error is better. No temporal or payout forecast. ${esc(e?.limits || a.limits)}</p></div>`, "MODEL REALITY CHECK");
}

function modelProof(e) {
    const a = e.advanced;
    return a ? `<section class="panel" id="model-proof"><h3>Why this rank?</h3><div class="facts"><span>Production model<b>${esc(a.method)}</b></span><span>Old model value / rank<b>${money(a.legacy_value_usd)} / ${a.legacy_rank ?? "—"}</b></span><span>Rank P10–P90<b>${a.rank_low ?? "—"} – ${a.rank_high ?? "—"}</b></span><span>Top-20 in refits<b>${null == a.top20_share ? "—" : (100 * a.top20_share).toFixed(1) + "%"}</b></span></div><p class="note">Rank stability is not launch probability. ${a.extrapolated ? "TVL lies outside the training range; this is extrapolation." : "TVL lies within the reference range."}</p><h3>Nearest observed comparables</h3><div class="peer-list">${(a.peers || []).map(e => `<div><b>${esc(e.name)}</b><span>TVL ${money(e.tvl_usd)} / MCap ${money(e.mcap_usd)}</span></div>`).join("")}</div><p class="note">Measured comparables, not future price promises.</p></section>` : "";
}

function labPlan(e) {
    const a = (() => {
        try {
            return JSON.parse(localStorage.getItem("lantern-plan-" + e.slug)) || {};
        } catch {
            return {};
        }
    })(), t = [ [ "lab-fee", "Total fees ($)", e.plan.fees[1], 1e5 ], [ "lab-hours", "Time (hours)", 1, 1e4 ], [ "lab-rate", "Time value ($/h)", 0, 1e4 ], [ "lab-payout", "Hypothetical payout ($)", 0, 1e7 ], [ "lab-prob", "Probability (%)", 0, 100 ], [ "lab-loss", "Principal loss (%)", 0, 100 ], [ "lab-budget", "Cash budget ($)", Math.max(500, e.plan.capital[1] + e.plan.fees[1]), 1e7 ] ], s = document.createElement("section");
    s.className = "panel lab-plan", s.innerHTML = `<p class="eyebrow">03 / DECISION LAB</p><h3>Test the downside before committing.</h3><p class="note">Payout and probability default to zero; TVL implies no allocation.</p><div class="lab-inputs">${t.map(([e, t, s, o]) => `<label>${t}<input id="${e}" type="number" min="0" max="${o}" value="${Number.isFinite(a[e]) ? Math.min(o, Math.max(0, a[e])) : s}"></label>`).join("")}</div><div class="lab-results"><div>ALL-IN COST<strong id="lab-cost"></strong></div><div>EXPECTED NET<strong id="lab-net"></strong></div><div>BREAK-EVEN PROBABILITY<strong id="lab-breakeven"></strong></div></div><p id="lab-budget-result" role="status"></p><div class="table-scroll"><table class="stress-table"><thead><tr><th>Stress case</th><th>Cost</th><th>Expected net</th></tr></thead><tbody></tbody></table></div><p class="note">Stress: fees ×2, payout ×0.5, probability ×0.5. No reward: payout 0. Loss applies throughout. Assumptions only.</p><button id="lab-save">Save scenario</button> <button id="lab-export">Export evidence + scenario</button><p id="lab-save-status" class="note" role="status"></p><div id="provenance-facts"><p data-kind="observed"><b>OBSERVED</b> ${esc(data.as_of)} / ${esc(e.category)} / TVL ${exact(e.tvl_usd)} / token status from sealed records.</p><p data-kind="model"><b>MODEL</b> ${money(e.implied_value_usd)} proxy; range ${money(e.bear_usd)}–${money(e.bull_usd)}. Not a payout.</p><p data-kind="assumption"><b>ASSUMPTION</b> Fees, time, opportunity cost, probability, payout and loss inputs above. Product access still requires verification.</p></div>`,
    $(".detail-grid").append(s);
    for (const e of [ "capital", "horizon", "apy" ]) Number.isFinite(a[e]) && ($("#" + e).value = a[e]);
    let o = null;
    const n = (e, a) => Math.min(a, Math.max(0, Number($("#" + e).value) || 0)), l = () => {
        const e = {
            capital: n("capital", 1e6),
            fees: n("lab-fee", 1e5),
            days: Math.max(7, n("horizon", 365)),
            apy: n("apy", 100),
            hours: n("lab-hours", 1e4),
            hourlyRate: n("lab-rate", 1e4),
            payout: n("lab-payout", 1e7),
            probability: n("lab-prob", 100) / 100,
            lossPct: n("lab-loss", 100),
            feeMultiplier: 1
        };
        o = evaluatePlan(e);
        const a = e.capital + e.fees, t = o.expectedNet;
        $("#lab-cost").textContent = "$" + o.cost.toFixed(2), $("#lab-net").textContent = (t < 0 ? "-$" : "$") + Math.abs(t).toFixed(2),
        $("#lab-net").dataset.net = t, $("#lab-breakeven").textContent = null == o.breakEvenProbability ? "No positive payout" : (100 * o.breakEvenProbability).toFixed(1) + "%" + (o.breakEvenProbability > 1 ? " / not attainable" : ""),
        $("#lab-budget-result").textContent = `Cash $${a.toFixed(2)} / budget $${n("lab-budget", 1e7).toFixed(2)} — ${a > n("lab-budget", 1e7) ? "OVER BUDGET" : "WITHIN BUDGET"}. Principal is not a fee.`,
        $(".stress-table tbody").innerHTML = o.stress.map(e => `<tr><td>${esc(e.label)}</td><td>$${e.cost.toFixed(2)}</td><td>${e.net < 0 ? "-$" : "$"}${Math.abs(e.net).toFixed(2)}</td></tr>`).join("");
    }, i = [ ...t.map(e => e[0]), "capital", "horizon", "apy" ];
    for (const e of i) $("#" + e).addEventListener("input", l);
    l(), $("#lab-save").onclick = () => {
        try {
            localStorage.setItem("lantern-plan-" + e.slug, JSON.stringify(Object.fromEntries(i.map(e => [ e, Number($("#" + e).value) || 0 ])))),
            $("#lab-save-status").textContent = "Saved in this browser.";
        } catch {
            $("#lab-save-status").textContent = "Browser storage unavailable.";
        }
    }, $("#lab-export").onclick = () => {
        const a = new Blob([ JSON.stringify({
            snapshot: data.as_of,
            source: data.source,
            protocol: e,
            scenario: o,
            inputs: Object.fromEntries(i.map(e => [ e, Number($("#" + e).value) || 0 ]))
        }, null, 2) ], {
            type: "application/json"
        }), t = URL.createObjectURL(a), s = document.createElement("a");
        s.href = t, s.download = "lantern-" + e.slug + ".json", s.click(), setTimeout(() => URL.revokeObjectURL(t), 1e3);
    };
}
