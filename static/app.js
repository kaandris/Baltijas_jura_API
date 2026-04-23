import Map from 'https://esm.sh/ol@10.9.0/Map.js';
import View from 'https://esm.sh/ol@10.9.0/View.js';
import TileLayer from 'https://esm.sh/ol@10.9.0/layer/Tile.js';
import WebGLTileLayer from 'https://esm.sh/ol@10.9.0/layer/WebGLTile.js';
import VectorLayer from 'https://esm.sh/ol@10.9.0/layer/Vector.js';

import OSM from 'https://esm.sh/ol@10.9.0/source/OSM.js';
import GeoTIFFSource from 'https://esm.sh/ol@10.9.0/source/GeoTIFF.js';
import VectorSource from 'https://esm.sh/ol@10.9.0/source/Vector.js';

import Draw from 'https://esm.sh/ol@10.9.0/interaction/Draw.js';
import Modify from 'https://esm.sh/ol@10.9.0/interaction/Modify.js';
import Snap from 'https://esm.sh/ol@10.9.0/interaction/Snap.js';

import Feature from 'https://esm.sh/ol@10.9.0/Feature.js';
import Point from 'https://esm.sh/ol@10.9.0/geom/Point.js';

import {fromLonLat, toLonLat} from 'https://esm.sh/ol@10.9.0/proj.js';
import {defaults as defaultControls} from 'https://esm.sh/ol@10.9.0/control/defaults.js';
import {Circle as CircleStyle, Fill, Stroke, Style} from 'https://esm.sh/ol@10.9.0/style.js';

const hoverBox = document.getElementById('hover-info');
const profilePanel = document.getElementById('profile-panel');
const closeProfileBtn = document.getElementById('close-profile');
const drawProfileBtn = document.getElementById('draw-profile');
const clearProfileBtn = document.getElementById('clear-profile');

let chart = null;
let hoverTimer = null;
let lastHoverReq = 0;
let drawInteraction = null;

const base = new TileLayer({
  source: new OSM(),
});

const bathySource = new GeoTIFFSource({
  sources: [
    { url: '/public/Baltic_bathymetry_COG-4326.tif' },
  ],
  projection: 'EPSG:4326',
  normalize: false,
  interpolate: true,
});

const bathy = new WebGLTileLayer({
  source: bathySource,
  opacity: 0.92,
  style: {
    color: [
      'case',
      ['==', ['band', 1], -32767], [0, 0, 0, 0],

      ['interpolate',
        ['linear'],
        ['band', 1],

        -300, [8, 48, 107, 1],
        -200, [16, 78, 139, 1],
        -120, [28, 107, 160, 1],
        -80,  [44, 138, 176, 1],
        -50,  [65, 174, 188, 1],
        -25,  [127, 205, 187, 1],
        -10,  [199, 233, 180, 1],
        -2,   [237, 248, 177, 1],
        0,    [0, 0, 0, 0]
      ]
    ],
  },
});

const profileSource = new VectorSource();

const profileLayer = new VectorLayer({
  source: profileSource,
  style: [
    new Style({
      stroke: new Stroke({
        color: '#1d4ed8',
        width: 3,
      }),
    }),
    new Style({
      image: new CircleStyle({
        radius: 5,
        fill: new Fill({color: '#1d4ed8'}),
        stroke: new Stroke({color: '#ffffff', width: 1.5}),
      }),
    }),
  ],
});

const markerSource = new VectorSource();

const markerLayer = new VectorLayer({
  source: markerSource,
  style: new Style({
    image: new CircleStyle({
      radius: 6,
      fill: new Fill({color: '#dc2626'}),
      stroke: new Stroke({color: '#ffffff', width: 2}),
    }),
  }),
});

const map = new Map({
  target: 'map',
  layers: [base, bathy, profileLayer, markerLayer],
  controls: defaultControls(),
  view: new View({
    center: fromLonLat([19.86, 59.87]),
    zoom: 5.5,
  }),
});

const modify = new Modify({source: profileSource});
const snap = new Snap({source: profileSource});

map.addInteraction(modify);
map.addInteraction(snap);

