// =================================================================
// 참고
// 데이터 저장을 위해 localStorage를 사용
// 실제 다중 사용자 환경의 애플리케이션에서는 반드시 Firebase, Supabase,
// 또는 PostgreSQL/MongoDB와 같은 백엔드 서버와 데이터베이스를 이용해
// 적절히 대체해야 함.
// =================================================================

// --- 1. GLOBAL VARIABLES & MAP INITIALIZATION ---

const map = L.map('map').setView([37.5665, 126.9780], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

const provider = new GeoSearch.OpenStreetMapProvider();
const searchControl = new GeoSearch.GeoSearchControl({
  provider: provider,
  style: 'bar',
  showMarker: true,
  marker: {
    icon: new L.Icon.Default(),
    draggable: false,
  },
  autoClose: true,
  keepResult: true
});
map.addControl(searchControl);

const GRID_CELL_SIZE = 10;
let gridData = new Map();
let clickedLocation = null;
let tempMarker = null;
let gridVisualLayers = [];
let startPoint = null;
let endPoint = null;
let startMarker = null;
let endMarker = null;
let currentRouteLayer = null;
let isPlanningRoute = false;
let tempGridHighlighter = null;

// --- 2. GRID SYSTEM FUNCTIONS ---

function latLngToGridCell(latlng) {
    const projected = L.CRS.EPSG3857.project(latlng);
    const x = Math.floor(projected.x / GRID_CELL_SIZE);
    const y = Math.floor(projected.y / GRID_CELL_SIZE);
    return { x, y };
}

function gridCellToLatLngBounds(gridIndices) {
    const bottomLeftX = gridIndices.x * GRID_CELL_SIZE;
    const bottomLeftY = gridIndices.y * GRID_CELL_SIZE;
    const topRightX = (gridIndices.x + 1) * GRID_CELL_SIZE;
    const topRightY = (gridIndices.y + 1) * GRID_CELL_SIZE;
    const bottomLeftPoint = L.point(bottomLeftX, bottomLeftY);
    const topRightPoint = L.point(topRightX, topRightY);
    const bottomLeftLatLng = L.CRS.EPSG3857.unproject(bottomLeftPoint);
    const topRightLatLng = L.CRS.EPSG3857.unproject(topRightPoint);
    return L.latLngBounds(bottomLeftLatLng, topRightLatLng);
}

function updateGridData(gridIndices, reportData) {
    const gridKey = `${gridIndices.x},${gridIndices.y}`;
    if (!gridData.has(gridKey)) {
        gridData.set(gridKey, {
            avgNoise: 0, avgLight: 0, avgOdor: 0, avgCrowd: 0,
            reportCount: 0, reports: []
        });
    }
    const cellData = gridData.get(gridKey);
    cellData.reports.push(reportData);
    const N = cellData.reports.length;
    cellData.avgNoise = (cellData.avgNoise * (N - 1) + Number(reportData.noise)) / N;
    cellData.avgLight = (cellData.avgLight * (N - 1) + Number(reportData.light)) / N;
    cellData.avgOdor = (cellData.avgOdor * (N - 1) + Number(reportData.odor)) / N;
    cellData.avgCrowd = (cellData.avgCrowd * (N - 1) + Number(reportData.crowd)) / N;
    cellData.reportCount = N;
    localStorage.setItem('gridData', JSON.stringify(Array.from(gridData.entries())));
    console.log(`Grid cell ${gridKey} updated.`, cellData);
}

// --- 3. VISUALIZATION FUNCTIONS ---

function renderGridVisuals() {
    clearGridVisuals();
    gridData.forEach((cellData, gridKey) => {
        const totalAvg = (cellData.avgNoise + cellData.avgLight + cellData.avgOdor + cellData.avgCrowd) / 4;
        if (totalAvg === 0) return;
        let color = 'rgba(0, 128, 0, 0.4)';
        if (totalAvg >= 7) color = 'rgba(255, 0, 0, 0.6)';
        else if (totalAvg >= 4) color = 'rgba(255, 165, 0, 0.5)';
        const indices = gridKey.split(',');
        const gridIndices = { x: Number(indices[0]), y: Number(indices[1]) };
        const bounds = gridCellToLatLngBounds(gridIndices);
        const center = bounds.getCenter();
        const circle = L.circle(center, {
            color: color, fillColor: color,
            fillOpacity: parseFloat(color.split(',')[3]),
            radius: GRID_CELL_SIZE * 1.5,
            interactive: true
        }).addTo(map);
        circle.bindPopup(`
            <div style="font-weight:bold; margin-bottom:5px;">Avg. Sensory Info</div>
            Noise: <b>${cellData.avgNoise.toFixed(1)}</b><br>
            Light: <b>${cellData.avgLight.toFixed(1)}</b><br>
            Odor: <b>${cellData.avgOdor.toFixed(1)}</b><br>
            Crowd: <b>${cellData.avgCrowd.toFixed(1)}</b><br>
            <hr style="margin:5px 0;">
            Total Reports: <b>${cellData.reportCount}</b>
        `);
        gridVisualLayers.push(circle);
    });
}

function clearGridVisuals() {
    gridVisualLayers.forEach(layer => map.removeLayer(layer));
    gridVisualLayers = [];
}

// --- 4. ROUTE PLANNING FUNCTIONS ---

async function fetchWalkRoute(startCoords, endCoords) {
    const apiKey = "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjljN2FhNDU2NjRlZTQ3YzlhODg5YTM4Yjg4YmYyOWVmIiwiaCI6Im11cm11cjY0In0=";
    // 'alternatives' 파라미터를 제거하여 단일 경로만 요청
    const baseUrl = "https://api.openrouteservice.org/v2/directions/foot-walking/geojson";
    const body = {
        coordinates: [
            [startCoords.lng, startCoords.lat],
            [endCoords.lng, endCoords.lat]
        ]
    };
    try {
        const response = await fetch(baseUrl, { // URL에서 alternatives 쿼리 제거
            method: "POST",
            headers: {
                "Authorization": apiKey, "Content-Type": "application/json; charset=utf-8",
                "Accept": "application/json, application/geo+json, application/gpx+xml, img/png; charset=utf-8"
            },
            body: JSON.stringify(body)
        });
        if (!response.ok) {
            const errorData = await response.json();
            console.error("ORS API Error:", errorData);
            throw new Error(`API Error: ${errorData.error?.message || response.status}`);
        }
        return await response.json();
    } catch (err) {
        console.error("Error in fetchWalkRoute:", err);
        throw err;
    }
}

// calculateRouteSensoryCost 함수는 이제 사용되지 않으므로 삭제하거나 주석 처리합니다.
/*
function calculateRouteSensoryCost(routeFeature) {
    // ... (내용 생략)
}
*/

async function calculateAndDrawRoute() {
    if (!startPoint || !endPoint) {
        showToast("Please set both start and end points.");
        return;
    }
    if (currentRouteLayer) {
        map.removeLayer(currentRouteLayer);
        currentRouteLayer = null;
    }

    try {
        const geojson = await fetchWalkRoute(startPoint, endPoint);
        
        if (!geojson || !geojson.features || !geojson.features.length) {
            showToast("No route found.", true);
            console.error("No features in GeoJSON response:", geojson);
            return;
        }

        // API 응답의 첫 번째 경로를 기본 경로로 사용
        const route = geojson.features[0];
        
        const distance = route.properties?.summary?.distance || 0;
        const duration = route.properties?.summary?.duration || 0;

        // 경로를 파란색 실선으로 표시
        const routeLayer = L.geoJSON(route, {
            style: { color: '#007BFF', weight: 6, opacity: 0.9 }
        });

        // 팝업에 거리와 예상 시간 정보 표시
        routeLayer.bindPopup(
            `<b>Route</b><br>Distance: ${(distance / 1000).toFixed(2)} km<br>Duration: ${Math.round(duration / 60)} min`
        );

        currentRouteLayer = L.layerGroup([routeLayer]).addTo(map);
        
        // 지도 범위를 경로에 맞게 조정
        if (routeLayer.getBounds().isValid()) {
            map.fitBounds(routeLayer.getBounds());
            showToast("✔️ Route found!");
        }

        document.getElementById('findRouteBtn').textContent = 'Clear Route';

    } catch (err) {
        showToast(`Route Error: ${err.message}`, true);
        console.error("Error in calculateAndDrawRoute:", err);
    }
}


function resetRoutePlanning() {
    if (currentRouteLayer) map.removeLayer(currentRouteLayer);
    if (startMarker) map.removeLayer(startMarker);
    if (endMarker) map.removeLayer(endMarker);
    
    currentRouteLayer = null;
    startPoint = null;
    endPoint = null;
    startMarker = null;
    endMarker = null;
    isPlanningRoute = false;
    document.getElementById('findRouteBtn').textContent = 'Find My Route';
    showToast('Route cleared.');
}

function setRoutePoint(latlng, type) {
    const iconUrl = type === 'start'
        ? 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png'
        : 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png';
    const markerOptions = { icon: L.icon({ iconUrl, iconSize: [25, 41], iconAnchor: [12, 41] }) };
    if (type === 'start') {
        if (startMarker) map.removeLayer(startMarker);
        startPoint = latlng;
        startMarker = L.marker(latlng, markerOptions).addTo(map);
        showToast('Start point set!');
    } else {
        if (endMarker) map.removeLayer(endMarker);
        endPoint = latlng;
        endMarker = L.marker(latlng, markerOptions).addTo(map);
        showToast('End point set!');
    }
    map.closePopup();
    if (startPoint && endPoint) {
        calculateAndDrawRoute();
    }
}

function handleManualRoutePlanning(latlng) {
    if (!startPoint) {
        setRoutePoint(latlng, 'start');
        showToast('Start point set. Click map for End point.');
    } else if (!endPoint) {
        setRoutePoint(latlng, 'end');
        isPlanningRoute = false;
        document.getElementById('findRouteBtn').textContent = 'Clear Route';
    }
}

// --- 5. EVENT LISTENERS ---

// 지도 클릭 이벤트
map.on('click', function (e) {
    if (isPlanningRoute) {
        handleManualRoutePlanning(e.latlng);
        return;
    }
    if (tempGridHighlighter) map.removeLayer(tempGridHighlighter);
    const gridIndices = latLngToGridCell(e.latlng);
    const gridBounds = gridCellToLatLngBounds(gridIndices);
    tempGridHighlighter = L.rectangle(gridBounds, { color: "#ff7800", weight: 1, fillOpacity: 0.3 }).addTo(map);
    if (tempMarker) map.removeLayer(tempMarker);
    clickedLocation = e.latlng;
    tempMarker = L.marker(e.latlng, { zIndexOffset: 1000 }).addTo(map);
    tempMarker.bindPopup(`
        <div style="padding: 10px; text-align:center; width:180px;">
            <p style="margin-bottom: 10px;"><strong>What would you like to do?</strong></p>
            <div class="route-btn-group" style="margin-bottom: 10px;">
                <button class="popup-route-btn" data-type="start" data-lat="${e.latlng.lat}" data-lng="${e.latlng.lng}">Set as Start</button>
                <button class="popup-route-btn" data-type="end" data-lat="${e.latlng.lat}" data-lng="${e.latlng.lng}">Set as End</button>
            </div>
            <button id="openSensoryBtn" style="width:100%; background-color:#6c757d; color:white; border:none; padding: 8px;">Register Sensory Info</button>
        </div>
    `).openPopup();
});

// 팝업 내 버튼 클릭 이벤트
document.addEventListener('click', (e) => {
    if (e.target?.id === 'openSensoryBtn') {
        document.getElementById('sensoryModal').style.display = 'block';
    }
    if (e.target?.classList.contains('popup-route-btn')) {
        const lat = parseFloat(e.target.getAttribute('data-lat'));
        const lng = parseFloat(e.target.getAttribute('data-lng'));
        const type = e.target.getAttribute('data-type');
        setRoutePoint(L.latLng(lat, lng), type);
    }
});

// 감각 정보 저장 폼
document.getElementById('sensoryForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!clickedLocation) return;
    const reportData = {
        id: Date.now(),
        light: this.light.value,
        noise: this.noise.value,
        odor: this.odor.value,
        crowd: this.crowd.value,
        wheelchair: this.wheelchair.checked,
        location: { lat: clickedLocation.lat, lng: clickedLocation.lng },
        timestamp: new Date().toISOString(),
    };
    const gridIndices = latLngToGridCell(clickedLocation);
    updateGridData(gridIndices, reportData);
    if (tempMarker) map.removeLayer(tempMarker);
    if (tempGridHighlighter) map.removeLayer(tempGridHighlighter);
    tempMarker = null;
    this.reset();
    document.getElementById('sensoryModal').style.display = 'none';
    clickedLocation = null;
    showToast("✔️ Sensory data saved to grid!");
    if (document.getElementById('showRegisteredToggle').checked) {
        renderGridVisuals();
    }
});

