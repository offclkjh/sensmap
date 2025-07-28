// Enhanced Sensmap Application
class SensmapApp {
    constructor() {
        this.map = L.map('map').setView([37.5665, 126.9780], 14);
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

    // Sets up the base tile layer for the map. Adds a search box control to enable location searching
    // 지도 기본 타일 레이어를 설정합니다. 위치 검색 기능이 있는 검색 상자 컨트롤을 추가합니다
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

    // Binds UI buttons and sliders to their event handlers for user interaction
    // 사용자 인터페이스 버튼과 슬라이더에 이벤트 핸들러를 연결합니다
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
    
    // Handles map clicks based on mode: selects route points if in route mode, otherwise sets clicked location and shows sensory data popup.
    // 현재 모드에 따라 지도 클릭을 처리합니다: 경로 모드일 때는 경로 지점을 선택하고, 그렇지 않으면 클릭한 위치를 설정하고 감각 정보 팝업을 표시합니다.
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

    // Handles user clicks in route mode to set start and end points for routing.
    // 사용자가 경로 모드에서 클릭한 위치를 시작점과 끝점으로 설정합니다.
    handleRouteClick(latlng) {
        if (!this.routePoints.start) {
            this.setRoutePoint('start', latlng);
        } else if (!this.routePoints.end) {
            this.setRoutePoint('end', latlng);
            this.calculateRoute();
        }
    }

    // Sets the start or end point for route planning based on user click input.
    // 사용자 클릭에 따라 경로 계획의 시작점 또는 끝점을 설정합니다.
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

    // Calculates the walking route between the selected start and end points using a routing API.
    // 선택된 출발지와 도착지 사이의 도보 경로를 계산합니다. 경로가 계산되면 지도에 표시하고, 이전 경로는 제거합니다.
    async calculateRoute() {
        if (!this.routePoints.start || !this.routePoints.end) return;

        try {
            this.showToast('최적 경로를 계산하고 있습니다...', 'info');
            
            // Simple route calculation using OSRM
            const start = this.routePoints.start;
            const end = this.routePoints.end;
            
            const url = `https://router.project-osrm.org/route/v1/walking/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson&alternatives=true`;
            
            const response = await fetch(url);
            const data = await response.json();
            
            if (data.routes && data.routes.length > 0) {
                const bestRoute = this.selectBestRoute(data.routes);
                this.displayRoute(bestRoute);
                document.getElementById('routeStatus').textContent = '경로 생성 완료';
                this.showToast('쾌적한 경로를 찾았습니다!', 'success');
            } else {
                throw new Error('경로를 찾을 수 없습니다');
            }
        } catch (error) {
            console.error('Route calculation error:', error);
            this.showToast('경로 계산 중 오류가 발생했습니다', 'error');
            document.getElementById('routeStatus').textContent = '경로 계산 실패';
        }
    }

    // Among multiple possible routes, selects the one with the lowest sensory intensity    
    // 여러 개의 경로 중 감각 자극이 가장 낮은 경로를 선택합니다. 감각 데이터를 기반으로 경로의 쾌적도를 평가합니다.
    selectBestRoute(routes) {
        const profile = this.getSensitivityProfile();
        let bestRoute = routes[0];
        let bestScore = Infinity;

        routes.forEach(route => {
            const sensoryScore = this.calculateRouteSensoryScore(route.geometry, profile);
            const distance = route.distance;
            
            // Weighted score: 30% distance, 70% comfort
            const totalScore = (distance * 0.0003) + (sensoryScore * 0.7);
            
            if (totalScore < bestScore) {
                bestScore = totalScore;
                bestRoute = route;
            }
        });

        return bestRoute;
    }

    // Calculates the total sensory score for a given route by summing up the intensity of grid cells along the path.
    // 주어진 경로를 따라 지나가는 격자 셀의 감각 자극 강도를 합산하여 전체 감각 점수를 계산합니다. 점수가 낮을수록 더 쾌적한 경로로 간주됩니다.
    calculateRouteSensoryScore(geometry, profile) {
        let totalScore = 0;
        let segmentCount = 0;

        const coordinates = geometry.coordinates;
        for (let i = 0; i < coordinates.length - 1; i++) {
            const point = L.latLng(coordinates[i][1], coordinates[i][0]);
            const gridKey = this.getGridKey(point);
            const cellData = this.gridData.get(gridKey);

            let segmentScore = 2.5; // Neutral score for unknown areas

            if (cellData && cellData.reports && cellData.reports.length > 0) {
                const currentTime = Date.now();
                let weightedScore = 0;
                let totalWeight = 0;

                cellData.reports.forEach(report => {
                    const timeDecay = this.calculateTimeDecay(report.timestamp, report.type, currentTime);
                    if (timeDecay > 0.1) { // Only consider non-expired data
                        const weight = timeDecay;
                        const reportScore = this.calculatePersonalizedScore(report, profile);
                        weightedScore += reportScore * weight;
                        totalWeight += weight;
                    }
                });

                if (totalWeight > 0) {
                    segmentScore = weightedScore / totalWeight;
                }
            }

            totalScore += segmentScore;
            segmentCount++;
        }

        return segmentCount > 0 ? totalScore / segmentCount : 2.5;
    }

    // Displays the selected route on the map using a polyline.
    // 선택된 경로를 지도에 폴리라인으로 표시합니다. 이전에 표시된 경로가 있다면 제거한 후 새 경로를 시각화합니다.
    displayRoute(route) {
        if (this.currentRoute) {
            this.map.removeLayer(this.currentRoute);
        }

        const routeStyle = {
            color: '#1a73e8',
            weight: 6,
            opacity: 0.8,
            lineJoin: 'round',
            lineCap: 'round'
        };

        this.currentRoute = L.geoJSON(route.geometry, {
            style: routeStyle
        }).addTo(this.map);

        const distanceInKm = route.distance / 1000;
        const estimatedDuration = Math.round((distanceInKm / 4.8) * 60); // 4.8 km/h is the average walking speed

        this.currentRoute.bindPopup(`
                <div class="popup-header">
                    <div class="popup-title">최적 경로</div>
                    <div class="popup-subtitle">감각 친화적 경로</div>
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

        // Fit map to route
        this.map.fitBounds(this.currentRoute.getBounds(), { padding: [50, 50] });
    }

    // Displays a popup on the map at the clicked location showing sensory data for that grid cell.
    // 클릭한 위치의 격자 셀에 대한 감각 데이터를 팝업으로 지도에 표시합니다. 사용자가 정보를 확인하고 입력할 수 있도록 합니다.
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

    // Opens the sensory input panel for users to submit or edit sensory data.
    // 사용자가 감각 데이터를 입력하거나 수정할 수 있도록 감각 정보 입력 패널을 엽니다.
    openSensoryPanel() {
        this.closePanels();
        document.getElementById('sidePanel').classList.add('open');
    }

    // Opens the user profile panel by first closing any open panels, then adding the 'open' class to the profile panel to make it visible.
    // 사용자 프로필 패널을 열기 위해, 먼저 다른 패널들을 닫고 'profilePanel' 요소에 'open' 클래스를 추가하여 보이도록 만듭니다.
    openProfilePanel() {
        this.closePanels();
        document.getElementById('profilePanel').classList.add('open');
    }

    // Closes all side panels by removing the 'open' class from each panel element.
    // 모든 사이드 패널에서 'open' 클래스를 제거하여 패널을 닫습니다.
    closePanels() {
        document.querySelectorAll('.side-panel').forEach(panel => {
            panel.classList.remove('open');
        });
    }

    // Toggles the display of sensory data on the map. If data is currently shown, it hides it; if hidden, it shows it again.
    // 지도에서 감각 데이터를 표시하거나 숨기는 기능입니다. 현재 데이터가 보이면 숨기고 숨겨져 있으면 다시 표시합니다.
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

    // Toggle route mode on/off; show/hide controls and update UI accordingly.
    // 경로 모드를 켜거나 끄고, 관련 UI와 컨트롤을 보여주거나 숨깁니다.
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

    // Cancel route mode, reset UI and clear all route markers and lines.
    // 경로 모드를 취소하고 UI를 초기화하며, 모든 경로 마커와 선을 제거합니다.
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

    // Set the current visualization mode, update button states, and refresh the map display.
    // 현재 시각화 모드를 설정하고 버튼 상태를 업데이트한 뒤 지도를 다시 그립니다.
    setVisualizationMode(mode) {
        this.currentMode = mode;
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
        this.refreshVisualization();
    }

    // Handle submission of sensory data form, gather input values, and prepare report data.
    // 감각 정보 폼 제출을 처리하고 입력값을 수집하여 보고서 데이터를 준비합니다.
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

    // Handle profile form submission, save updated sensitivity thresholds, and refresh visualization.
    // 프로필 폼 제출을 처리하고, 감각 임계값을 저장한 후 시각화를 갱신합니다.
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

    // Add new sensory report data to the grid cell corresponding to the given location.
    // 위치에 해당하는 그리드 셀에 새로운 감각 보고 데이터를 추가합니다.
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

    // Delete a specific sensory report from a grid cell after user confirmation.
    // 사용자 확인 후 특정 그리드 셀에서 감각 보고를 삭제합니다.
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

    // Refreshes the sensory data visualization on the map.
    // 지도 위에 감각 데이터 시각화를 갱신합니다.
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

    // Calculates the decay factor for a report's timestamp to reduce its influence over time.
    // 시간이 지남에 따라 보고서의 영향력을 줄이기 위한 감소 계수를 계산합니다.
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

    // Calculates a personalized comfort score by weighting sensory data according to the user's profile thresholds.
    // 사용자의 프로필 임계값에 따라 감각 데이터를 가중하여 개인화된 쾌적 점수를 계산합니다.
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

    // Creates and adds a visualization marker on the map based on the current mode and sensory data.
    // 현재 모드와 감각 데이터를 기반으로 지도에 시각화 마커를 생성하고 추가합니다.
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

    // Creates a comfort-mode marker representing sensory comfort level on the map.
    // 감각 편안함 수준을 지도에 나타내는 마커를 생성합니다.
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

    // Creates a marker visualizing the most intense sensory input at a location.
    // 감각 자극 중 가장 강한 요소를 시각화하는 마커를 생성합니다.
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

    // Create a gradient marker based on discomfort score and intensity.
    // 불편 점수와 강도(intensity)에 따라 그라디언트 마커를 생성합니다.
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

    // Cleans up old sensory data by removing reports that have fully decayed over time.
    // 시간이 지나 영향력이 사라진 감각 데이터를 삭제하여 데이터를 정리합니다.
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

    // Converts latitude and longitude to a unique grid key based on map projection and cell size.
    // 위도와 경도를 지도 투영 및 셀 크기를 기준으로 고유한 그리드 키로 변환합니다.
    getGridKey(latlng) {
        const projected = L.CRS.EPSG3857.project(latlng);
        const x = Math.floor(projected.x / this.GRID_CELL_SIZE);
        const y = Math.floor(projected.y / this.GRID_CELL_SIZE);
        return `${x},${y}`;
    }

    // Returns the geographical bounds of a grid cell based on its key.
    // 그리드 키를 기준으로 해당 셀의 지리적 경계 범위를 반환합니다.
    getGridBounds(gridKey) {
        const [x, y] = gridKey.split(',').map(Number);
        const p1 = L.point(x * this.GRID_CELL_SIZE, y * this.GRID_CELL_SIZE);
        const p2 = L.point((x + 1) * this.GRID_CELL_SIZE, (y + 1) * this.GRID_CELL_SIZE);
        return L.latLngBounds(
            L.CRS.EPSG3857.unproject(p1),
            L.CRS.EPSG3857.unproject(p2)
        );
    }

    // Retrieves the user's saved sensory sensitivity profile from local storage.
    // 로컬 스토리지에서 사용자의 감각 민감도 프로필을 불러옵니다.
    getSensitivityProfile() {
        const saved = JSON.parse(localStorage.getItem('sensoryProfile') || '{}');
        return {
            noiseThreshold: saved.noiseThreshold || 5,
            lightThreshold: saved.lightThreshold || 5,
            odorThreshold: saved.odorThreshold || 5,
            crowdThreshold: saved.crowdThreshold || 5
        };
    }

    // Saves the user's sensory sensitivity profile to local storage.
    // 사용자의 감각 민감도 프로필을 로컬 스토리지에 저장합니다.
    saveSensitivityProfile(profile) {
        localStorage.setItem('sensoryProfile', JSON.stringify(profile));
    }

    // Saves the current grid sensory data to local storage for persistence.
    // 현재 그리드 감각 데이터를 로컬 스토리지에 저장하여 데이터를 유지합니다.
    saveGridData() {
        const dataToSave = Array.from(this.gridData.entries());
        localStorage.setItem('gridData', JSON.stringify(dataToSave));
    }

    // Loads saved grid data and user sensory profile from local storage, then updates the UI and visualization accordingly.
    // 저장된 그리드 데이터와 사용자 감각 프로필을 로컬 스토리지에서 불러와 UI와 시각화를 업데이트합니다.
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

    // Attempts to get the user's current location and center the map there, showing a success or error message accordingly.
    // 사용자의 현재 위치를 받아 지도 중심을 이동시키고, 성공 또는 오류 메시지를 표시합니다.
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

    // Converts a timestamp to a human-readable relative time string like "___ hours ago" in Korean.
    // 타임스탬프를 받아 "몇 시간 전"과 같은 사람이 읽기 쉬운 상대 시간 문자열로 변환합니다.
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

    // Displays a temporary toast message on the screen with a specific style based on the type.
    // 화면에 특정 타입에 따라 스타일이 적용된 임시 토스트 메시지를 표시합니다.
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