function renderHover(data) {
  if (data.depth_m == null) {
    hoverBox.innerHTML = `
      <strong>No data</strong><br>
      ${data.lat.toFixed(5)}, ${data.lng.toFixed(5)}
    `;
    return;
  }

  hoverBox.innerHTML = `
    <strong>Depth:</strong> ${Math.round(data.depth_m)} m<br>
    <strong>Source:</strong> ${data.tid_label}<br>
    <strong>Confidence:</strong> ${data.confidence}<br>
    <strong>Lat/Lng:</strong> ${data.lat.toFixed(5)}, ${data.lng.toFixed(5)}
  `;
}

map.on('pointermove', (evt) => {
  if (evt.dragging) return;

  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(async () => {
    const reqId = ++lastHoverReq;
    const [lng, lat] = toLonLat(evt.coordinate);

    try {
      const res = await fetch(`/api/query?lat=${lat}&lng=${lng}`);
      const data = await res.json();
      if (reqId !== lastHoverReq) return;
      renderHover(data);
    } catch (err) {
      hoverBox.textContent = 'Query error';
    }
  }, 70);
});

function destroyOldProfile() {
  if (chart) {
    chart.destroy();
    chart = null;
  }
  markerSource.clear();
}

function setProfileMarker(lat, lng) {
  markerSource.clear();
  markerSource.addFeature(
    new Feature({
      geometry: new Point(fromLonLat([lng, lat])),
    })
  );
}

function buildProfileChart(profile) {
  profilePanel.classList.remove('hidden');
  destroyOldProfile();

  const ctx = document.getElementById('profile-chart').getContext('2d');

  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: profile.dist_km,
      datasets: [{
        label: 'Depth (m)',
        data: profile.depth_m,
        tension: 0.15,
        pointRadius: 0,
        spanGaps: true,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      scales: {
        x: {
          title: {
            display: true,
            text: 'Distance (km)',
          }
        },
        y: {
          reverse: false,
          title: {
            display: true,
            text: 'Depth (m)',
          }
        }
      },
      plugins: {
        tooltip: {
          callbacks: {
            afterBody: (items) => {
              const i = items[0].dataIndex;
              return `Source: ${profile.tid_label[i]}`;
            }
          }
        }
      },
      onHover: (evt, activeEls) => {
        if (!activeEls.length) return;
        const i = activeEls[0].index;
        const pt = profile.points[i];
        setProfileMarker(pt.lat, pt.lng);
      }
    }
  });
}

async function fetchProfileFromFeature(feature) {
  const geometry = feature.getGeometry();
  const coords = geometry.getCoordinates().map((c) => {
    const [lng, lat] = toLonLat(c);
    return [lat, lng];
  });

  const res = await fetch('/api/profile', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({coords}),
  });

  return await res.json();
}

async function refreshProfile(feature) {
  const profile = await fetchProfileFromFeature(feature);
  if (!profile.error) {
    buildProfileChart(profile);
  }
}

function enableDraw() {
  if (drawInteraction) {
    map.removeInteraction(drawInteraction);
  }

  profileSource.clear();
  markerSource.clear();

  drawInteraction = new Draw({
    source: profileSource,
    type: 'LineString',
  });

  drawInteraction.on('drawend', async (evt) => {
    map.removeInteraction(drawInteraction);
    drawInteraction = null;
    await refreshProfile(evt.feature);
  });

  map.addInteraction(drawInteraction);
}

drawProfileBtn.addEventListener('click', () => {
  enableDraw();
});

clearProfileBtn.addEventListener('click', () => {
  profileSource.clear();
  markerSource.clear();
  profilePanel.classList.add('hidden');
  destroyOldProfile();
  if (drawInteraction) {
    map.removeInteraction(drawInteraction);
    drawInteraction = null;
  }
});

closeProfileBtn.addEventListener('click', () => {
  profilePanel.classList.add('hidden');
  destroyOldProfile();
});

modify.on('modifyend', async () => {
  const feature = profileSource.getFeatures()[0];
  if (feature) {
    await refreshProfile(feature);
  }
});