// 프로필 저장 폼
document.getElementById('profileForm').addEventListener('submit', function (e) {
    e.preventDefault();
    const profileData = {
        lightThreshold: this.lightThreshold.value,
        noiseThreshold: this.noiseThreshold.value,
        odorThreshold: this.odorThreshold.value,
        crowdThreshold: this.crowdThreshold.value
    };
    localStorage.setItem('sensoryProfile', JSON.stringify(profileData));
    document.getElementById('profileModal').style.display = 'none';
    showToast("✔️ Preferences saved!");
});

// 길찾기 버튼
document.getElementById('findRouteBtn').addEventListener('click', function () {
    if (currentRouteLayer || startPoint || endPoint) {
        resetRoutePlanning();
    } else {
        isPlanningRoute = true;
        document.getElementById('profileModal').style.display = 'none';
        showToast('Click on the map to set START point.');
    }
});

// 모달 닫기 버튼
document.getElementById('closeProfileModal').addEventListener('click', () => {
    document.getElementById('profileModal').style.display = 'none';
});
document.getElementById('closeSensoryModal').addEventListener('click', () => {
    document.getElementById('sensoryModal').style.display = 'none';
});

// === 토글 스위치 이벤트 리스너 ===
document.getElementById('showRegisteredToggle').addEventListener('change', function () {
    if (this.checked) {
        renderGridVisuals();
    } else {
        clearGridVisuals();
    }
});

