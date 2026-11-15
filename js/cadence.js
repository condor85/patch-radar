/* PATCH-CADENCE:start */
/* Ritmo delle patch: mediana degli intervalli tra le ultime patch vere. Serve almeno 4 patch e un ritmo non troppo irregolare. */
function patchCadence(items, nowSec) {
 const ds = (items || []).filter(isPatchItem).map(i => i.date).filter(Number.isFinite).sort((a, b) => b - a).slice(0, 8);
 if (ds.length < 4) return null;
 const gaps = []; for (let i = 0; i < ds.length - 1; i++) gaps.push(ds[i] - ds[i + 1]);
 const sorted = [...gaps].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
 const med = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
 const day = 86400;
 if (med < day) return null;
 const spread = (sorted[sorted.length - 1] - sorted[0]) / med;   // quanto sono irregolari gli intervalli
 if (spread > 6) return null;
 const next = ds[0] + med;
 if (nowSec > next + 2 * med) return null;   // in ritardo di molto: il ritmo non vale più, meglio non dire nulla
 return {everyDays: Math.round(med / day), next, overdueDays: nowSec > next ? Math.floor((nowSec - next) / day) : 0};
}
/* PATCH-CADENCE:end */
