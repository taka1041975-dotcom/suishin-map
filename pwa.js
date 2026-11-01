// Webアプリ版だけの追加機能：現在地（GPS）と圏外用の保存
(function () {
  'use strict';
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(e => console.warn('sw', e));

  function init() {
    const A = window.APP, map = A.map, meta = A.meta;
    const $ = id => document.getElementById(id);

    // ---- 現在地 ----
    let watchId = null, follow = false, dot = null, ring = null, first = true;
    const ctl = L.control({ position: 'topleft' });
    ctl.onAdd = () => {
      const d = L.DomUtil.create('div', 'leaflet-bar');
      d.innerHTML = '<a href="#" id="gps-btn" role="button" aria-label="現在地を表示" title="現在地">' +
        '<svg viewBox="0 0 24 24" width="18" height="18" style="vertical-align:-3px" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="8"/></svg></a>';
      L.DomEvent.disableClickPropagation(d);
      return d;
    };
    ctl.addTo(map);
    const btn = $('gps-btn');
    const paint = () => { btn.style.color = watchId === null ? '' : follow ? '#1a73e8' : '#5f6b76'; };
    function onPos(pos) {
      const ll = L.latLng(pos.coords.latitude, pos.coords.longitude), acc = Math.round(pos.coords.accuracy);
      if (!dot) {
        ring = L.circle(ll, { radius: acc, color: '#1a73e8', weight: 1, opacity: .4, fillOpacity: .08, interactive: false }).addTo(map);
        dot = L.circleMarker(ll, { radius: 7, color: '#ffffff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1, interactive: false }).addTo(map);
      } else { dot.setLatLng(ll); ring.setLatLng(ll).setRadius(acc); }
      if (follow) {
        if (first) { map.setView(ll, Math.max(map.getZoom(), 11)); first = false; } else map.panTo(ll, { animate: true });
        A.setPoint(ll).then(() => { const w = $('r-where'); if (w) w.textContent = `現在地（誤差 約${acc}m）　` + w.textContent; });
      }
    }
    function onErr(e) {
      stop();
      setStatus(e.code === 1 ? '位置情報の利用が許可されていません。iPhoneの「設定」→「プライバシー」→「位置情報サービス」で許可してください。' : '現在地を取得できませんでした。');
    }
    function stop() {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      watchId = null; follow = false;
      if (dot) { map.removeLayer(dot); map.removeLayer(ring); dot = ring = null; }
      paint();
    }
    btn.addEventListener('click', e => {
      e.preventDefault();
      if (!navigator.geolocation) { setStatus('この端末では現在地を使えません。'); return; }
      if (watchId === null) {
        follow = true; first = true;
        watchId = navigator.geolocation.watchPosition(onPos, onErr, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
      } else if (!follow) { follow = true; first = true; if (dot) onPos({ coords: { latitude: dot.getLatLng().lat, longitude: dot.getLatLng().lng, accuracy: ring.getRadius() } }); }
      else stop();
      paint();
    });
    map.on('dragstart', () => { if (follow) { follow = false; paint(); } });

    // ---- 圏外用の保存 ----
    const sec = document.createElement('section');
    sec.innerHTML = `<h2>圏外で使う</h2>
      <p class="small">一度表示した場所は端末に保存され、圏外でも見られます。出かける前にまとめて保存しておくと確実です。</p>
      <div class="places" style="margin-top:8px"><button id="save-view">表示中の範囲を保存</button><button id="save-all">全国を保存（約130MB）</button></div>
      <p class="small" id="save-status" style="margin-top:6px"></p>`;
    const go = $('h-go').closest('section');
    go.after(sec);
    function setStatus(t) { const el = $('save-status'); if (el) el.textContent = t; }

    const lon2t = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
    const lat2t = (lat, z) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z); };
    const pad = v => String(v).padStart(2, '0');
    function filesFor(b) {
      const W = Math.max(meta.west, b.getWest()), E = Math.min(meta.east, b.getEast());
      const S = Math.max(meta.south, b.getSouth()), N = Math.min(meta.north, b.getNorth());
      const out = new Set();
      if (W >= E || S >= N) return [];
      for (const [i, j] of meta.chunks) {
        const w = meta.west + i * meta.chunkDeg, n = meta.north - j * meta.chunkDeg;
        if (w < E && w + meta.chunkDeg > W && n > S && n - meta.chunkDeg < N) out.add(`data/c${pad(i)}_${pad(j)}.png`);
      }
      for (let z = 5; z <= 11; z++) {
        const sh = 3;
        for (let x = lon2t(W, z) >> sh; x <= lon2t(E, z) >> sh; x++)
          for (let y = lat2t(N, z) >> sh; y <= lat2t(S, z) >> sh; y++) {
            const name = `${z}_${x}_${y}`;
            if (A.GIDX.has(name)) out.add(`gsi/${name}.webp`);
          }
      }
      return [...out];
    }
    let busy = false;
    async function save(files, label) {
      if (busy) return; busy = true;
      try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) {}
      let done = 0, bytes = 0, failed = 0;
      const queue = files.slice();
      const worker = async () => {
        while (queue.length) {
          const f = queue.shift();
          try { const r = await fetch(f); if (!r.ok) throw 0; bytes += (await r.arrayBuffer()).byteLength; } catch (e) { failed++; }
          done++;
          setStatus(`${label}を保存中… ${done} / ${files.length}（${(bytes / 1e6).toFixed(0)}MB）`);
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      busy = false;
      setStatus(failed ? `${failed}件を保存できませんでした。電波の良い場所でもう一度押してください。`
        : `${label}を保存しました（${(bytes / 1e6).toFixed(0)}MB）。圏外でも表示できます。`);
    }
    $('save-view').onclick = () => save(filesFor(map.getBounds()), '表示中の範囲');
    $('save-all').onclick = () => save([...meta.chunks.map(([i, j]) => `data/c${pad(i)}_${pad(j)}.png`), ...[...A.GIDX].map(n => `gsi/${n}.webp`)], '全国');
  }
  if (window.APP) init(); else document.addEventListener('app-ready', init, { once: true });
})();