// === 사이드 메뉴 관련 이벤트 리스너 ===
const sideMenu = document.getElementById('side-menu');
const overlay = document.getElementById('overlay');

function openMenu() {
    sideMenu.style.width = '250px';
    overlay.style.display = 'block';
}
function closeMenu() {
    sideMenu.style.width = '0';
    overlay.style.display = 'none';
}

document.getElementById('hamburger-menu').addEventListener('click', openMenu);
document.getElementById('close-menu').addEventListener('click', closeMenu);
overlay.addEventListener('click', closeMenu);

document.getElementById('menu-profile').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('profileModal').style.display = 'block';
    closeMenu();
});

// 기타 메뉴 항목 (준비 중 알림)
document.getElementById('menu-filter').addEventListener('click', (e) => { e.preventDefault(); alert('감각 필터 기능은 고민중.'); });
document.getElementById('menu-settings').addEventListener('click', (e) => { e.preventDefault(); alert('설정 기능 준비 중입니다.'); });
document.getElementById('menu-help').addEventListener('click', (e) => { e.preventDefault(); alert('도움말 기능 준비 중입니다.'); });
document.getElementById('menu-contact').addEventListener('click', (e) => { e.preventDefault(); alert('문의 기능 준비 중입니다.'); });

// --- 6. UI INITIALIZATION & HELPERS ---

