// Enhanced Sensmap Application with Watercolor UI
class SensmapApp {
    constructor() {
        this.map = L.map('map', { zoomControl: false }).setView([37.5665, 126.9780], 14);
        this.gridData = new Map();
        this.GRID_CELL_SIZE = 15; // meters
        this.currentMode = 'comfort';
        this.showData = true;
        this.isRouteMode = false;
        this.routePoints = { start: null, end: null };
        this.routeMarkers = { start: null, end: null };
        this.currentRoute = null;
        this.clickedLocation = null;
        this.sensoryLayers = L.layerGroup().addTo(this.map);
        
        this.initializeMap();
        this.setupEventListeners();
        this.loadSavedData();
        this.setupGeolocation();
    }

    initializeMap() {
        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png', {
            attribution: '© OpenStreetMap, © CARTO',
            maxZoom: 19
        }).addTo(this.map);

        L.control.zoom({ position: 'bottomright' }).addTo(this.map);

        const provider = new GeoSearch.OpenStreetMapProvider();
        const searchControl = new GeoSearch.GeoSearchControl({
            provider, style: 'bar',
            showMarker: false, autoClose: true,
            searchLabel: '장소 검색...',
        });
        this.map.addControl(searchControl);
    }

    setupEventListeners() {
        // Header
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', () => this.setVisualizationMode(btn.dataset.mode));
        });
        document.getElementById('intensitySlider').addEventListener('input', (e) => {
            document.getElementById('intensityValue').textContent = e.target.value;
            this.refreshVisualization();
        });
        document.getElementById('showDataBtn').addEventListener('click', () => this.toggleDataDisplay());
        document.getElementById('profileBtn').addEventListener('click', () => this.openProfilePanel());
        document.getElementById('routeBtn').addEventListener('click', () => this.toggleRouteMode());

        // Panels
        document.getElementById('cancelBtn').addEventListener('click', () => this.closeInputPanel());
        document.getElementById('cancelProfileBtn').addEventListener('click', () => this.closeProfilePanel());
        document.getElementById('overlay').addEventListener('click', () => {
            this.closeInputPanel();
            this.closeProfilePanel();
        });
        document.getElementById('addDataFab').addEventListener('click', () => {
             this.showToast('지도를 클릭하여 정보를 추가할 위치를 선택하세요.');
        });
        
        // Forms
        document.getElementById('sensoryForm').addEventListener('submit', (e) => this.handleSensorySubmit(e));
        document.getElementById('profileForm').addEventListener('submit', (e) => this.handleProfileSubmit(e));
        document.getElementById('cancelRouteBtn').addEventListener('click', () => this.cancelRouteMode());

        // Sliders & Type Selector
        document.querySelectorAll('.range-slider').forEach(slider => {
            slider.addEventListener('input', (e) => {
                e.target.parentNode.querySelector('.range-value').textContent = e.target.value;
            });
        });
        document.querySelectorAll('.type-option').forEach(option => {
            option.addEventListener('click', () => {
                document.querySelectorAll('.type-option').forEach(o => o.classList.remove('selected'));
                option.classList.add('selected');
            });
        });

        // Map click
        this.map.on('click', (e) => this.handleMapClick(e));
        setInterval(() => this.cleanupExpiredData(), 60000);
    }

    handleMapClick(e) {
        if (this.isRouteMode) {
            this.handleRouteClick(e.latlng);
            return;
        }

        this.clickedLocation = e.latlng;
        const gridKey = this.getGridKey(e.latlng);
        const cellData = this.gridData.get(gridKey);
        
        // If user intended to add data, open panel directly
        if (!document.getElementById('inputPanel').classList.contains('open')) {
            this.openInputPanel();
        } else {
             this.showLocationPopup(e.latlng, gridKey, cellData);
        }
    }

    // --- Panel Management ---
    openInputPanel() {
        if (!this.clickedLocation) {
            this.showToast('먼저 지도에서 위치를 선택해주세요!', 'info');
            return;
        }
        this.closeProfilePanel();
        document.getElementById('inputPanel').classList.add('open');
        document.getElementById('overlay').classList.add('show');
        document.getElementById('addDataFab').style.display = 'none';
    }
    closeInputPanel() {
        document.getElementById('inputPanel').classList.remove('open');
        document.getElementById('overlay').classList.remove('show');
        document.getElementById('addDataFab').style.display = 'flex';
    }
    openProfilePanel() {
        this.closeInputPanel();
        document.getElementById('profilePanel').classList.add('open');
        document.getElementById('overlay').classList.add('show');
    }
    closeProfilePanel() {
        document.getElementById('profilePanel').classList.remove('open');
        document.getElementById('overlay').classList.remove('show');
    }

    // --- Data Handling & Submission ---
    handleSensorySubmit(e) {
        e.preventDefault();
        if (!this.clickedLocation) return;
        const formData = new FormData(e.target);
        const selectedType = document.querySelector('.type-option.selected').dataset.type;
        
        const reportData = {
            id: Date.now(), timestamp: Date.now(), type: selectedType,
            noise: parseInt(formData.get('noise')), light: parseInt(formData.get('light')),
            odor: parseInt(formData.get('odor')), crowd: parseInt(formData.get('crowd')),
            wheelchair: formData.get('wheelchair') === 'on',
            location: { lat: this.clickedLocation.lat, lng: this.clickedLocation.lng }
        };

        this.addSensoryData(this.clickedLocation, reportData);
        e.target.reset();
        document.querySelectorAll('.range-slider').forEach(slider => {
            slider.parentNode.querySelector('.range-value').textContent = slider.value;
        });
        this.closeInputPanel();
        this.map.closePopup();
        this.showToast('감각 정보가 물들었어요!', 'success');
    }

    handleProfileSubmit(e) {
        e.preventDefault();
        const formData = new FormData(e.target);
        const profileData = {
            noiseThreshold: parseInt(formData.get('noiseThreshold')),
            lightThreshold: parseInt(formData.get('lightThreshold')),
            odorThreshold: parseInt(formData.get('odorThreshold')),
            crowdThreshold: parseInt(formData.get('crowdThreshold'))
        };
        this.saveSensitivityProfile(profileData);
        this.closeProfilePanel();
        this.refreshVisualization();
        this.showToast('나만의 감각 프로필이 저장됐어요!', 'success');
    }

    addSensoryData(latlng, reportData) {
        const gridKey = this.getGridKey(latlng);
        if (!this.gridData.has(gridKey)) {
            this.gridData.set(gridKey, { reports: [], bounds: this.getGridBounds(gridKey) });
        }
        const cellData = this.gridData.get(gridKey);
        cellData.reports.push(reportData);
        this.saveGridData();
        this.refreshVisualization();
    }

    deleteReport(gridKey, reportId) {
        if (!confirm('이 감각 정보를 지울까요?')) return;
        const cellData = this.gridData.get(gridKey);
        if (!cellData) return;
        cellData.reports = cellData.reports.filter(report => report.id !== reportId);
        if (cellData.reports.length === 0) this.gridData.delete(gridKey);
        this.saveGridData();
        this.refreshVisualization();
        this.map.closePopup();
        this.showToast('감각 정보가 지워졌습니다', 'success');
    }

    // --- Visualization ---
    refreshVisualization() {
        if (!this.showData) return;
        this.sensoryLayers.clearLayers();
        const profile = this.getSensitivityProfile();
        const intensity = parseFloat(document.getElementById('intensitySlider').value);
        const currentTime = Date.now();

        this.gridData.forEach((cellData, gridKey) => {
            if (!cellData.reports || cellData.reports.length === 0) return;
            
            let totalWeight = 0;
            let weightedScores = { noise: 0, light: 0, odor: 0, crowd: 0 };
            let hasWheelchairIssue = false;

            cellData.reports.forEach(report => {
                const timeDecay = this.calculateTimeDecay(report.timestamp, report.type, currentTime);
                if (timeDecay > 0.1) {
                    const weight = timeDecay;
                    Object.keys(weightedScores).forEach(key => weightedScores[key] += report[key] * weight);
                    totalWeight += weight;
                    if (report.wheelchair) hasWheelchairIssue = true;
                }
            });

            if (totalWeight === 0) return;

            Object.keys(weightedScores).forEach(key => weightedScores[key] /= totalWeight);
            const personalizedScore = this.calculatePersonalizedScore(weightedScores, profile);
            this.createWatercolorMarker(gridKey, weightedScores, personalizedScore, hasWheelchairIssue, intensity, totalWeight);
        });
    }

    createWatercolorMarker(gridKey, sensoryData, personalizedScore, hasWheelchairIssue, intensity, weight) {
        const bounds = this.getGridBounds(gridKey);
        const center = bounds.getCenter();
        let color = '#cccccc';
        let size = 20;
        let opacity = 0.6;
        let content = '';

        switch (this.currentMode) {
            case 'intensity':
                const maxValue = Math.max(sensoryData.noise, sensoryData.light, sensoryData.odor, sensoryData.crowd);
                const colors = { noise: '#ff6b9d', light: '#ffd93d', odor: '#6bcf7f', crowd: '#4ecdc4' };
                const dominantSense = Object.keys(sensoryData).reduce((a, b) => sensoryData[a] > sensoryData[b] ? a : b);
                color = colors[dominantSense];
                size = 20 + (maxValue * 3) * intensity;
                opacity = 0.5 + (maxValue / 10) * 0.4;
                content = `🔥`;
                break;
            case 'gradient':
                const gradScore = Math.max(0, Math.min(10, personalizedScore));
                const hue_grad = 240 - (gradScore * 18); // Blue(6) to Magenta(300) to Red(0)
                color = `hsl(${hue_grad}, 80%, 60%)`;
                size = 25 + (gradScore * 2.5) * intensity;
                opacity = 0.6 * intensity;
                content = `🌈`;
                break;
            default: // comfort
                const score = Math.max(0, Math.min(10, personalizedScore));
                const hue_comfort = (10 - score) * 12; // 0 (red) to 120 (green)
                color = `hsl(${hue_comfort}, 70%, 55%)`;
                size = 20 + (score * 3) * intensity;
                opacity = 0.6 + (weight / 5) * 0.3; // More reports = more solid
                content = hasWheelchairIssue ? '♿' : Math.round(score);
        }

        const bleedSize = size * 1.5;
        const icon = L.divIcon({
            className: 'watercolor-marker',
            html: `
                <div class="droplet-bleed" style="width:${bleedSize}px; height:${bleedSize}px; background:${color}; top:-${bleedSize*0.25}px; left:-${bleedSize*0.25}px;"></div>
                <div class="droplet-content" style="width:${size}px; height:${size}px; background:${color}; opacity:${opacity};">
                    ${content}
                </div>
            `,
            iconSize: [bleedSize, bleedSize],
            iconAnchor: [bleedSize / 2, bleedSize / 2]
        });

        const marker = L.marker(center, { icon });
        marker.on('click', () => {
            this.showLocationPopup(center, gridKey, this.gridData.get(gridKey));
        });
        this.sensoryLayers.addLayer(marker);
    }
    
    // --- Routing ---
    toggleRouteMode() {
        this.isRouteMode = !this.isRouteMode;
        const btn = document.getElementById('routeBtn');
        const controls = document.getElementById('routeControls');
        if (this.isRouteMode) {
            btn.classList.add('active');
            controls.classList.add('show');
            document.getElementById('routeStatus').textContent = '출발지 선택';
            this.showToast('지도에서 출발지를 콕! 찍어주세요', 'info');
        } else {
            this.cancelRouteMode();
        }
    }

    cancelRouteMode() {
        this.isRouteMode = false;
        document.getElementById('routeBtn').classList.remove('active');
        document.getElementById('routeControls').classList.remove('show');
        Object.values(this.routeMarkers).forEach(marker => {
            if (marker) this.map.removeLayer(marker);
        });
        if (this.currentRoute) {
            this.map.removeLayer(this.currentRoute);
            this.currentRoute = null;
        }
        this.routePoints = { start: null, end: null };
        this.routeMarkers = { start: null, end: null };
    }
    
    handleRouteClick(latlng) {
        if (!this.routePoints.start) this.setRoutePoint('start', latlng);
        else if (!this.routePoints.end) {
            this.setRoutePoint('end', latlng);
            this.calculateRoute();
        }
    }
    
    setRoutePoint(type, latlng) {
        if (this.routeMarkers[type]) this.map.removeLayer(this.routeMarkers[type]);
        this.routePoints[type] = latlng;
        const iconColor = type === 'start' ? '#10b981' : '#ef4444';
        const iconHTML = type === 'start' ? '<i class="fas fa-play"></i>' : '<i class="fas fa-flag-checkered"></i>';
        const icon = L.divIcon({
            className: 'route-marker',
            html: `<div style="background: ${iconColor}; width: 30px; height: 30px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3); display:flex; align-items:center; justify-content:center; color:white; font-size:14px;">${iconHTML}</div>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        });
        this.routeMarkers[type] = L.marker(latlng, { icon }).addTo(this.map);
        const status = type === 'start' ? '도착지 선택' : '경로 계산 중...';
        document.getElementById('routeStatus').textContent = status;
    }

    async calculateRoute() {
        if (!this.routePoints.start || !this.routePoints.end) return;
        this.showToast('가장 쾌적한 길을 찾고 있어요...', 'info');
        const { start, end } = this.routePoints;
        const url = `https://router.project-osrm.org/route/v1/walking/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson&alternatives=true`;
        
        try {
            const response = await fetch(url);
            const data = await response.json();
            if (data.routes && data.routes.length > 0) {
                const bestRoute = this.selectBestRoute(data.routes);
                this.displayRoute(bestRoute);
                document.getElementById('routeStatus').textContent = '경로 생성 완료';
                this.showToast('나만의 감각 경로 완성!', 'success');
            } else { throw new Error('경로를 찾을 수 없습니다'); }
        } catch (error) {
            this.showToast('경로 계산에 실패했어요', 'error');
            document.getElementById('routeStatus').textContent = '계산 실패';
        }
    }

    selectBestRoute(routes) {
        const profile = this.getSensitivityProfile();
        let bestRoute = null;
        let bestScore = Infinity;

        routes.forEach(route => {
            const sensoryScore = this.calculateRouteSensoryScore(route.geometry, profile);
            const distance = route.distance;
            const totalScore = (distance * 0.0003) + (sensoryScore * 0.7); // 30% distance, 70% comfort
            if (totalScore < bestScore) {
                bestScore = totalScore;
                bestRoute = route;
            }
        });
        return bestRoute || routes[0];
    }

    calculateRouteSensoryScore(geometry, profile) {
        let totalScore = 0;
        let segmentCount = 0;
        const coordinates = geometry.coordinates;

        for (let i = 0; i < coordinates.length - 1; i++) {
            const point = L.latLng(coordinates[i][1], coordinates[i][0]);
            const gridKey = this.getGridKey(point);
            const cellData = this.gridData.get(gridKey);
            let segmentScore = 2.5; // Neutral score

            if (cellData && cellData.reports && cellData.reports.length > 0) {
                let weightedScore = 0;
                let totalWeight = 0;
                const currentTime = Date.now();
                cellData.reports.forEach(report => {
                    const timeDecay = this.calculateTimeDecay(report.timestamp, report.type, currentTime);
                    if (timeDecay > 0.1) {
                        const weight = timeDecay;
                        const reportScore = this.calculatePersonalizedScore(report, profile);
                        weightedScore += reportScore * weight;
                        totalWeight += weight;
                    }
                });
                if (totalWeight > 0) segmentScore = weightedScore / totalWeight;
            }
            totalScore += segmentScore;
            segmentCount++;
        }
        return segmentCount > 0 ? totalScore / segmentCount : 2.5;
    }

    displayRoute(route) {
        if (this.currentRoute) this.map.removeLayer(this.currentRoute);
        this.currentRoute = L.geoJSON(route.geometry, {
            style: { color: '#4a90e2', weight: 8, opacity: 0.8, lineCap: 'round', dashArray: '1, 10' }
        }).addTo(this.map);
        this.map.fitBounds(this.currentRoute.getBounds(), { padding: [50, 50] });
    }

    // --- Utility & Helper Methods ---
    showLocationPopup(latlng, gridKey, cellData) {
        const hasData = cellData && cellData.reports && cellData.reports.length > 0;
        let popupContent = `
            <div class="popup-header">
                <div class="popup-title">장소 정보</div>
                <div class="popup-subtitle">${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}</div>
            </div>
            <div class="action-grid">
                <button class="action-btn start" data-lat="${latlng.lat}" data-lng="${latlng.lng}"><i class="fas fa-play"></i> 출발</button>
                <button class="action-btn end" data-lat="${latlng.lat}" data-lng="${latlng.lng}"><i class="fas fa-flag-checkered"></i> 도착</button>
            </div>`;
        if (hasData) {
            popupContent += `<div class="data-summary"><div class="summary-title">등록된 정보 (${cellData.reports.length}개)</div>`;
            cellData.reports.slice(0, 3).forEach(report => {
                popupContent += `<div class="data-item"><div>
                    <span class="data-badge">소음 ${report.noise}</span><span class="data-badge">빛 ${report.light}</span>
                    </div><button class="delete-btn" onclick="window.sensmapApp.deleteReport('${gridKey}', ${report.id})">삭제</button></div>`;
            });
            popupContent += `</div>`;
        }
        const popup = L.popup({className: 'custom-popup'}).setLatLng(latlng).setContent(popupContent).openOn(this.map);
        
        setTimeout(() => {
            popup.getElement().querySelectorAll('.action-btn.start, .action-btn.end').forEach(btn => {
                btn.addEventListener('click', () => {
                    this.setRoutePoint(btn.dataset.type, L.latLng(parseFloat(btn.dataset.lat), parseFloat(btn.dataset.lng)));
                    this.map.closePopup();
                    if (!this.isRouteMode) this.toggleRouteMode();
                });
            });
        }, 100);
    }
    
    toggleDataDisplay() {
        this.showData = !this.showData;
        const btn = document.getElementById('showDataBtn');
        if (this.showData) {
            btn.classList.add('active');
            btn.querySelector('i').className = 'fas fa-eye';
            this.refreshVisualization();
        } else {
            btn.classList.remove('active');
            btn.querySelector('i').className = 'fas fa-eye-slash';
            this.sensoryLayers.clearLayers();
        }
    }
    
    setVisualizationMode(mode) {
        this.currentMode = mode;
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
        this.refreshVisualization();
    }

    calculateTimeDecay(timestamp, type, currentTime) {
        const ageHours = (currentTime - timestamp) / 3600000;
        const maxAge = type === 'irregular' ? 6 : 168; // 6 hours or 1 week
        const decayRate = type === 'irregular' ? 0.8 : 0.3;
        if (ageHours >= maxAge) return 0;
        return Math.exp(-decayRate * (ageHours / maxAge));
    }

    calculatePersonalizedScore(sensoryData, profile) {
        const weights = {
            noise: profile.noiseThreshold / 10, light: profile.lightThreshold / 10,
            odor: profile.odorThreshold / 10, crowd: profile.crowdThreshold / 10
        };
        let totalScore = 0, totalWeight = 0;
        Object.keys(weights).forEach(key => {
            if (sensoryData[key] !== undefined) {
                totalScore += sensoryData[key] * weights[key];
                totalWeight += weights[key];
            }
        });
        return totalWeight > 0 ? totalScore / totalWeight : 0;
    }

    cleanupExpiredData() {
        const currentTime = Date.now();
        let hasChanges = false;
        this.gridData.forEach((cellData, gridKey) => {
            const validReports = cellData.reports.filter(report => this.calculateTimeDecay(report.timestamp, report.type, currentTime) > 0);
            if (validReports.length !== cellData.reports.length) {
                hasChanges = true;
                if (validReports.length === 0) this.gridData.delete(gridKey);
                else cellData.reports = validReports;
            }
        });
        if (hasChanges) {
            this.saveGridData();
            this.refreshVisualization();
        }
    }

    getGridKey(latlng) {
        const projected = L.CRS.EPSG3857.project(latlng);
        return `${Math.floor(projected.x / this.GRID_CELL_SIZE)},${Math.floor(projected.y / this.GRID_CELL_SIZE)}`;
    }

    getGridBounds(gridKey) {
        const [x, y] = gridKey.split(',').map(Number);
        const p1 = L.point(x * this.GRID_CELL_SIZE, y * this.GRID_CELL_SIZE);
        const p2 = L.point((x + 1) * this.GRID_CELL_SIZE, (y + 1) * this.GRID_CELL_SIZE);
        return L.latLngBounds(L.CRS.EPSG3857.unproject(p1), L.CRS.EPSG3857.unproject(p2));
    }
    
    getSensitivityProfile() {
        const saved = JSON.parse(localStorage.getItem('sensoryProfile') || '{}');
        return {
            noiseThreshold: saved.noiseThreshold || 5, lightThreshold: saved.lightThreshold || 5,
            odorThreshold: saved.odorThreshold || 5, crowdThreshold: saved.crowdThreshold || 5
        };
    }

    saveSensitivityProfile(profile) { localStorage.setItem('sensoryProfile', JSON.stringify(profile)); }
    saveGridData() { localStorage.setItem('gridData', JSON.stringify(Array.from(this.gridData.entries()))); }

    loadSavedData() {
        try {
            const savedGridData = localStorage.getItem('gridData');
            if (savedGridData) this.gridData = new Map(JSON.parse(savedGridData));
            const savedProfile = this.getSensitivityProfile();
            const profileForm = document.getElementById('profileForm');
            Object.entries(savedProfile).forEach(([key, value]) => {
                const input = profileForm.querySelector(`[name="${key}"]`);
                if (input) {
                    input.value = value;
                    input.parentNode.querySelector('.range-value').textContent = value;
                }
            });
            this.refreshVisualization();
        } catch (error) { console.error('Error loading saved data:', error); }
    }

    setupGeolocation() {
        if ('geolocation' in navigator) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    this.map.setView([position.coords.latitude, position.coords.longitude], 16);
                    this.showToast('현재 위치로 이동했어요!', 'success');
                },
                () => this.showToast('위치 정보를 가져올 수 없어요', 'error')
            );
        }
    }

    showToast(message, type = 'info') {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.className = `toast show ${type}`;
        setTimeout(() => toast.classList.remove('show'), 3000);
    }
}

window.sensmapApp = new SensmapApp();
