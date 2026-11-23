/* Sanitary fitment calculator, Cap. 123I Part II (L.N. 191 of 2015). */
(function () {
  var C = Math.ceil;
  function per(n, k) { return n > 0 ? C(n / k) : 0; }
  function over(base, n, lim, k) { return base + C((n - lim) / k); }
  var USES = {
    res:   { label: "Residential (general) 住宅 — 1 / 9 m² UFA", rate: 9, ratio: [1, 1] },
    tene:  { label: "Tenement house / dormitory / barrack / boarding house 唐樓、宿舍 — 1 / 3 m²", rate: 3, ratio: [1, 1], res: true },
    office:{ label: "Office 辦公室 — 1 / 9 m²", rate: 9, ratio: [1, 1] },
    ffact: { label: "Flatted factory 分層工廠 — 1 / 4.5 m²", rate: 4.5, ratio: [1, 1] },
    ware:  { label: "Warehouse / godown / storage 倉庫 — 1 / 30 m²", rate: 30, ratio: [1, 1] },
    shop:  { label: "Shop not in arcade / dept store 獨立商店 — 1 / 15 m²", rate: 15, ratio: [1, 1] },
    food:  { label: "Food room of restaurant > 300 persons 大型食肆食物室 — 1 / 4.5 m²", rate: 4.5, ratio: [1, 1] },
    arcL:  { label: "Shopping arcade / dept store, B–2/F 商場（地庫至2樓）— 1 / 3 m²", rate: 3, ratio: [1, 1.5] },
    arcU:  { label: "Shopping arcade / dept store, 3/F+ 商場（3樓或以上）— 1 / 4.5 m²", rate: 4.5, ratio: [1, 1.5] },
    rest:  { label: "Restaurant (excl. food room) 食肆 — 1 / 1.5 m²", rate: 1.5, ratio: [1, 1.5] },
    museum:{ label: "PPE: museum / exhibition hall 博物館／展覽廳 — 1 / 2 m²", rate: 2, ratio: [1, 1.5] },
    dance: { label: "PPE: dance party (dancing area) 舞會 — 1 / 0.75 m²", rate: 0.75, ratio: [1, 1.5] },
    assem: { label: "PPE: assembly / auditorium, no or movable seats 集會（無固定座位）— 1 / 0.5 m²", rate: 0.5, ratio: [1, 1.5] },
    assemS:{ label: "PPE: assembly / auditorium, fixed seats 集會（固定座位）— per seat", seats: true, ratio: [1, 1.5] },
    stad:  { label: "Sports stadium, no or movable seats 體育場 — 1 / 0.5 m²", rate: 0.5, ratio: [1, 1] },
    stadS: { label: "Sports stadium, fixed seats 體育場（固定座位）— per seat", seats: true, ratio: [1, 1] },
    cin:   { label: "Cinema 電影院 — per seat", seats: true, ratio: [1, 1.5] },
    relig: { label: "Religious institution 宗教機構 — 1 / 0.5 m²", rate: 0.5, ratio: [1, 1.5] },
    fun:   { label: "Funeral parlour 殯儀館 — 1 / 0.5 m²", rate: 0.5, ratio: [1, 1.5] }
  };
  var GROUP = { res: "res", tene: "res", office: "work", ffact: "work", ware: "work", shop: "work", food: "work",
    arcL: "arc", arcU: "arc", rest: "rest", museum: "ppe", dance: "ppe", assem: "ppe", assemS: "ppe",
    stad: "stad", stadS: "stad", cin: "cin", relig: "relig", fun: "fun" };

  function work(m, f) {
    if (m + f <= 10) return { note: "≤ 10 persons: at least 1 WC and 1 basin in total (reg. 5(3)). 合共不多於10人：最少1個水廁及1個洗手盆。", mWC: 1, mU: 0, mB: 1, fWC: 0, fB: 0, shared: true };
    return {
      mWC: m <= 10 ? (m ? 1 : 0) : m <= 100 ? per(m, 25) : over(4, m, 100, 50),
      mU: m <= 10 ? 0 : m <= 100 ? per(m, 50) : over(2, m, 100, 50),
      fWC: f <= 10 ? (f ? 1 : 0) : f <= 25 ? 2 : over(2, f, 25, 25),
      mB: m <= 100 ? per(m, 25) : over(4, m, 100, 50),
      fB: f <= 100 ? per(f, 25) : over(4, f, 100, 50),
      ref: "Tables 5–7, reg. 5"
    };
  }
  function band(n, rows) { for (var i = 0; i < rows.length; i++) if (n <= rows[i][0]) return rows[i][1]; return null; }
  function rest(P, m, f) {
    if (P < 25) return { note: "< 25 persons: 1 WC + 1 basin for both sexes and 1 urinal, WC and urinal in separate rooms (reg. 8(1A)–(1B)). 少於25人：男女共用1個水廁及1個洗手盆，另1個尿廁，水廁與尿廁分房。", mWC: 1, mU: 1, mB: 1, fWC: 0, fB: 0, shared: true };
    var mWC = m <= 40 ? 1 : m <= 80 ? 1 : m <= 150 ? 2 : m <= 200 ? 2 : m <= 300 ? 3 : m <= 400 ? 4 : m <= 650 ? 5 : over(5, m, 650, 250);
    var mU = m <= 40 ? 1 : m <= 80 ? 2 : m <= 150 ? 3 : m <= 200 ? 4 : m <= 300 ? over(4, m, 200, 50) : m <= 400 ? over(6, m, 300, 50) : m <= 650 ? over(8, m, 400, 50) : over(13, m, 650, 50);
    var fWC = f <= 60 ? 1 : f <= 120 ? 2 : f <= 180 ? 3 : f <= 200 ? 4 : over(4, f, 200, 100);
    var mB = m <= 80 ? 1 : m <= 120 ? 2 : m <= 150 ? 3 : over(3, m, 150, 100);
    var fB = f <= 120 ? 1 : f <= 180 ? 2 : f <= 250 ? 4 : over(4, f, 250, 100);
    return { mWC: mWC, mU: mU, fWC: fWC, mB: mB, fB: fB, ref: "Tables 26–28, reg. 8" };
  }
  function calc(key, P) {
    var u = USES[key], g = GROUP[key];
    var tot = u.ratio[0] + u.ratio[1];
    var m = C(P * u.ratio[0] / tot), f = C(P * u.ratio[1] / tot);
    var r;
    if (g === "res") {
      var unisex = P <= 8 ? 1 : over(1, P, 8, 12);
      var sepM = m <= 8 ? 1 : over(1, m, 8, 12), sepF = f <= 8 ? 1 : over(1, f, 8, 12);
      var t3 = m <= 12 ? 1 : over(1, m, 12, 12);
      var bb = P <= 8 ? 1 : over(1, P, 8, 12);
      return { m: m, f: f, html:
        "<tr><td>Not separated by sex 不分性別 (Table 1)</td><td colspan=3>WC <b>" + unisex + "</b></td></tr>" +
        "<tr><td>Separate WCs 分性別 (Table 2)</td><td colspan=3>Male WC <b>" + sepM + "</b> · Female WC <b>" + sepF + "</b></td></tr>" +
        "<tr><td>Separate, with urinals 設尿廁 (Table 3, male)</td><td colspan=3>Male WC <b>" + t3 + "</b> + urinals <b>" + t3 + "</b> · Female WC <b>" + sepF + "</b></td></tr>" +
        "<tr><td>Basins; baths or showers 洗手盆；浴缸或花灑 (Table 4)</td><td colspan=3>Basins <b>" + bb + "</b> · Baths / showers <b>" + bb + "</b>" + (u.res ? " (water supply points may replace them in a tenement house, reg. 4(2))" : "") + "</td></tr>" };
    }
    if (g === "work") r = work(m, f);
    else if (g === "rest") r = rest(P, m, f);
    else if (g === "ppe") r = { mWC: m <= 400 ? per(m, 100) : over(4, m, 400, 250), mU: per(m, 50), fWC: f <= 250 ? 2 * per(f, 50) : over(10, f, 250, 40), mB: per(m, 100), fB: per(f, 100), ref: "Tables 8–10, reg. 6" };
    else if (g === "stad") r = { mWC: per(m, 100), mU: per(m, 100), fWC: per(f, 50), mB: per(m, 100), fB: per(f, 100), ref: "Tables 11–13, reg. 6A" };
    else if (g === "cin") r = { mWC: m <= 200 ? (m ? 1 : 0) : m <= 500 ? 2 : m <= 1000 ? 3 : over(3, m, 1000, 500), mU: per(m, 100),
      fWC: f <= 120 ? per(f, 40) : f <= 250 ? over(3, f, 120, 65) : f <= 420 ? over(5, f, 250, 85) : over(7, f, 420, 100), mB: per(m, 100), fB: per(f, 100), ref: "Tables 14–16, reg. 7" };
    else if (g === "arc") r = { mWC: m <= 500 ? per(m, 125) : over(4, m, 500, 250), mU: per(m, 250),
      fWC: f <= 50 ? per(f, 25) : f <= 125 ? 3 : f <= 1800 ? over(3, f, 125, 80) : over(24, f, 1800, 90),
      mB: m <= 500 ? per(m, 125) : over(4, m, 500, 250), fB: f <= 500 ? per(f, 125) : over(4, f, 500, 250), ref: "Tables 17–19, reg. 7A" };
    else if (g === "relig") r = { mWC: per(m, 100), mU: per(m, 100), fWC: per(f, 50), mB: per(m, 100), fB: per(f, 100), ref: "Tables 20–22, reg. 7B" };
    else if (g === "fun") r = { mWC: per(m, 150), mU: per(m, 150), fWC: per(f, 75), mB: per(m, 300), fB: per(f, 300), ref: "Tables 23–25, reg. 7C" };
    var h = r.note ? "<tr><td colspan=4><b>" + r.note + "</b></td></tr>" : "";
    h += "<tr><td>Male 男</td><td><b>" + r.mWC + "</b></td><td><b>" + r.mU + "</b></td><td><b>" + r.mB + "</b></td></tr>";
    if (!r.shared) h += "<tr><td>Female 女</td><td><b>" + r.fWC + "</b></td><td>—</td><td><b>" + r.fB + "</b></td></tr>";
    if (r.ref) h += "<tr><td colspan=4><small>" + r.ref + "</small></td></tr>";
    return { m: m, f: f, html: h, tbl: true };
  }
  function init() { try { init0(); } catch (e) { console.error("sanfit", e); } }
  function init0() {
    var root = document.getElementById("sanfit-calc");
    if (!root || root.dataset.ready) return;
    root.dataset.ready = "1";
    var sel = root.querySelector("#sf-use"), inp = root.querySelector("#sf-qty"), lab = root.querySelector("#sf-qlabel"), out = root.querySelector("#sf-out");
    Object.keys(USES).forEach(function (k) { var o = document.createElement("option"); o.value = k; o.textContent = USES[k].label; sel.appendChild(o); });
    function run() {
      var u = USES[sel.value], q = parseFloat(inp.value) || 0;
      lab.textContent = u.seats ? "Number of seats 座位數目" : "Usable floor area (m²) 實用樓面面積（平方米）";
      var P = u.seats ? C(q) : C(q / u.rate);
      if (P <= 0) { out.innerHTML = ""; return; }
      var r = calc(sel.value, P);
      var head = "<p>Persons 人數: <b>" + P + "</b> → male 男 <b>" + r.m + "</b> / female 女 <b>" + r.f + "</b> (ratio 比例 " + u.ratio.join(":") + ")</p>";
      out.innerHTML = head + "<table><thead>" + (r.tbl ? "<tr><th></th><th>WC 水廁</th><th>Urinal 尿廁</th><th>Basin 洗手盆</th></tr>" : "<tr><th>Option 方案</th><th colspan=3>Minimum 最少數目</th></tr>") + "</thead><tbody>" + r.html + "</tbody></table>";
    }
    sel.addEventListener("change", run); inp.addEventListener("input", run); run();
  }
  if (window.document$ && document$.subscribe) document$.subscribe(init);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