function showToast(msg, isError = false) {
    const toast = document.getElementById("toast");
    toast.textContent = isError ? `❌ ${msg}` : msg;
    toast.style.backgroundColor = isError ? '#c73e3e' : '#323232';
    toast.className = "show";
    setTimeout(() => toast.className = toast.className.replace("show", ""), 3000);
}

window.addEventListener('load', function () {
    // 현재 위치 가져오기
    if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(position => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            map.setView([lat, lng], 16);
            L.marker([lat, lng]).addTo(map).bindPopup('현재 위치').openPopup();
        }, () => {
            showToast("위치 정보를 가져올 수 없습니다.", true);
        });
    }

    // 저장된 데이터 로드
    const savedGridData = localStorage.getItem('gridData');
    if (savedGridData) {
        try {
            const parsedData = JSON.parse(savedGridData);
            if (Array.isArray(parsedData)) {
                gridData = new Map(parsedData);
                // 토글이 켜져있으면 데이터 표시
                if (document.getElementById('showRegisteredToggle').checked) {
                    renderGridVisuals();
                }
            }
        } catch (e) {
            console.error("Error parsing gridData from localStorage", e);
        }
    }
    const savedProfile = JSON.parse(localStorage.getItem('sensoryProfile') || '{}');
    const profileForm = document.getElementById('profileForm');
    if (profileForm && Object.keys(savedProfile).length > 0) {
        for (const [key, value] of Object.entries(savedProfile)) {
            if (profileForm[key]) {
                profileForm[key].value = value;
                profileForm[key].dispatchEvent(new Event('input'));
            }
        }
    }
    
    // 슬라이더 값 표시
    document.querySelectorAll('input[type="range"]').forEach(slider => {
        let span = slider.previousElementSibling?.querySelector('span');
        if (!span) {
            span = document.createElement('span');
            slider.previousElementSibling.appendChild(span);
        }
        const updateSliderValue = () => span.textContent = `(${slider.value})`;
        updateSliderValue();
        slider.addEventListener('input', updateSliderValue);
    });
});
