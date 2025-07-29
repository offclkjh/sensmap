// Enhanced Sensmap Application
class SensmapApp {
    constructor() {
        this.map = L.map('map').setView([37.5665, 126.9780], 14);
        this.gridData = new Map();
        this.GRID_CELL_SIZE = 100; // meters
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
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 19
        }).addTo(this.map);

        // Add search control
        const provider = new GeoSearch.OpenStreetMapProvider();
        const searchControl = new GeoSearch.GeoSearchControl({
            provider,
            style: 'bar',
            showMarker: false,
            autoClose: true,
            keepResult: false
        });
        this.map.addControl(searchControl);
    }

    setupEventListeners() {
        // Header controls
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

        // Panel controls
        document.getElementById('cancelBtn').addEventListener('click', () => this.closePanels());
        document.getElementById('cancelProfileBtn').addEventListener('click', () => this.closePanels());
        document.getElementById('cancelRouteBtn').addEventListener('click', () => this.cancelRouteMode());

        // Forms
        document.getElementById('sensoryForm').addEventListener('submit', (e) => this.handleSensorySubmit(e));
        document.getElementById('profileForm').addEventListener('submit', (e) => this.handleProfileSubmit(e));

        // Slider updates
        document.querySelectorAll('.range-slider').forEach(slider => {
            slider.addEventListener('input', (e) => {
                e.target.parentNode.querySelector('.range-value').textContent = e.target.value;
            });
        });

        // Type selector
        document.querySelectorAll('.type-option').forEach(option => {
            option.addEventListener('click', () => {
                document.querySelectorAll('.type-option').forEach(o => o.classList.remove('selected'));
                option.classList.add('selected');
            });
        });

        // Map click
        this.map.on('click', (e) => this.handleMapClick(e));

        // Auto cleanup old data
        setInterval(() => this.cleanupExpiredData(), 60000); // Every minute
    }

    handleMapClick(e) {
        if (this.isRouteMode) {
            this.handleRouteClick(e.latlng);
            return;
        }

        this.clickedLocation = e.latlng;
        const gridKey = this.getGridKey(e.latlng);
        const cellData = this.gridData.get(gridKey);
        
        this.showLocationPopup(e.latlng, gridKey, cellData);
    }

    handleRouteClick(latlng) {
        if (!this.routePoints.start) {
            this.setRoutePoint('start', latlng);
        } else if (!this.routePoints.end) {
            this.setRoutePoint('end', latlng);
            this.calculateRoute();
        }
    }

    setRoutePoint(type, latlng) {
        if (this.routeMarkers[type]) {
            this.map.removeLayer(this.routeMarkers[type]);
        }

        this.routePoints[type] = latlng;
        
        const iconColor = type === 'start' ? '#10b981' : '#ef4444';
        const icon = L.divIcon({
            className: 'route-marker',
            html: `<div style="background: ${iconColor}; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);"></div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });

        this.routeMarkers[type] = L.marker(latlng, { icon }).addTo(this.map);
        
        const status = type === 'start' ? '도착지 선택' : '경로 계산 중...';
        document.getElementById('routeStatus').textContent = status;
    }

    async calculateRoute() {
        if (!this.routePoints.start || !this.routePoints.end) return;

        try {
            this.showToast('경로를 탐색하는 중입니다...', 'info');

            const start = this.routePoints.start;
            const end = this.routePoints.end;

            const apiKey = '3DKyXMJJB21kUPzdWrjnnafysfIkwIbB8mUR4G9I';  // 반드시 본인 키로 교체
            const url = 'https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1';

            const body = {
                startX: start.lng.toString(),
                startY: start.lat.toString(),
                endX: end.lng.toString(),
                endY: end.lat.toString(),
                reqCoordType: 'WGS84GEO',
                resCoordType: 'WGS84GEO',
                startName: '출발지',
                endName: '도착지'
            };

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'appKey': apiKey
                },
                body: JSON.stringify(body)
            });

            const data = await response.json();

            if (data.features && data.features.length > 0) {
                this.displayTmapRoute(data.features);
                document.getElementById('routeStatus').textContent = '경로 생성 완료';
                this.showToast('경로를 탐색했습니다!', 'success');
            } else {
                throw new Error('경로 탐색에 실패했습니다!');
            }
        } catch (error) {
            console.error('경로 오류:', error);
            this.showToast('경로 계산 중 오류가 발생했습니다', 'error');
            document.getElementById('routeStatus').textContent = '경로 계산 실패';
        }
    }
   

    // selectBestRoute(routes) {
    //     const profile = this.getSensitivityProfile();
    //     let bestRoute = routes[0];
    //     let bestScore = Infinity;

    //     routes.forEach(route => {
    //         const sensoryScore = this.calculateRouteSensoryScore(route.geometry, profile);
    //         const distance = route.distance;
            
    //         // Weighted score: 30% distance, 70% comfort
    //         const totalScore = (distance * 0.0003) + (sensoryScore * 0.7);
            
    //         if (totalScore < bestScore) {
    //             bestScore = totalScore;
    //             bestRoute = route;
    //         }
    //     });

    //     return bestRoute;
    // }

    // calculateRouteSensoryScore(geometry, profile) {
    //     let totalScore = 0;
    //     let segmentCount = 0;

    //     const coordinates = geometry.coordinates;
    //     for (let i = 0; i < coordinates.length - 1; i++) {
    //         const point = L.latLng(coordinates[i][1], coordinates[i][0]);
    //         const gridKey = this.getGridKey(point);
    //         const cellData = this.gridData.get(gridKey);

    //         let segmentScore = 2.5; // Neutral score for unknown areas

    //         if (cellData && cellData.reports && cellData.reports.length > 0) {
    //             const currentTime = Date.now();
    //             let weightedScore = 0;
    //             let totalWeight = 0;

    //             cellData.reports.forEach(report => {
    //                 const timeDecay = this.calculateTimeDecay(report.timestamp, report.type, currentTime);
    //                 if (timeDecay > 0.1) { // Only consider non-expired data
    //                     const weight = timeDecay;
    //                     const reportScore = this.calculatePersonalizedScore(report, profile);
    //                     weightedScore += reportScore * weight;
    //                     totalWeight += weight;
    //                 }
    //             });

    //             if (totalWeight > 0) {
    //                 segmentScore = weightedScore / totalWeight;
    //             }
    //         }

    //         totalScore += segmentScore;
    //         segmentCount++;
    //     }

    //     return segmentCount > 0 ? totalScore / segmentCount : 2.5;
    // }

    displayTmapRoute(features) {
        if (this.currentRoute) {
            this.map.removeLayer(this.currentRoute);
        }

        // 전체 경로 좌표 모으기
        const routeCoords = [];

        let totalDistance = 0;

        features.forEach(feature => {
            if (feature.geometry.type === 'LineString') {
                feature.geometry.coordinates.forEach(coord => {
                    routeCoords.push([coord[1], coord[0]]); // [lat, lng]로 변환
                });

                if (feature.properties && feature.properties.distance) {
                    totalDistance += parseFloat(feature.properties.distance);
                }
            }
        });

        // 지도에 폴리라인 추가
        this.currentRoute = L.polyline(routeCoords, {
            color: '#1a73e8',
            weight: 6,
            opacity: 0.8,
            lineJoin: 'round',
            lineCap: 'round'
        }).addTo(this.map);

        // 예상 시간 계산
        const distanceInKm = totalDistance / 1000;
        const estimatedDuration = Math.round((distanceInKm / 4.8) * 60); // 도보 평균 속도 4.8km/h

        // 팝업 설정
        this.currentRoute.bindPopup(`
            <div class="popup-header">
                <div class="popup-title">도보 경로</div>
                <div class="popup-subtitle">기반 경로</div>
            </div>
            <div style="padding: 12px 0;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                    <span>거리:</span>
                    <strong>${distanceInKm.toFixed(1)}km</strong>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span>예상 시간:</span>
                    <strong>${estimatedDuration}분</strong>
                </div>
            </div>
        `);

        this.map.fitBounds(this.currentRoute.getBounds(), { padding: [50, 50] });
    }


    showLocationPopup(latlng, gridKey, cellData) {
        const hasData = cellData && cellData.reports && cellData.reports.length > 0;
        
        let popupContent = `
            <div class="custom-popup">
                <div class="popup-header">
                    <div class="popup-title">위치 정보</div>
                    <div class="popup-subtitle">좌표: ${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}</div>
                </div>
                
                <div class="action-grid">
                    <button class="action-btn start" data-type="start" data-lat="${latlng.lat}" data-lng="${latlng.lng}">
                        <i class="fas fa-play"></i> 출발
                    </button>
                    <button class="action-btn end" data-type="end" data-lat="${latlng.lat}" data-lng="${latlng.lng}">
                        <i class="fas fa-flag-checkered"></i> 도착
                    </button>
                </div>
                
                <button class="action-btn add" onclick="window.sensmapApp.openSensoryPanel()">
                    <i class="fas fa-plus"></i> ${hasData ? '새 정보 추가' : '감각 정보 등록'}
                </button>
        `;

        if (hasData) {
            popupContent += `
                <div class="data-summary">
                    <div class="summary-title">등록된 정보 (${cellData.reports.length}개)</div>
            `;
            
            cellData.reports.slice(0, 3).forEach((report, index) => {
                const timeAgo = this.getTimeAgo(report.timestamp);
                const typeLabel = report.type === 'irregular' ? '⚡' : '🏢';
                
                popupContent += `
                    <div class="data-item">
                        <div>
                            <div class="data-values">
                                <span class="data-badge">소음 ${report.noise}</span>
                                <span class="data-badge">빛 ${report.light}</span>
                                <span class="data-badge">냄새 ${report.odor}</span>
                                <span class="data-badge">혼잡 ${report.crowd}</span>
                                ${report.wheelchair ? '<span class="data-badge">♿</span>' : ''}
                            </div>
                            <div style="font-size: 10px; color: #6b7280; margin-top: 2px;">
                                ${typeLabel} ${timeAgo}
                            </div>
                        </div>
                        <button class="delete-btn" onclick="window.sensmapApp.deleteReport('${gridKey}', ${report.id})">
                            삭제
                        </button>
                    </div>
                `;
            });
            
            if (cellData.reports.length > 3) {
                popupContent += `<div style="text-align: center; font-size: 11px; color: #6b7280; margin-top: 8px;">+${cellData.reports.length - 3}개 더</div>`;
            }
            
            popupContent += `</div>`;
        }

        popupContent += `</div>`;

        const popup = L.popup({
            maxWidth: 300,
            className: 'custom-popup'
        })
        .setLatLng(latlng)
        .setContent(popupContent)
        .openOn(this.map);

        // Add event listeners to popup buttons
        setTimeout(() => {
            document.querySelectorAll('.action-btn.start, .action-btn.end').forEach(btn => {
                btn.addEventListener('click', () => {
                    const type = btn.dataset.type;
                    const lat = parseFloat(btn.dataset.lat);
                    const lng = parseFloat(btn.dataset.lng);
                    this.setRoutePoint(type, L.latLng(lat, lng));
                    this.map.closePopup();
                    if (!this.isRouteMode) {
                        this.toggleRouteMode();
                    }
                });
            });
        }, 100);
    }

    openSensoryPanel() {
        this.closePanels();
        document.getElementById('sidePanel').classList.add('open');
    }

    openProfilePanel() {
        this.closePanels();
        document.getElementById('profilePanel').classList.add('open');
    }

    closePanels() {
        document.querySelectorAll('.side-panel').forEach(panel => {
            panel.classList.remove('open');
        });
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

    toggleRouteMode() {
        this.isRouteMode = !this.isRouteMode;
        const btn = document.getElementById('routeBtn');
        const controls = document.getElementById('routeControls');

        if (this.isRouteMode) {
            btn.classList.add('active');
            controls.classList.add('show');
            document.getElementById('routeStatus').textContent = '출발지 선택';
            this.showToast('지도를 클릭하여 출발지를 선택하세요', 'info');
        } else {
            this.cancelRouteMode();
        }
    }

    cancelRouteMode() {
        this.isRouteMode = false;
        document.getElementById('routeBtn').classList.remove('active');
        document.getElementById('routeControls').classList.remove('show');
        
        // Clear route markers and route
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

    setVisualizationMode(mode) {
        this.currentMode = mode;
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
        this.refreshVisualization();
    }

    handleSensorySubmit(e) {
        e.preventDefault();
        if (!this.clickedLocation) return;

        const formData = new FormData(e.target);
        const selectedType = document.querySelector('.type-option.selected').dataset.type;
        
        const reportData = {
            id: Date.now(),
            timestamp: Date.now(),
            type: selectedType,
            noise: parseInt(formData.get('noise')),
            light: parseInt(formData.get('light')),
            odor: parseInt(formData.get('odor')),
            crowd: parseInt(formData.get('crowd')),
            wheelchair: formData.get('wheelchair') === 'on',
            location: {
                lat: this.clickedLocation.lat,
                lng: this.clickedLocation.lng
            }
        };

        this.addSensoryData(this.clickedLocation, reportData);
        
        // Reset form and close panel
        e.target.reset();
        document.querySelectorAll('.range-slider').forEach(slider => {
            slider.parentNode.querySelector('.range-value').textContent = slider.value;
        });
        document.querySelectorAll('.type-option').forEach(o => o.classList.remove('selected'));
        document.querySelector('.type-option[data-type="irregular"]').classList.add('selected');
        
        this.closePanels();
        this.map.closePopup();
        this.clickedLocation = null;
        
        this.showToast('감각 정보가 저장되었습니다!', 'success');
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
        this.closePanels();
        this.refreshVisualization();
        this.showToast('감각 프로필이 업데이트되었습니다!', 'success');
    }

    addSensoryData(latlng, reportData) {    
        const gridKey = this.getGridKey(latlng);
        
        if (!this.gridData.has(gridKey)) {
            this.gridData.set(gridKey, {
                reports: [],
                bounds: this.getGridBounds(gridKey)
            });
        }

        const cellData = this.gridData.get(gridKey);
        cellData.reports.push(reportData);
        
        this.saveGridData();
        this.refreshVisualization();
    }

    deleteReport(gridKey, reportId) {
        if (!confirm('이 감각 정보를 삭제하시겠습니까?')) return;

        const cellData = this.gridData.get(gridKey);
        if (!cellData) return;

        cellData.reports = cellData.reports.filter(report => report.id !== reportId);
        
        if (cellData.reports.length === 0) {
            this.gridData.delete(gridKey);
        }

        this.saveGridData();
        this.refreshVisualization();
        this.map.closePopup();
        this.showToast('감각 정보가 삭제되었습니다', 'success');
    }

    refreshVisualization() {
        if (!this.showData) return;

        this.sensoryLayers.clearLayers();
        const profile = this.getSensitivityProfile();
        const intensity = parseFloat(document.getElementById('intensitySlider').value);
        const currentTime = Date.now();

        this.gridData.forEach((cellData, gridKey) => {
            if (!cellData.reports || cellData.reports.length === 0) return;

            // Calculate current weighted averages with time decay
            let totalWeight = 0;
            let weightedScores = { noise: 0, light: 0, odor: 0, crowd: 0 };
            let hasWheelchairIssue = false;

            cellData.reports.forEach(report => {
                const timeDecay = this.calculateTimeDecay(report.timestamp, report.type, currentTime);
                
                if (timeDecay > 0.1) { // Only consider non-expired data
                    const weight = timeDecay;
                    weightedScores.noise += report.noise * weight;
                    weightedScores.light += report.light * weight;
                    weightedScores.odor += report.odor * weight;
                    weightedScores.crowd += report.crowd * weight;
                    totalWeight += weight;
                    
                    if (report.wheelchair) hasWheelchairIssue = true;
                }
            });

            if (totalWeight === 0) return; // No valid data

            // Normalize weighted scores
            Object.keys(weightedScores).forEach(key => {
                weightedScores[key] /= totalWeight;
            });

            const personalizedScore = this.calculatePersonalizedScore(weightedScores, profile);
            this.createVisualizationMarker(gridKey, weightedScores, personalizedScore, hasWheelchairIssue, intensity);
        });
    }

    calculateTimeDecay(timestamp, type, currentTime) {
        const ageMs = currentTime - timestamp;
        const ageHours = ageMs / (1000 * 60 * 60);

        // Different decay rates for different types
        let maxAge, decayRate;
        
        if (type === 'irregular') {
            maxAge = 6; // 6 hours
            decayRate = 0.8; // Faster decay
        } else {
            maxAge = 168; // 1 week
            decayRate = 0.3; // Slower decay
        }

        if (ageHours >= maxAge) return 0;
        
        // Exponential decay
        return Math.exp(-decayRate * (ageHours / maxAge));
    }

    calculatePersonalizedScore(sensoryData, profile) {
        const weights = {
            noise: profile.noiseThreshold / 10,
            light: profile.lightThreshold / 10,
            odor: profile.odorThreshold / 10,
            crowd: profile.crowdThreshold / 10
        };

        let totalScore = 0;
        let totalWeight = 0;

        Object.keys(weights).forEach(key => {
            if (sensoryData[key] !== undefined) {
                totalScore += sensoryData[key] * weights[key];
                totalWeight += weights[key];
            }
        });

        return totalWeight > 0 ? totalScore / totalWeight : 0;
    }

    createVisualizationMarker(gridKey, sensoryData, personalizedScore, hasWheelchairIssue, intensity) {
        const bounds = this.getGridBounds(gridKey);
        const center = bounds.getCenter();

        let marker;
        
        switch (this.currentMode) {
            case 'intensity':
                marker = this.createIntensityMarker(center, sensoryData, intensity);
                break;
            case 'gradient':
                marker = this.createGradientMarker(center, personalizedScore, intensity);
                break;
            default: // comfort
                marker = this.createComfortMarker(center, personalizedScore, hasWheelchairIssue, intensity);
        }

        if (marker) {
            marker.on('click', () => {
                this.showLocationPopup(center, gridKey, this.gridData.get(gridKey));
            });
            this.sensoryLayers.addLayer(marker);
        }
    }

    createComfortMarker(center, score, hasWheelchairIssue, intensity) {
        // Color based on comfort score (inverted - lower score = better = green)
        const normalizedScore = Math.max(0, Math.min(10, score));
        const hue = (10 - normalizedScore) * 12; // 0 (red) to 120 (green)
        const color = `hsl(${hue}, 70%, 50%)`;
        
        const size = 15 + (normalizedScore * 2) * intensity;
        
        const icon = L.divIcon({
            className: 'sensory-marker',
            html: `
                <div style="
                    width: ${size}px; 
                    height: ${size}px; 
                    background: ${color}; 
                    border-radius: 50%; 
                    border: 2px solid white; 
                    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    font-size: ${Math.max(8, size * 0.4)}px;
                    font-weight: bold;
                ">
                    ${hasWheelchairIssue ? '♿' : Math.round(score)}
                </div>
            `,
            iconSize: [size, size],
            iconAnchor: [size/2, size/2]
        });

        return L.marker(center, { icon });
    }

    createIntensityMarker(center, sensoryData, intensity) {
        const maxValue = Math.max(sensoryData.noise, sensoryData.light, sensoryData.odor, sensoryData.crowd);
        const colors = {
            noise: '#ff4757',
            light: '#ffa502',
            odor: '#2ed573',
            crowd: '#1e90ff'
        };
        
        const dominantSense = Object.keys(sensoryData).reduce((a, b) => 
            sensoryData[a] > sensoryData[b] ? a : b
        );
        
        const size = 12 + (maxValue * 2) * intensity;
        const color = colors[dominantSense];
        
        const icon = L.divIcon({
            className: 'sensory-marker',
            html: `
                <div style="
                    width: ${size}px; 
                    height: ${size}px; 
                    background: ${color}; 
                    border-radius: 50%; 
                    border: 2px solid white; 
                    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                    opacity: ${0.6 + (maxValue / 10) * 0.4};
                "></div>
            `,
            iconSize: [size, size],
            iconAnchor: [size/2, size/2]
        });

        return L.marker(center, { icon });
    }

    createGradientMarker(center, score, intensity) {
        const size = 20 + (score * 1.5) * intensity;
        const normalizedScore = Math.max(0, Math.min(10, score));
        
        // Create gradient from comfortable (blue) to uncomfortable (red)
        const startColor = `hsl(${240 - (normalizedScore * 24)}, 70%, 60%)`;
        const endColor = `hsl(${240 - (normalizedScore * 24)}, 70%, 30%)`;
        
        const icon = L.divIcon({
            className: 'gradient-marker',
            html: `
                <div style="
                    width: ${size}px; 
                    height: ${size}px; 
                    background: radial-gradient(circle, ${startColor}, ${endColor});
                    border-radius: 50%; 
                    border: 2px solid white; 
                    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                    opacity: ${0.7 * intensity};
                "></div>
            `,
            iconSize: [size, size],
            iconAnchor: [size/2, size/2]
        });

        return L.marker(center, { icon });
    }

    cleanupExpiredData() {
        const currentTime = Date.now();
        let hasChanges = false;

        this.gridData.forEach((cellData, gridKey) => {
            const validReports = cellData.reports.filter(report => {
                const timeDecay = this.calculateTimeDecay(report.timestamp, report.type, currentTime);
                return timeDecay > 0;
            });

            if (validReports.length !== cellData.reports.length) {
                hasChanges = true;
                if (validReports.length === 0) {
                    this.gridData.delete(gridKey);
                } else {
                    cellData.reports = validReports;
                }
            }
        });

        if (hasChanges) {
            this.saveGridData();
            this.refreshVisualization();
        }
    }

    getGridKey(latlng) {
        const projected = L.CRS.EPSG3857.project(latlng);
        const x = Math.floor(projected.x / this.GRID_CELL_SIZE);
        const y = Math.floor(projected.y / this.GRID_CELL_SIZE);
        return `${x},${y}`;
    }

    getGridBounds(gridKey) {
        const [x, y] = gridKey.split(',').map(Number);
        const p1 = L.point(x * this.GRID_CELL_SIZE, y * this.GRID_CELL_SIZE);
        const p2 = L.point((x + 1) * this.GRID_CELL_SIZE, (y + 1) * this.GRID_CELL_SIZE);
        return L.latLngBounds(
            L.CRS.EPSG3857.unproject(p1),
            L.CRS.EPSG3857.unproject(p2)
        );
    }

    getSensitivityProfile() {
        const saved = JSON.parse(localStorage.getItem('sensoryProfile') || '{}');
        return {
            noiseThreshold: saved.noiseThreshold || 5,
            lightThreshold: saved.lightThreshold || 5,
            odorThreshold: saved.odorThreshold || 5,
            crowdThreshold: saved.crowdThreshold || 5
        };
    }

    saveSensitivityProfile(profile) {
        localStorage.setItem('sensoryProfile', JSON.stringify(profile));
    }

    saveGridData() {
        const dataToSave = Array.from(this.gridData.entries());
        localStorage.setItem('gridData', JSON.stringify(dataToSave));
    }

    loadSavedData() {
        try {
            // Load grid data
            const savedGridData = localStorage.getItem('gridData');
            if (savedGridData) {
                const data = JSON.parse(savedGridData);
                this.gridData = new Map(data);
            }

            // Load and apply profile
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
        } catch (error) {
            console.error('Error loading saved data:', error);
        }
    }

    setupGeolocation() {
        if ('geolocation' in navigator) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const { latitude, longitude } = position.coords;
                    this.map.setView([latitude, longitude], 16);
                    this.showToast('현재 위치로 이동했습니다', 'success');
                },
                (error) => {
                    console.error('Geolocation error:', error);
                    this.showToast('위치 정보를 가져올 수 없습니다', 'error');
                }
            );
        }
    }

    getTimeAgo(timestamp) {
        const now = Date.now();
        const diff = now - timestamp;
        const minutes = Math.floor(diff / (1000 * 60));
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));

        if (days > 0) return `${days}일 전`;
        if (hours > 0) return `${hours}시간 전`;
        if (minutes > 0) return `${minutes}분 전`;
        return '방금 전';
    }

    showToast(message, type = 'info') {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.className = `toast show ${type}`;
        
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }
}

// Initialize the application
window.sensmapApp = new SensmapApp();