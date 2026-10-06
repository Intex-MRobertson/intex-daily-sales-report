#!/usr/bin/env node
/**
 * Intex Daily Sales Report - formatter.
 *
 * Reads the JSON data file NetSuite attaches to its daily email (schema intex-daily-sales/1)
 * and writes, into the output folder:
 *   Daily_Sales_Report_YYYY-MM-DD.html   email body: the familiar report layout, cleaned up (table-based, Outlook-safe)
 *   Daily_Sales_Report_YYYY-MM-DD.pdf    page 1 charts, then the tables (A4 landscape)
 *   Daily_Sales_Report_YYYY-MM-DD.manifest.json   what was produced; written LAST
 *
 * Usage:  node render_report.js <data.json> <outDir>
 * Needs:  Node 18+, and the "playwright" package with Chromium for the PDF
 *         (npm install playwright && npx playwright install chromium).
 * Exit codes: 0 ok; 1 bad input; 2 PDF step failed (HTML is still written, manifest says status "no_pdf").
 *
 * The numbers are taken from the JSON as-is; this script only formats them.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SUM_KEYS = ['salesToday', 'sales', 'salesBudgetMtd', 'salesTarget', 'gpToday', 'gp', 'gpBudgetMtd', 'gpTarget'];
const total = (rows, name) => {
    const t = { name };
    SUM_KEYS.forEach((k) => { t[k] = rows.reduce((s, r) => s + (Number(r[k]) || 0), 0); });
    return t;
};

    // Colours: blue/orange tiers (colour-blind safe, differ in lightness too).
    const C = {
        ink: '#1B1B19', muted: '#5A5954', rule: '#DAD7CF', faint: '#ECEAE4', ground: '#F4F2EC',
        navy: '#1F3A5F', band: '#E6E2D8', track: '#F1EFE9', shade: '#FAF9F6'
    };
    const TIERS = {
        good: { fg: '#1D5F8C', bg: '#E1EDF6', sym: '\u25B2' },
        watch: { fg: '#7A5000', bg: '#FAEDD2', sym: '\u25CF' },
        bad: { fg: '#A63A0C', bg: '#FBE2D5', sym: '\u25BC' }
    };
    const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";

    // ---------- Formatting helpers ----------

    const tierOf = (a, b) => {
        const pctv = b ? a / b : 0;
        return { pct: pctv, t: pctv >= 1 ? TIERS.good : pctv >= 0.95 ? TIERS.watch : TIERS.bad };
    };
    const fmt = (n) => {
        const v = Math.round(Number(n) || 0);
        if (v === 0) return '\u2013';
        const s = Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return v < 0 ? `-${s}` : s;
    };
    const fmtVar = (n, minus) => {
        const v = Math.round(Number(n) || 0);
        const s = Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return (v > 0 ? '+' : v < 0 ? (minus || '\u2212') : '') + s;
    };
    const pctText = (a, b) => (b ? `${Math.round(a / b * 100)}%` : '');
    const margin = (gp, sales) => (sales ? `${(gp / sales * 100).toFixed(1)}%` : '');
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // ---------- Email (table-based, inline styles) ----------

    const renderEmail = (m) => {
        const td = `padding:6px 9px;text-align:right;border-bottom:1px solid ${C.faint};white-space:nowrap;font-size:13px`;
        const th = `padding:7px 9px;text-align:right;font-size:11px;font-weight:bold;letter-spacing:0.04em;text-transform:uppercase;color:${C.muted};border-bottom:1px solid ${C.ink};vertical-align:bottom`;
        const pill = (a, b) => {
            if (!b) return '';
            const { pct, t } = tierOf(a, b);
            return `<span style="display:inline-block;min-width:52px;padding:2px 8px;border-radius:10px;background:${t.bg};color:${t.fg};font-weight:bold;text-align:center">${t.sym}&nbsp;${Math.round(pct * 100)}%</span>`;
        };
        const varCell = (a, b) => `color:${tierOf(a, b).t.fg}`;

        const row = (r, opts) => {
            const o = opts || {};
            const base = td + (o.shade ? `;background:${C.shade}` : '') + (o.bold ? `;font-weight:bold;border-top:1px solid ${C.ink};border-bottom:2px solid ${C.ink}` : '');
            return `<tr>
<td style="${base};text-align:left;color:${C.ink};font-weight:${o.bold ? 'bold' : '500'}">${esc(r.name)}</td>
<td style="${base};color:${C.muted}">${fmt(r.salesToday)}</td>
<td style="${base};color:${C.ink}">${fmt(r.sales)}</td>
<td style="${base};color:${C.muted}">${fmt(r.salesBudgetMtd)}</td>
<td style="${base};${varCell(r.sales, r.salesBudgetMtd)}">${fmtVar(r.sales - r.salesBudgetMtd)}</td>
<td style="${base}">${pill(r.sales, r.salesBudgetMtd)}</td>
<td style="padding:0;width:12px"></td>
<td style="${base};color:${C.muted}">${fmt(r.gpToday)}</td>
<td style="${base};color:${C.ink}">${fmt(r.gp)}</td>
<td style="${base};color:${C.muted}">${fmt(r.gpBudgetMtd)}</td>
<td style="${base};${varCell(r.gp, r.gpBudgetMtd)}">${fmtVar(r.gp - r.gpBudgetMtd)}</td>
<td style="${base}">${pill(r.gp, r.gpBudgetMtd)}</td>
<td style="${base};color:${C.ink}">${margin(r.gp, r.sales)}</td>
</tr>`;
        };

        const table = (title, sub, label, rows, tot, extra) => `
<tr><td style="padding:26px 0 8px;font-family:${FONT}">
<span style="font-family:Georgia,serif;font-size:19px;font-weight:bold;color:${C.ink}">${esc(title)}</span>
<span style="font-size:13px;color:${C.muted}">&nbsp;&nbsp;${esc(sub)}</span></td></tr>
<tr><td>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#FFFFFF;font-family:${FONT}">
<tr><th style="${th};text-align:left"></th><th colspan="5" style="${th};text-align:left;color:${C.ink};border-bottom:1px solid ${C.rule}">Sales</th><th style="padding:0"></th><th colspan="6" style="${th};text-align:left;color:${C.ink};border-bottom:1px solid ${C.rule}">Gross profit</th></tr>
<tr><th style="${th};text-align:left">${esc(label)}</th><th style="${th}">Today</th><th style="${th}">MTD</th><th style="${th}">Budget MTD</th><th style="${th}">Variance</th><th style="${th}">vs budget</th><th style="padding:0"></th><th style="${th}">Today</th><th style="${th}">MTD</th><th style="${th}">Budget MTD</th><th style="${th}">Variance</th><th style="${th}">vs budget</th><th style="${th}">Margin</th></tr>
${rows.map((r, i) => row(r, { shade: i % 2 === 1 })).join('')}
${row(tot, { bold: true })}
${extra ? `<tr><td colspan="13" style="padding:14px 9px 6px;font-size:11px;font-weight:bold;letter-spacing:0.04em;text-transform:uppercase;color:${C.muted}">New Zealand &middot; NZD, shown separately</td></tr>${row(extra, { bold: true })}` : ''}
</table></td></tr>`;

        const tile = (label, cur, a, b, target, foot) => {
            const { pct, t } = tierOf(a, b);
            const w = Math.max(0, Math.min(100, Math.round(pct * 100)));
            return `<td width="25%" valign="top" style="padding:0 6px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border:1px solid ${C.rule};font-family:${FONT}">
<tr><td style="padding:14px 16px 4px;font-size:11px;font-weight:bold;letter-spacing:0.04em;text-transform:uppercase;color:${C.muted}">${esc(label)} &middot; ${cur}</td></tr>
<tr><td style="padding:2px 16px;white-space:nowrap"><span style="font-family:Georgia,serif;font-size:26px;font-weight:bold;color:${C.ink}">${fmt(a)}</span>&nbsp;
<span style="padding:2px 8px;border-radius:10px;background:${t.bg};color:${t.fg};font-weight:bold;font-size:13px">${t.sym}&nbsp;${Math.round(pct * 100)}%</span></td></tr>
<tr><td style="padding:8px 16px 6px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
${w > 0 ? `<td width="${w}%" height="6" style="background:${t.fg};font-size:0;line-height:0">&nbsp;</td>` : ''}${w < 100 ? `<td height="6" style="background:${C.band};font-size:0;line-height:0">&nbsp;</td>` : ''}
</tr></table></td></tr>
<tr><td style="padding:0 16px 14px;font-size:12px;color:${C.muted}">Budget MTD ${fmt(b)} &middot; ${fmtVar(a - b)}<br>Month target ${fmt(target)} &middot; ${foot}</td></tr>
</table></td>`;
        };

        const au = m.AU.tot, nz = m.NZ.tot;
        const monthEnd = m.cal.AU.elapsed === m.cal.AU.total;
        const legend = (t, txt) => `<span style="padding:2px 8px;border-radius:10px;background:${t.bg};color:${t.fg};font-weight:bold">${t.sym}</span>&nbsp;${txt}&nbsp;&nbsp;&nbsp;`;

        return `<div style="background:${m.noTiles ? '#FFFFFF' : C.ground};padding:${m.noTiles ? '0' : '24px 0'}">
<table role="presentation" width="1040" cellpadding="0" cellspacing="0" align="center" style="font-family:${FONT};color:${C.ink}">
<tr><td style="border-bottom:2px solid ${C.ink};padding-bottom:12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="font-family:${FONT}"><div style="font-size:12px;font-weight:bold;letter-spacing:0.08em;text-transform:uppercase;color:${C.navy}">Intex &middot; Daily Sales Report</div>
<div style="font-family:Georgia,serif;font-size:28px;font-weight:bold;color:${C.ink}">${longDate(m.asOf)}</div></td>
<td align="right" valign="bottom" style="font-family:${FONT};font-size:13px;color:${C.muted}">Working days: AU ${m.cal.AU.elapsed} of ${m.cal.AU.total} &middot; NZ ${m.cal.NZ.elapsed} of ${m.cal.NZ.total}${monthEnd ? '<br>Month-end: budget MTD equals the monthly target' : ''}</td>
</tr></table></td></tr>
${m.noTiles ? '' : `<tr><td style="padding-top:20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 -6px"><tr>
${tile('AU Sales', 'AUD', au.sales, au.salesBudgetMtd, au.salesTarget, `today ${fmt(au.salesToday)}`)}
${tile('AU Gross profit', 'AUD', au.gp, au.gpBudgetMtd, au.gpTarget, `margin ${margin(au.gp, au.sales)}`)}
${tile('NZ Sales', 'NZD', nz.sales, nz.salesBudgetMtd, nz.salesTarget, `today ${fmt(nz.salesToday)}`)}
${tile('NZ Gross profit', 'NZD', nz.gp, nz.gpBudgetMtd, nz.gpTarget, `margin ${margin(nz.gp, nz.sales)}`)}
</tr></table></td></tr>`}
${!m.only || m.only.includes('AU') ? table(m.AU.title, 'AUD', 'Territory', m.AU.rows, m.AU.tot) : ''}
${!m.only || m.only.includes('NZ') ? table(m.NZ.title, 'NZD', 'Territory', m.NZ.rows, m.NZ.tot) : ''}
${!m.only || m.only.includes('BR') ? table(m.BR.title, 'AU branches in AUD \u00B7 AU OTHER not in a branch', 'Branch', m.BR.rows, m.BR.tot, Object.assign({}, m.NZ.tot, { name: 'NZ' })) : ''}
<tr><td style="padding-top:18px;border-bottom:1px solid ${C.rule}"></td></tr>
<tr><td style="padding-top:12px;font-size:12px;color:${C.muted};font-family:${FONT}">
${legend(TIERS.good, 'on or above budget')}${legend(TIERS.watch, 'within 5%')}${legend(TIERS.bad, 'more than 5% under')}<br><br>
Source: NetSuite invoices and credit memos to ${displayDate(m.asOf)}, product lines only, ex GST. ${m.noTiles ? '' : 'Charts are in the attached PDF.'}
${m.warnings.length ? `<br><br><span style="color:${TIERS.bad.fg}"><b>Check:</b><br>${m.warnings.map(esc).join('<br>')}</span>` : ''}
</td></tr>
</table></div>`;
    };

    const PF = 'Helvetica';
    // WinAnsi-safe text for the PDF's built-in fonts: plain hyphen for minus, no symbol glyphs.
    const pdfVar = (n) => fmtVar(n, '-');

    const marker = (t, size) => {
        const s = size || 7;
        const shape = t === TIERS.good ? `<polygon points="0,${s} ${s / 2},0 ${s},${s}" fill="${t.fg}"/>`
            : t === TIERS.bad ? `<polygon points="0,0 ${s},0 ${s / 2},${s}" fill="${t.fg}"/>`
                : `<circle cx="${s / 2}" cy="${s / 2}" r="${s / 2}" fill="${t.fg}"/>`;
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">${shape}</svg>`;
    };

    const pdfHeader = (m, pageNo, heading) => `
<table width="100%" style="border-bottom:1.5px solid ${C.ink};margin-bottom:10px"><tr>
<td style="padding-bottom:6px"><p style="font-size:8pt;font-weight:bold;color:${C.navy};margin:0">INTEX &#183; DAILY SALES REPORT &#183; PAGE ${pageNo} OF 3</p>
<p style="font-family:Times;font-size:17pt;font-weight:bold;margin:2px 0 0 0">${esc(heading)}</p></td>
<td align="right" valign="bottom" style="padding-bottom:6px;font-size:8pt;color:${C.muted}">${esc(longDate(m.asOf))}<br/>Working days AU ${m.cal.AU.elapsed}/${m.cal.AU.total} &#183; NZ ${m.cal.NZ.elapsed}/${m.cal.NZ.total}</td>
</tr></table>`;

    const pdfTable = (title, sub, label, rows, tot, extra) => {
        const td = `padding:3.5px 5px;border-bottom:0.75px solid ${C.faint};font-size:8pt`;
        const th = `padding:4px 5px;font-size:6.5pt;font-weight:bold;color:${C.muted};border-bottom:1px solid ${C.ink}`;
        const cell = (a, b) => {
            if (!b) return `<td align="right" style="${td}"></td>`;
            const { pct, t } = tierOf(a, b);
            return `<td align="right" style="${td}"><table align="right" style="background-color:${t.bg}"><tr><td style="padding:1px 2px 1px 5px" valign="middle">${marker(t, 6)}</td><td style="padding:1px 5px 1px 2px;color:${t.fg};font-weight:bold;font-size:8pt">${Math.round(pct * 100)}%</td></tr></table></td>`;
        };
        const row = (r, bold, shade) => {
            const b = bold ? `;font-weight:bold;border-top:1px solid ${C.ink};border-bottom:1.5px solid ${C.ink}` : '';
            const bg = shade ? `;background-color:${C.shade}` : '';
            const s = td + b + bg;
            return `<tr>
<td style="${s};font-weight:bold">${esc(r.name)}</td>
<td align="right" style="${s};color:${C.muted}">${fmt(r.salesToday)}</td><td align="right" style="${s}">${fmt(r.sales)}</td>
<td align="right" style="${s};color:${C.muted}">${fmt(r.salesBudgetMtd)}</td>
<td align="right" style="${s};color:${tierOf(r.sales, r.salesBudgetMtd).t.fg}">${pdfVar(r.sales - r.salesBudgetMtd)}</td>
${cell(r.sales, r.salesBudgetMtd)}
<td style="width:8px"></td>
<td align="right" style="${s};color:${C.muted}">${fmt(r.gpToday)}</td><td align="right" style="${s}">${fmt(r.gp)}</td>
<td align="right" style="${s};color:${C.muted}">${fmt(r.gpBudgetMtd)}</td>
<td align="right" style="${s};color:${tierOf(r.gp, r.gpBudgetMtd).t.fg}">${pdfVar(r.gp - r.gpBudgetMtd)}</td>
${cell(r.gp, r.gpBudgetMtd)}
<td align="right" style="${s}">${margin(r.gp, r.sales)}</td></tr>`;
        };
        return `
<p style="font-family:Times;font-size:12pt;font-weight:bold;margin:8px 0 4px 0">${esc(title)} <span style="font-family:${PF};font-size:8pt;font-weight:normal;color:${C.muted}">${esc(sub)}</span></p>
<table width="100%" style="background-color:#FFFFFF">
<tr><td style="${th}"></td><td colspan="5" style="${th};color:${C.ink};border-bottom:0.75px solid ${C.rule}">SALES</td><td></td><td colspan="6" style="${th};color:${C.ink};border-bottom:0.75px solid ${C.rule}">GROSS PROFIT</td></tr>
<tr><td style="${th}">${esc(label.toUpperCase())}</td><td align="right" style="${th}">TODAY</td><td align="right" style="${th}">MTD</td><td align="right" style="${th}">BUDGET MTD</td><td align="right" style="${th}">VARIANCE</td><td align="right" style="${th}">VS BUDGET</td><td></td>
<td align="right" style="${th}">TODAY</td><td align="right" style="${th}">MTD</td><td align="right" style="${th}">BUDGET MTD</td><td align="right" style="${th}">VARIANCE</td><td align="right" style="${th}">VS BUDGET</td><td align="right" style="${th}">MARGIN</td></tr>
${rows.map((r, i) => row(r, false, i % 2 === 1)).join('')}
${row(tot, true, false)}
${extra ? `<tr><td colspan="13" style="padding:8px 5px 3px 5px;font-size:6.5pt;font-weight:bold;color:${C.muted}">NEW ZEALAND &#183; NZD, SHOWN SEPARATELY</td></tr>${row(extra, true, false)}` : ''}
</table>`;
    };

    // --- charts (SVG, 360 x 190 units) ---
    const CW = 360, CH = 190;
    const svgOpen = (h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="${h || CH}" viewBox="0 0 ${CW} ${h || CH}" font-family="${PF}">`;
    const tx = (x, y, s, opts) => {
        const o = opts || {};
        return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${o.size || 8}" fill="${o.fill || C.ink}"${o.anchor ? ` text-anchor="${o.anchor}"` : ''}${o.bold ? ' font-weight="bold"' : ''}>${esc(s)}</text>`;
    };
    const rowGeom = (n, top, bottom) => (CH - top - bottom) / n;

    const bulletChart = (rows) => {
        const L = 66, R = 34, top = 4, bottom = 22, rh = rowGeom(rows.length, top, bottom);
        const mx = Math.max.apply(null, rows.map((r) => Math.max(r.sales, r.salesTarget, r.salesBudgetMtd))) * 1.04 || 1;
        const W = CW - L - R;
        let s = svgOpen();
        rows.forEach((r, i) => {
            const y = top + i * rh, cy = y + rh / 2;
            const { pct, t } = tierOf(r.sales, r.salesBudgetMtd);
            s += tx(0, cy + 3, r.name);
            s += `<rect x="${L}" y="${(cy - 5).toFixed(1)}" width="${W}" height="10" fill="${C.track}"/>`;
            s += `<rect x="${L}" y="${(cy - 5).toFixed(1)}" width="${(r.salesTarget / mx * W).toFixed(1)}" height="10" fill="${C.band}"/>`;
            s += `<rect x="${L}" y="${(cy - 3).toFixed(1)}" width="${(Math.max(0, r.sales) / mx * W).toFixed(1)}" height="6" fill="${t.fg}"/>`;
            s += `<rect x="${(L + r.salesBudgetMtd / mx * W - 0.75).toFixed(1)}" y="${(cy - 7).toFixed(1)}" width="1.5" height="14" fill="${C.ink}"/>`;
            s += tx(CW, cy + 3, r.salesBudgetMtd ? `${Math.round(pct * 100)}%` : '', { anchor: 'end', bold: true, fill: t.fg });
        });
        const ly = CH - 6;
        s += `<rect x="${L}" y="${ly - 6}" width="12" height="6" fill="${C.navy}"/>` + tx(L + 16, ly, 'MTD sales', { size: 7, fill: C.muted });
        s += `<rect x="${L + 70}" y="${ly - 8}" width="1.5" height="10" fill="${C.ink}"/>` + tx(L + 76, ly, 'Budget MTD', { size: 7, fill: C.muted });
        s += `<rect x="${L + 136}" y="${ly - 7}" width="12" height="8" fill="${C.band}"/>` + tx(L + 152, ly, 'Month target', { size: 7, fill: C.muted });
        return s + '</svg>';
    };

    const varianceChart = (rows) => {
        const L = 66, R = 60, top = 4, bottom = 8;
        const sorted = rows.slice().sort((a, b) => (b.sales - b.salesBudgetMtd) - (a.sales - a.salesBudgetMtd));
        const rh = rowGeom(sorted.length, top, bottom);
        const vm = Math.max.apply(null, sorted.map((r) => Math.abs(r.sales - r.salesBudgetMtd))) || 1;
        const W = CW - L - R, mid = L + W / 2;
        let s = svgOpen();
        sorted.forEach((r, i) => {
            const d = r.sales - r.salesBudgetMtd, cy = top + i * rh + rh / 2;
            const t = tierOf(r.sales, r.salesBudgetMtd).t, w = Math.abs(d) / vm * (W / 2);
            s += tx(0, cy + 3, r.name);
            s += `<rect x="${(d >= 0 ? mid : mid - w).toFixed(1)}" y="${(cy - 4).toFixed(1)}" width="${w.toFixed(1)}" height="8" fill="${t.fg}"/>`;
            s += tx(CW, cy + 3, pdfVar(d), { anchor: 'end', bold: true, fill: t.fg });
        });
        s += `<rect x="${(mid - 0.5).toFixed(1)}" y="${top}" width="1" height="${CH - top - bottom}" fill="${C.ink}"/>`;
        return s + '</svg>';
    };

    const marginChart = (rows) => {
        const L = 66, R = 70, top = 4, bottom = 8, rh = rowGeom(rows.length, top, bottom);
        const mm = Math.ceil(Math.max.apply(null, rows.map((r) => Math.max(r.sales ? r.gp / r.sales : 0, r.salesTarget ? r.gpTarget / r.salesTarget : 0))) * 10) / 10 || 0.5;
        const W = CW - L - R;
        let s = svgOpen();
        rows.forEach((r, i) => {
            const cy = top + i * rh + rh / 2;
            const a = r.sales ? r.gp / r.sales : 0, b = r.salesTarget ? r.gpTarget / r.salesTarget : 0;
            const colour = a >= b ? TIERS.good.fg : TIERS.bad.fg;
            s += tx(0, cy + 3, r.name);
            s += `<rect x="${L}" y="${(cy - 5).toFixed(1)}" width="${W}" height="10" fill="${C.track}"/>`;
            s += `<rect x="${L}" y="${(cy - 3).toFixed(1)}" width="${(Math.max(0, a) / mm * W).toFixed(1)}" height="6" fill="${colour}"/>`;
            s += `<rect x="${(L + b / mm * W - 0.75).toFixed(1)}" y="${(cy - 7).toFixed(1)}" width="1.5" height="14" fill="${C.ink}"/>`;
            s += tx(CW - 34, cy + 3, `${(a * 100).toFixed(1)}%`, { anchor: 'end', bold: true, fill: colour });
            s += tx(CW, cy + 3, `${(b * 100).toFixed(1)}%`, { anchor: 'end', fill: C.muted });
        });
        return s + '</svg>';
    };

    const niceStep = (v) => {
        const p = Math.pow(10, Math.floor(Math.log10(v)));
        const n = v / p;
        return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
    };

    const paceChart = (pace) => {
        const L = 40, R = 8, top = 14, bottom = 18;
        if (!pace || !pace.points.length) {
            return svgOpen() + tx(CW / 2, CH / 2, 'No daily data yet this month', { anchor: 'middle', fill: C.muted }) + '</svg>';
        }
        const n = pace.days.length;
        const last = pace.points[pace.points.length - 1];
        const step = niceStep(Math.max(pace.target, last.cum) / 4);
        const ymax = Math.ceil(Math.max(pace.target, last.cum) * 1.05 / step) * step;
        const X = (i) => L + (CW - L - R) * i / n;
        const Y = (v) => top + (CH - top - bottom) * (1 - v / ymax);
        let s = svgOpen();
        for (let v = 0; v <= ymax + 1; v += step) {
            s += `<rect x="${L}" y="${Y(v).toFixed(1)}" width="${CW - L - R}" height="0.6" fill="${C.faint}"/>`;
            s += tx(L - 5, Y(v) + 3, `${(v / 1e6).toFixed(1)}M`, { anchor: 'end', size: 7, fill: C.muted });
        }
        [1, Math.round(n / 4), Math.round(n / 2), Math.round(3 * n / 4), n].forEach((i) => {
            const d = pace.days[i - 1];
            if (d) s += tx(X(i), CH - 5, `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`, { anchor: i === n ? 'end' : i === 1 ? 'start' : 'middle', size: 7, fill: C.muted });
        });
        s += `<line x1="${X(0)}" y1="${Y(0)}" x2="${X(n).toFixed(1)}" y2="${Y(pace.target).toFixed(1)}" stroke="${C.ink}" stroke-width="1" stroke-dasharray="4 3"/>`;
        const pts = [[X(0), Y(0)]].concat(pace.points.map((p) => [X(p.i), Y(p.cum)]));
        s += `<polyline points="${pts.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ')}" fill="none" stroke="${C.navy}" stroke-width="2"/>`;
        s += `<circle cx="${X(last.i).toFixed(1)}" cy="${Y(last.cum).toFixed(1)}" r="3" fill="${C.navy}"/>`;
        s += tx(X(last.i) - 5, Y(last.cum) + 13, `${(last.cum / 1e6).toFixed(2)}M`, { anchor: 'end', bold: true, fill: C.navy });
        s += tx(X(n) - 4, Y(pace.target) - 6, `Target ${(pace.target / 1e6).toFixed(2)}M`, { anchor: 'end', bold: true });
        return s + '</svg>';
    };

    const paceCaption = (pace) => {
        if (!pace || !pace.points.length) return '';
        const last = pace.points[pace.points.length - 1];
        const due = pace.target * last.i / pace.days.length;
        const d = last.cum - due;
        return `${d >= 0 ? 'Ahead of' : 'Behind'} budget pace by ${fmt(Math.abs(d))} after ${last.i} of ${pace.days.length} working days. Dashed line = monthly target spread evenly over working days.`;
    };

    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];


    const parseYmd = (s) => { const [y, mo, d] = s.split('-').map(Number); return new Date(Date.UTC(y, mo - 1, d)); };
    const displayDate = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
    const longDate = (s) => { const d = parseYmd(s); return `${DAYS_LONG[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };

    // ---------- Model from the NetSuite JSON ----------

    const buildModel = (data) => {
        if (!data || data.schema !== 'intex-daily-sales/1') throw new Error(`Unexpected schema: ${data && data.schema}`);
        // Integrity: NetSuite stamps a SHA-256 of the compact JSON (without "checksum"). Any altered value fails here.
        const { checksum, ...payload } = data;
        if (!checksum) throw new Error('Data file has no checksum; refusing to format unverified figures.');
        const actual = require('crypto').createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex');
        if (actual !== String(checksum).toLowerCase()) throw new Error('Data checksum mismatch: the figures differ from what NetSuite sent.');
        const req = (cond, msg) => { if (!cond) throw new Error(msg); };
        req(/^\d{4}-\d{2}-\d{2}$/.test(data.asOf), 'asOf missing or malformed');
        req(data.countries && data.countries.AU && data.countries.NZ, 'countries.AU / countries.NZ missing');
        const AU = data.countries.AU, NZ = data.countries.NZ;
        const m = {
            asOf: data.asOf,
            cal: data.workingDays,
            warnings: Array.isArray(data.warnings) ? data.warnings.slice() : [],
            AU: { rows: AU.rows, tot: total(AU.rows, 'AU Total'), currency: 'AUD', title: 'Australia by territory' },
            NZ: { rows: NZ.rows, tot: total(NZ.rows, 'NZ Total'), currency: 'NZD', title: 'New Zealand by territory' },
            BR: { rows: data.branches.rows, tot: total(data.branches.rows, 'AU branches'), title: 'By branch' }
        };
        // Cross-check: totals recomputed from rows should match the totals NetSuite sent.
        [['AU', AU], ['NZ', NZ]].forEach(([k, c]) => {
            if (c.total && Math.abs((c.total.sales || 0) - m[k].tot.sales) > 1) m.warnings.push(`${k} sales total mismatch between rows and NetSuite total.`);
        });
        // Pace: cumulative AU sales at each elapsed working day (non-working-day sales roll into the next point).
        const days = (data.workingDays.AU && data.workingDays.AU.dates) || [];
        const elapsed = (data.workingDays.AU && data.workingDays.AU.elapsed) || 0;
        const daily = Array.isArray(data.dailyAU) ? data.dailyAU : [];
        m.pace = days.length ? {
            days,
            target: m.AU.tot.salesTarget,
            points: days.slice(0, elapsed).map((d, i) => ({ i: i + 1, d, cum: daily.filter((x) => x.date <= d).reduce((s, x) => s + (Number(x.sales) || 0), 0) }))
        } : null;
        return m;
    };

    // ---------- Email body: the familiar report layout, cleaned up ----------
    // Same sections and columns as the original NetSuite/Phocas email; the PDF keeps the new design.

    const renderClassicEmail = (m) => {
        const GREEN = { fg: '#1E6B34', bg: '#E2F2E5', sym: '\u25B2' };
        const RED = { fg: '#B3261E', bg: '#FBE4E2', sym: '\u25BC' };
        const F = FONT;
        const th = `padding:6px 8px;font-size:11px;font-weight:bold;color:${C.ink};text-align:right;vertical-align:bottom;border-bottom:2px solid ${C.ink};line-height:1.25`;
        const td = `padding:5px 8px;font-size:13px;text-align:right;white-space:nowrap;border-bottom:1px solid ${C.faint}`;
        const pct = (a, b) => {
            if (!b) return '';
            const v = a / b, t = v >= 1 ? GREEN : RED;
            return `<span style="display:inline-block;min-width:50px;padding:1px 7px;border-radius:9px;background:${t.bg};color:${t.fg};font-weight:bold">${t.sym}&nbsp;${Math.round(v * 100)}%</span>`;
        };
        const gap = '<td style="width:14px;padding:0;border:none"></td>';
        const row = (r, o) => {
            const opt = o || {};
            const st = td + (opt.shade ? ';background:#F7F6F2' : ';background:#FFFFFF')
                + (opt.total ? `;font-weight:bold;border-top:1px solid ${C.ink};border-bottom:3px double ${C.ink}` : '');
            return `<tr>
<td style="${st};text-align:left;font-weight:bold">${esc(r.name)}</td>
<td style="${st}">${fmt(r.salesToday)}</td><td style="${st}">${fmt(r.sales)}</td><td style="${st}">${fmt(r.salesBudgetMtd)}</td>
<td style="${st}">${pct(r.sales, r.salesBudgetMtd)}</td><td style="${st}">${fmt(r.salesTarget)}</td>${gap}
<td style="${st}">${fmt(r.gpToday)}</td><td style="${st}">${fmt(r.gp)}</td><td style="${st}">${fmt(r.gpBudgetMtd)}</td>
<td style="${st}">${pct(r.gp, r.gpBudgetMtd)}</td><td style="${st}">${fmt(r.gpTarget)}</td></tr>`;
        };
        const table = (title, label, rows, tot, extra, note) => `
<tr><td style="padding:22px 0 6px;font-family:${F};font-size:15px;font-weight:bold;color:${C.ink};text-decoration:underline">${esc(title)}</td></tr>
<tr><td>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-family:${F}">
<tr><td style="padding:0"></td>
<td colspan="5" style="padding:4px 8px;text-align:center;font-size:13px;font-weight:bold;color:${C.ink};border-bottom:1px solid ${C.rule}">Sales</td>${gap}
<td colspan="5" style="padding:4px 8px;text-align:center;font-size:13px;font-weight:bold;color:${C.ink};border-bottom:1px solid ${C.rule}">Gross Profits</td></tr>
<tr><td style="${th};text-align:left">${esc(label)}</td>
<td style="${th}">Today's<br>sales</td><td style="${th}">MTD<br>Sales</td><td style="${th}">Budgeted<br>Sales MTD</td><td style="${th}">% Achieved<br>MTD vs Budget</td><td style="${th}">Monthly<br>Sales Target</td>${gap}
<td style="${th}">Today's<br>GP</td><td style="${th}">MTD<br>GP</td><td style="${th}">Budgeted<br>GP MTD</td><td style="${th}">% Achieved<br>MTD vs Budget</td><td style="${th}">Monthly<br>GP Target</td></tr>
${rows.map((r, i) => row(r, { shade: i % 2 === 1 })).join('')}
${row(tot, { total: true })}
${extra ? row(extra, { total: true }) : ''}
</table>
${note ? `<div style="padding-top:4px;font-family:${F};font-size:11px;color:${RED.fg}">${esc(note)}</div>` : ''}
</td></tr>`;
        return `<div style="background:#FFFFFF;padding:16px 0">
<table role="presentation" width="1040" cellpadding="0" cellspacing="0" align="center" style="font-family:${F};color:${C.ink}">
<tr><td style="border-bottom:2px solid ${C.ink};padding-bottom:8px;font-family:${F}">
<span style="font-size:20px;font-weight:bold">Daily Sales Report</span>
<span style="font-size:14px;color:${C.muted}">&nbsp;&middot;&nbsp;${esc(longDate(m.asOf))}</span></td></tr>
${table("Australian Daily Sales & GP's x Territory - Group 1", 'Territories', m.AU.rows, m.AU.tot)}
${table("New Zealand Daily Sales & GP's x Territory - Group 1", 'Territories', m.NZ.rows, m.NZ.tot)}
${table("Group Daily Sales & GP's x Branch - Group 1", 'Branch', m.BR.rows, Object.assign({}, m.BR.tot, { name: 'AU Total' }), Object.assign({}, m.NZ.tot, { name: 'NZ *' }), '*NZ is in NZD and is not added to the AU total.')}
<tr><td style="padding-top:16px;font-family:${F};font-size:11px;color:${C.muted}">
Working days: AU ${m.cal.AU.elapsed} of ${m.cal.AU.total} &middot; NZ ${m.cal.NZ.elapsed} of ${m.cal.NZ.total}. Source: NetSuite invoices and credit memos to ${displayDate(m.asOf)}, product lines only, ex GST. Charts and the detailed layout are in the attached PDF.
${m.warnings.length ? `<br><br><span style="color:${RED.fg}"><b>Check:</b><br>${m.warnings.map(esc).join('<br>')}</span>` : ''}
</td></tr>
</table></div>`;
    };

    // ---------- PDF document (rendered by Chromium) ----------

    const pdfCard = (title, sub, svg, caption) => `
<div class="card"><div class="card-h"><span class="card-t">${esc(title)}</span> <span class="card-s">${esc(sub)}</span></div>
<div class="chart">${svg}</div>${caption ? `<div class="cap">${esc(caption)}</div>` : ''}</div>`;

    const renderPdfHtml = (m) => {
        const au = m.AU.tot;
        const pctSpan = (a, b) => `<span style="color:${tierOf(a, b).t.fg}">${pctText(a, b)}</span>`;
        return `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: A4 landscape; margin: 11mm 12mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: ${FONT}; color: ${C.ink}; background: #FFFFFF; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page1 { height: 186mm; display: flex; flex-direction: column; gap: 10px; }
.head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid ${C.ink}; padding-bottom: 8px; }
.kick { font-size: 11px; font-weight: bold; letter-spacing: .08em; text-transform: uppercase; color: ${C.navy}; }
h1 { margin: 2px 0 0; font-family: Georgia, serif; font-size: 24px; }
.kpis { display: flex; gap: 22px; text-align: right; }
.kpis .l { font-size: 10px; color: ${C.muted}; text-transform: uppercase; letter-spacing: .04em; }
.kpis .v { font-size: 17px; font-weight: bold; font-variant-numeric: tabular-nums; }
.grid { flex: 1; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 10px; min-height: 0; }
.card { background: #fff; border: 1px solid ${C.rule}; box-shadow: none; border-radius: 8px; padding: 9px 12px; display: flex; flex-direction: column; min-height: 0; }
.card-t { font-family: Georgia, serif; font-size: 15px; font-weight: bold; }
.card-s { font-size: 11px; color: ${C.muted}; }
.chart { flex: 1; min-height: 0; display: flex; align-items: center; }
.chart svg { width: 100%; height: 100%; }
.cap { font-size: 10px; color: ${C.muted}; }
.foot { font-size: 10px; color: ${C.muted}; }
.tables { break-before: page; zoom: 0.88; }
.tables table table { break-inside: avoid; }
</style></head><body>
<section class="page1">
<div class="head"><div><div class="kick">Intex &middot; Daily Sales Report</div><h1>Australia at a glance &middot; ${esc(longDate(m.asOf))}</h1></div>
<div class="kpis"><div><div class="l">Sales MTD</div><div class="v">${fmt(au.sales)} ${pctSpan(au.sales, au.salesBudgetMtd)}</div></div>
<div><div class="l">GP MTD</div><div class="v">${fmt(au.gp)} ${pctSpan(au.gp, au.gpBudgetMtd)}</div></div>
<div><div class="l">GP margin</div><div class="v">${margin(au.gp, au.sales)}</div></div></div></div>
<div class="grid">
${pdfCard('Sales vs budget', 'by territory, AUD', bulletChart(m.AU.rows), '')}
${pdfCard('Month pace', 'cumulative AU sales vs target', paceChart(m.pace), paceCaption(m.pace))}
${pdfCard('Where the gap is', 'sales variance to budget MTD, AUD', varianceChart(m.AU.rows), '')}
${pdfCard('GP margin', 'actual (left) vs budgeted (right); marker = budgeted', marginChart(m.AU.rows), '')}
</div>
<div class="foot">Working days AU ${m.cal.AU.elapsed}/${m.cal.AU.total} &middot; NZ ${m.cal.NZ.elapsed}/${m.cal.NZ.total}. Tables follow. Source: NetSuite invoices and credit memos, product lines only, ex GST.</div>
</section>
<section class="tables">${renderEmail(Object.assign({}, m, { noTiles: true, only: ['AU'] }))}</section>
<section class="tables">${renderEmail(Object.assign({}, m, { noTiles: true, only: ['NZ', 'BR'] }))}</section>
</body></html>`;
    };

    // ---------- Main ----------

    const main = async () => {
        const [inFile, outDir] = process.argv.slice(2);
        if (!inFile || !outDir) { console.error('Usage: node render_report.js <data.json> <outDir>'); process.exit(1); }
        let m;
        try { m = buildModel(JSON.parse(fs.readFileSync(inFile, 'utf8'))); } catch (e) { console.error('Bad input: ' + e.message); process.exit(1); }
        fs.mkdirSync(outDir, { recursive: true });
        const base = `Daily_Sales_Report_${m.asOf}`;
        const htmlFile = `${base}.html`, pdfFile = `${base}.pdf`, manFile = `${base}.manifest.json`;
        fs.writeFileSync(path.join(outDir, htmlFile), `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">${renderClassicEmail(m)}</body></html>`);
        let status = 'ok', pdfError = null;
        try {
            const { chromium } = require('playwright');
            const browser = await chromium.launch();
            const page = await browser.newPage();
            await page.setContent(renderPdfHtml(m), { waitUntil: 'load' });
            await page.pdf({ path: path.join(outDir, pdfFile), format: 'A4', landscape: true, printBackground: true, preferCSSPageSize: true });
            await browser.close();
        } catch (e) { status = 'no_pdf'; pdfError = e.message; }
        const manifest = {
            schema: 'intex-daily-sales-output/1', asOf: m.asOf, status,
            subject: `Daily Sales Report - ${displayDate(m.asOf)}`,
            htmlFile, pdfFile: status === 'ok' ? pdfFile : null,
            warnings: m.warnings, pdfError, generatedAt: new Date().toISOString()
        };
        fs.writeFileSync(path.join(outDir, manFile), JSON.stringify(manifest, null, 1));
        console.log(JSON.stringify(manifest));
        process.exit(status === 'ok' ? 0 : 2);
    };

    if (require.main === module) main();
    module.exports = { buildModel, renderEmail, renderClassicEmail, renderPdfHtml };
