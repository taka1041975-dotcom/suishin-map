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

    // ---- 地図／航空写真の切替（陸だけ写真にし、海は水深の色のまま） ----
    const GSI = 'https://cyberjapandata.gsi.go.jp/xyz/';
    const PHOTO = (z, x, y) => `${GSI}seamlessphoto/${z}/${x}/${y}.jpg`, PALE = (z, x, y) => `${GSI}pale/${z}/${x}/${y}.png`;
    A.BASE.paleURL = PALE;
    const photo = L.tileLayer(GSI + 'seamlessphoto/{z}/{x}/{y}.jpg', { maxNativeZoom: 18, maxZoom: 17, crossOrigin: 'anonymous', zIndex: 0 });
    A.sea.setZIndex(2);
    // 写真モードでは陸が透明なので、前のズームの海タイルが残ると穴から透けて見える。読み込み後に片付ける
    A.sea.on('load', () => { if (A.BASE.photo) setTimeout(() => A.sea._pruneTiles(), 300); });
    const bctl = L.control({ position: 'topright' });
    bctl.onAdd = () => {
      const d = L.DomUtil.create('div', 'leaflet-bar basesw');
      d.innerHTML = '<a href="#" id="base-map" role="button">地図</a><a href="#" id="base-photo" role="button">写真</a>';
      L.DomEvent.disableClickPropagation(d);
      return d;
    };
    bctl.addTo(map);
    const css = document.createElement('style');
    css.textContent = `.basesw { display: flex; } .basesw a { width: auto !important; padding: 0 10px; font-size: 13px; font-weight: 700; }
      .basesw a + a { border-left: 1px solid #ccc; } .basesw a[aria-pressed="true"] { background: #1d2a36; color: #fff; }`;
    document.head.appendChild(css);
    function setBase(on) {
      A.BASE.photo = on;
      $('base-map').setAttribute('aria-pressed', !on); $('base-photo').setAttribute('aria-pressed', on);
      if (on) photo.addTo(map); else photo.remove();
      map.setMaxZoom(on ? 17 : 13);
      A.sea.redraw();
      try { localStorage.setItem('base', on ? 'photo' : 'map'); } catch (e) {}
    }
    $('base-map').onclick = e => { e.preventDefault(); if (A.BASE.photo) setBase(false); };
    $('base-photo').onclick = e => { e.preventDefault(); if (!A.BASE.photo) setBase(true); };
    let saved = null; try { saved = localStorage.getItem('base'); } catch (e) {}
    setBase(saved === 'photo');

    // ---- 圏外用の保存 ----
    const sec = document.createElement('section');
    sec.innerHTML = `<h2>圏外で使う</h2>
      <p class="small">一度表示した場所は端末に保存され、圏外でも見られます。出かける前にまとめて保存しておくと確実です。写真を表示中に「表示中の範囲を保存」を押すと、その範囲の航空写真も3段階拡大分まで保存します（全国保存には写真は入りません）。</p>
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
      if (A.BASE.photo) {
        // 航空写真と、海岸線用の淡色地図（z12以上）を今のズームから3段階分
        const z0 = Math.max(8, map.getZoom()), z1 = Math.min(z0 + 3, 17);
        const tw = b.getWest(), te = b.getEast(), tn = b.getNorth(), ts = b.getSouth();
        let n = 0;
        for (let z = z0; z <= z1 && n < 4000; z++)
          for (let x = lon2t(tw, z); x <= lon2t(te, z); x++)
            for (let y = lat2t(tn, z); y <= lat2t(ts, z); y++) {
              out.add(PHOTO(z, x, y)); n++;
              if (z > 11) out.add(PALE(z, x, y));
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
          try { const r = await fetch(f, f.startsWith('http') ? { mode: 'cors' } : undefined); if (!r.ok && r.status !== 404) throw 0; bytes += (await r.arrayBuffer()).byteLength; } catch (e) { failed++; }
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
