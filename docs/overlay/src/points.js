// Per-viewer points, persisted in localStorage. Earned by chatting,
// spent on nothing yet — but they weight duels and show in the debug HUD,
// so regulars have stakes.
const KEY = "nubcat_points_v1";

let data = {};
try { data = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { data = {}; }

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
}

export const Points = {
  add(name, n) {
    const k = String(name).toLowerCase();
    if (!k) return;
    data[k] = (data[k] || 0) + n;
    save();
  },
  get(name) {
    return data[String(name).toLowerCase()] || 0;
  },
  top(n = 3) {
    return Object.entries(data)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n);
  },
};
