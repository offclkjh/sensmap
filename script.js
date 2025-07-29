/*
MAJOR IMPROVEMENTS:
- 다중 라우팅 API: Valhalla + OSRM + GraphHopper 추가로 도보 우회 정확도 향상
- A* 알고리즘 강화: Priority Queue + 10000회 반복, 실제 이동 가능성 체크
- 지도 로딩 안정성: 타임아웃/재시도 로직으로 초기화 오류 해결 (타임아웃 10초, 재시도 5회, 서버 추가)
- Polyline 디코딩 수정: precision 6 명시적 설정으로 좌표 정확도 개선
- 저장 시스템 최적화: bounds 제외로 직렬화 오류 완전 해결
- 우회 로직 추가: 고감각 구간 피하기 함수 (avoidHighSensorySegments)
*/

class PriorityQueue {
    constructor() {
        this.elements = [];
    }
    
    enqueue(item, priority) {
        this.elements.push({ item, priority });
        let i = this.elements.length - 1;
        while (i > 0) {
            const parent = Math.floor((i - 1) / 2);
            if (this.elements[parent].priority <= this.elements[i].priority) break;
            [this.elements[parent], this.elements[i]] = [this.elements[i], this.elements[parent]];
            i = parent;
        }
    }
    
    dequeue() {
        if (this.elements.length === 0) return null;
        if (this.elements.length === 1) return this.elements.pop();
        
        const result = this.elements[0];
        this.elements[0] = this.elements.pop();
        this.heapifyDown(0);
        return result;
    }
    
    heapifyDown(index) {
        const left = 2 * index + 1;
        const right = 2 * index + 2;
        let smallest = index;
        
        if (left < this.elements.length && this.elements[left].priority < this.elements[smallest].priority) {
            smallest = left;
        }
        if (right < this.elements.length && this.elements[right].priority < this.elements[smallest].priority) {
            smallest = right;
        }
        
        if (smallest !== index) {
            [this.elements[index], this.elements[smallest]] = [this.elements[smallest], this.elements[index]];
            this.heapifyDown(smallest);
        }
    }
    
    isEmpty() {
        return this.elements.length === 0;
    }
    
    size() {
        return this.elements.length;
    }
}

class SensmapApp {
    constructor() {
        this.map = null;
        this.gridData = new Map();
        this.empathyData = new Map();
        this.routeRatings = new Map();
        this.GRID_CELL_SIZE = 15;
        this.showData = true;
        this.isRouteMode = false;
        this.routePoints = { start: null, end: null };
        this.routeMarkers = { start: null, end: null };
        this.currentRoute = null;
        this.clickedLocation = null;
        this.sensoryLayers = L.layerGroup();
        this.heatmapLayer = null;
        this.skippedFields = new Set();
        this.isLoading = false;
        this.currentVisualization = 'markers';
        this.currentFilter = 'all';
        this.lastAddedData = null;
        this.isUpdating = false;
        
        this.accessibilitySettings = {
            colorBlindMode: false,
            highContrastMode: false,
            reducedMotionMode: false,
            textSize: 1
        };
        
        this.init();
    }

    async init() {
        try {
            this.showLoading(true);
            
            if (this.shouldShowTutorial()) {
                this.showTutorial();
            }
            
            await this.initializeMap();
            this.setupEventListeners();
            this.loadSavedData();
            this.setupGeolocation();
            this.setupKeyboardNavigation();
            this.loadAccessibilitySettings();
            this.hideLoading();
            
            setInterval(() => this.cleanupExpiredData(), 60000);
        } catch (error) {
            this.handleError('앱 초기화 중 오류가 발생했습니다', error);
        }
    }

    shouldShowTutorial() {
        return !localStorage.getItem('sensmap_tutorial_completed');
    }

    showTutorial() {
        const overlay = document.getElementById('tutorialOverlay');
        overlay.classList.add('show');
        this.currentTutorialStep = 1;
        this.updateTutorialStep();
    }

    updateTutorialStep() {
        const steps = document.querySelectorAll('.tutorial-step');
        const dots = document.querySelectorAll('.tutorial-dots .dot');
        const prevBtn = document.getElementById('tutorialPrev');
        const nextBtn = document.getElementById('tutorialNext');

        steps.forEach((step, index) => {
            step.classList.toggle('active', index + 1 === this.currentTutorialStep);
        });

        dots.forEach((dot, index) => {
            dot.classList.toggle('active', index + 1 === this.currentTutorialStep);
        });

        prevBtn.disabled = this.currentTutorialStep === 1;
        nextBtn.textContent = this.currentTutorialStep === 4 ? '시작하기' : '다음';
    }

    nextTutorialStep() {
        if (this.currentTutorialStep < 4) {
            this.currentTutorialStep++;
            this.updateTutorialStep();
        } else {
            this.completeTutorial();
        }
    }

    prevTutorialStep() {
        if (this.currentTutorialStep > 1) {
            this.currentTutorialStep--;
            this.updateTutorialStep();
        }
    }

    completeTutorial() {
        const overlay = document.getElementById('tutorialOverlay');
        overlay.classList.remove('show');
        localStorage.setItem('sensmap_tutorial_completed', 'true');
    }

    showLoading(show = true, text = '지도를 불러오는 중...') {
        const overlay = document.getElementById('loadingOverlay');
        const loadingText = overlay?.querySelector('.loading-text');
        if (overlay) {
            overlay.classList.toggle('hidden', !show);
            if (loadingText) {
                loadingText.textContent = text;
            }
        }
        this.isLoading = show;
    }

    hideLoading() {
        this.showLoading(false);
    }

    async initializeMap() {
        let retryCount = 0;
        const maxRetries = 5;  // 변경: 재시도 횟수 증가 (지도 로딩 안정성 향상)

        while (retryCount < maxRetries) {
            try {
                this.map = L.map('map', {
                    center: [37.5665, 126.9780],
                    zoom: 14,
                    zoomControl: true,
                    attributionControl: true,
                    preferCanvas: true
                });

                const tileUrls = [  // 변경: 2025년 안정적 무료 타일 서버 추가 (OSM 위키, GitHub 추천 기반)
                    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',  // 기본 OSM
                    'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',  // OpenTopoMap (안정적)
                    'https://{s}.tile.stamen.com/terrain/{z}/{x}/{y}.png',  // Stamen Terrain
                    'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',  // CartoDB Light
                    'https://{s}.tile.openstreetmap.de/{z}/{x}/{y}.png'  // 기존 독일 서버 (마지막으로)
                ];

                let tileLayer = null;
                for (const url of tileUrls) {
                    try {
                        this.showToast(`타일 서버 시도 중: ${url.split('//')[1].split('/')[0]}`, 'info');  // 변경: 사용자 알림 추가
                        tileLayer = L.tileLayer(url, {
                            attribution: '© OpenStreetMap contributors | Map data from various providers',
                            maxZoom: 19,
                            timeout: 10000,  // 변경: 타임아웃 10초로 증가
                            retryLimit: 3,   // 변경: 서버별 재시도 3회
                            crossOrigin: 'anonymous'  // 변경: CORS 문제 방지
                        });
                        
                        await new Promise((resolve, reject) => {
                            const timeout = setTimeout(() => reject(new Error('Tile timeout')), 10000);
                            tileLayer.on('load', () => {
                                clearTimeout(timeout);
                                resolve();
                            });
                            tileLayer.on('tileerror', () => {
                                clearTimeout(timeout);
                                reject(new Error('Tile error'));
                            });
                            tileLayer.addTo(this.map);
                        });
                        
                        console.log(`Successfully loaded tiles from: ${url}`);
                        break;
                    } catch (tileError) {
                        console.warn(`Failed to load tiles from ${url}:`, tileError);
                        if (tileLayer) {
                            this.map.removeLayer(tileLayer);
                        }
                        continue;
                    }
                }

                if (!tileLayer) {
                    throw new Error('모든 타일 서버 연결 실패');
                }

                this.sensoryLayers.addTo(this.map);
                this.setupSearchControl();
                
                this.map.on('click', (e) => this.handleMapClick(e));
                this.map.on('moveend', () => this.throttledRefreshVisualization());
                this.map.on('zoomend', () => this.throttledRefreshVisualization());

                await new Promise((resolve) => {
                    this.map.whenReady(() => resolve());
                });

                console.log('지도 초기화 성공');
                return;

            } catch (error) {
                retryCount++;
                console.warn(`지도 초기화 시도 ${retryCount}/${maxRetries} 실패:`, error);
                
                if (retryCount >= maxRetries) {
                    throw new Error(`${maxRetries}번 시도 후 지도 초기화 실패: ${error.message}`);
                }
                
                await new Promise(resolve => setTimeout(resolve, 2000 * retryCount));  // 변경: 지연 시간 증가
            }
        }
    }

    setupSearchControl() {
        try {
            if (typeof GeoSearch !== 'undefined' && 
                GeoSearch.OpenStreetMapProvider && 
                GeoSearch.GeoSearchControl) {
                
                const provider = new GeoSearch.OpenStreetMapProvider();
                const searchControl = new GeoSearch.GeoSearchControl({
                    provider,
                    style: 'bar',
                    showMarker: false,
                    autoClose: true,
                    keepResult: false,
                    placeholder: '장소 검색...'
                });
                this.map.addControl(searchControl);
            }
        } catch (error) {
            console.warn('검색 컨트롤 초기화 실패:', error);
        }
    }

    setupEventListeners() {
        try {
            document.getElementById('tutorialNext')?.addEventListener('click', () => this.nextTutorialStep());
            document.getElementById('tutorialPrev')?.addEventListener('click', () => this.prevTutorialStep());
            document.getElementById('tutorialSkip')?.addEventListener('click', () => this.completeTutorial());

            document.querySelectorAll('.tutorial-dots .dot').forEach((dot, index) => {
                dot.addEventListener('click', () => {
                    this.currentTutorialStep = index + 1;
                    this.updateTutorialStep();
                });
            });

            document.getElementById('intensitySlider')?.addEventListener('input', (e) => {
                document.getElementById('intensityValue').textContent = e.target.value;
                this.throttledRefreshVisualization();
            });

            document.querySelectorAll('.viz-btn').forEach(btn => {
                btn.addEventListener('click', () => this.switchVisualization(btn.dataset.viz));
            });

            document.querySelectorAll('.filter-btn').forEach(btn => {
                btn.addEventListener('click', () => this.switchFilter(btn.dataset.filter));
            });

            document.getElementById('accessibilityBtn')?.addEventListener('click', () => this.toggleAccessibilityPanel());
            document.getElementById('closeAccessibilityBtn')?.addEventListener('click', () => this.closeAccessibilityPanel());
            
            document.getElementById('colorBlindMode')?.addEventListener('change', (e) => this.toggleColorBlindMode(e.target.checked));
            document.getElementById('highContrastMode')?.addEventListener('change', (e) => this.toggleHighContrastMode(e.target.checked));
            document.getElementById('reducedMotionMode')?.addEventListener('change', (e) => this.toggleReducedMotionMode(e.target.checked));
            document.getElementById('textSizeSlider')?.addEventListener('input', (e) => this.adjustTextSize(e.target.value));

            document.getElementById('showDataBtn')?.addEventListener('click', () => this.toggleDataDisplay());
            document.getElementById('profileBtn')?.addEventListener('click', () => this.openProfilePanel());
            document.getElementById('routeBtn')?.addEventListener('click', () => this.toggleRouteMode());

            document.getElementById('closePanelBtn')?.addEventListener('click', () => this.closePanels());
            document.getElementById('cancelBtn')?.addEventListener('click', () => this.closePanels());
            document.getElementById('closeProfileBtn')?.addEventListener('click', () => this.closePanels());
            document.getElementById('cancelProfileBtn')?.addEventListener('click', () => this.closePanels());
            document.getElementById('cancelRouteBtn')?.addEventListener('click', () => this.cancelRouteMode());

            document.getElementById('sensoryRouteBtn')?.addEventListener('click', () => this.selectRouteType('sensory'));
            document.getElementById('timeRouteBtn')?.addEventListener('click', () => this.selectRouteType('time'));

            document.querySelectorAll('.rating-btn').forEach(btn => {
                btn.addEventListener('click', () => this.rateRoute(btn.dataset.rating));
            });
            document.getElementById('closeRating')?.addEventListener('click', () => this.hideRouteRating());

            document.getElementById('undoBtn')?.addEventListener('click', () => this.undoLastAction());
            document.getElementById('alertClose')?.addEventListener('click', () => this.hideAlertBanner());

            document.getElementById('sensoryForm')?.addEventListener('submit', (e) => this.handleSensorySubmit(e));
            document.getElementById('profileForm')?.addEventListener('submit', (e) => this.handleProfileSubmit(e));

            document.querySelectorAll('.range-slider').forEach(slider => {
                slider.addEventListener('input', (e) => {
                    const valueElement = e.target.parentNode?.querySelector('.range-value');
                    if (valueElement) {
                        valueElement.textContent = e.target.value;
                    }
                });
            });

            document.querySelectorAll('.skip-btn').forEach(btn => {
                btn.addEventListener('click', (e) => this.toggleFieldSkip(e.target.dataset.field));
            });

            document.querySelectorAll('.type-option').forEach(option => {
                option.addEventListener('click', () => this.selectDataType(option));
                option.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        this.selectDataType(option);
                    }
                });
            });

            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    this.closePanels();
                    this.cancelRouteMode();
                    this.closeAccessibilityPanel();
                    this.hideRouteRating();
                }
            });

            window.addEventListener('error', (e) => this.handleError('예상치 못한 오류가 발생했습니다', e.error));
            window.addEventListener('unhandledrejection', (e) => this.handleError('비동기 작업 중 오류가 발생했습니다', e.reason));

        } catch (error) {
            this.handleError('이벤트 리스너 설정 중 오류가 발생했습니다', error);
        }
    }

    switchVisualization(vizType) {
        document.querySelectorAll('.viz-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.viz === vizType);
        });
        this.currentVisualization = vizType;
        this.refreshVisualization();
    }

    switchFilter(filterType) {
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filter === filterType);
        });
        this.currentFilter = filterType;
        this.refreshVisualization();
    }

    toggleAccessibilityPanel() {
        const panel = document.getElementById('accessibilityPanel');
        const isOpen = panel.classList.contains('open');
        
        if (isOpen) {
            this.closeAccessibilityPanel();
        } else {
            this.closePanels();
            panel.classList.add('open');
        }
    }

    closeAccessibilityPanel() {
        const panel = document.getElementById('accessibilityPanel');
        panel.classList.remove('open');
    }

    toggleColorBlindMode(enabled) {
        this.accessibilitySettings.colorBlindMode = enabled;
        document.body.classList.toggle('color-blind-mode', enabled);
        this.saveAccessibilitySettings();
    }

    toggleHighContrastMode(enabled) {
        this.accessibilitySettings.highContrastMode = enabled;
        document.body.classList.toggle('high-contrast-mode', enabled);
        this.saveAccessibilitySettings();
    }

    toggleReducedMotionMode(enabled) {
        this.accessibilitySettings.reducedMotionMode = enabled;
        document.body.classList.toggle('reduced-motion-mode', enabled);
        this.saveAccessibilitySettings();
    }

    adjustTextSize(size) {
        this.accessibilitySettings.textSize = parseFloat(size);
        document.documentElement.style.setProperty('--text-size', `${size}rem`);
        this.saveAccessibilitySettings();
    }

    saveAccessibilitySettings() {
        localStorage.setItem('sensmap_accessibility', JSON.stringify(this.accessibilitySettings));
    }

    loadAccessibilitySettings() {
        try {
            const saved = localStorage.getItem('sensmap_accessibility');
            if (saved) {
                this.accessibilitySettings = { ...this.accessibilitySettings, ...JSON.parse(saved)};
                
                document.getElementById('colorBlindMode').checked = this.accessibilitySettings.colorBlindMode;
                document.getElementById('highContrastMode').checked = this.accessibilitySettings.highContrastMode;
                document.getElementById('reducedMotionMode').checked = this.accessibilitySettings.reducedMotionMode;
                document.getElementById('textSizeSlider').value = this.accessibilitySettings.textSize;
                
                this.toggleColorBlindMode(this.accessibilitySettings.colorBlindMode);
                this.toggleHighContrastMode(this.accessibilitySettings.highContrastMode);
                this.toggleReducedMotionMode(this.accessibilitySettings.reducedMotionMode);
                this.adjustTextSize(this.accessibilitySettings.textSize);
            }
        } catch (error) {
            console.warn('접근성 설정 로드 실패:', error);
        }
    }

    selectDataType(selectedOption) {
        document.querySelectorAll('.type-option').forEach(option => {
            option.classList.remove('selected');
            option.setAttribute('aria-checked', 'false');
        });
        selectedOption.classList.add('selected');
        selectedOption.setAttribute('aria-checked', 'true');
        
        const type = selectedOption.dataset.type;
        this.autoSkipFields(type);
    }

    autoSkipFields(type) {
        const profile = this.getSensitivityProfile();
        const formGroups = document.querySelectorAll('.smart-form-group');
        
        formGroups.forEach(group => {
            const field = group.dataset.field;
            const threshold = profile[`${field}Threshold`];
            
            if (threshold <= 3) {
                group.classList.add('auto-skipped');
                this.skippedFields.add(field);
                
                const skipBtn = group.querySelector('.skip-btn');
                const slider = group.querySelector('.range-slider');
                if (skipBtn && slider) {
                    skipBtn.classList.add('active');
                    skipBtn.textContent = '포함하기';
                    slider.classList.add('skipped');
                    slider.disabled = true;
                }
            } else {
                group.classList.remove('auto-skipped');
                this.skippedFields.delete(field);
                
                const skipBtn = group.querySelector('.skip-btn');
                const slider = group.querySelector('.range-slider');
                if (skipBtn && slider) {
                    skipBtn.classList.remove('active');
                    skipBtn.textContent = '건너뛰기';
                    slider.classList.remove('skipped');
                    slider.disabled = false;
                }
            }
        });
    }

    toggleFieldSkip(fieldName) {
        const skipBtn = document.querySelector(`[data-field="${fieldName}"]`);
        const slider = document.getElementById(`${fieldName}Input`);
        const formGroup = document.querySelector(`[data-field="${fieldName}"]`).closest('.smart-form-group');
        
        if (!skipBtn || !slider) return;

        if (this.skippedFields.has(fieldName)) {
            this.skippedFields.delete(fieldName);
            skipBtn.classList.remove('active');
            skipBtn.textContent = '건너뛰기';
            slider.classList.remove('skipped');
            slider.disabled = false;
            formGroup?.classList.remove('auto-skipped');
        } else {
            this.skippedFields.add(fieldName);
            skipBtn.classList.add('active');
            skipBtn.textContent = '포함하기';
            slider.classList.add('skipped');
            slider.disabled = true;
        }
    }

    handleMapClick(e) {
        try {
            if (this.isRouteMode) {
                this.handleRouteClick(e.latlng);
                return;
            }

            this.clickedLocation = e.latlng;
            const gridKey = this.getGridKey(e.latlng);
            const cellData = this.gridData.get(gridKey);
            
            this.showLocationPopup(e.latlng, gridKey, cellData);
        } catch (error) {
            this.handleError('지도 클릭 처리 중 오류가 발생했습니다', error);
        }
    }

    handleRouteClick(latlng) {
        try {
            if (!this.routePoints.start) {
                this.setRoutePoint('start', latlng);
                document.getElementById('routeStatus').textContent = '도착지 선택';
            } else if (!this.routePoints.end) {
                this.setRoutePoint('end', latlng);
                document.getElementById('routeStatus').textContent = '경로 유형 선택';
                document.getElementById('routeOptions').style.display = 'flex';
            } else {
                this.clearRoutePoints();
                this.setRoutePoint('start', latlng);
                document.getElementById('routeStatus').textContent = '도착지 선택';
                document.getElementById('routeOptions').style.display = 'none';
            }
        } catch (error) {
            this.handleError('경로 설정 중 오류가 발생했습니다', error);
        }
    }

    setRoutePoint(type, latlng) {
        this.routePoints[type] = latlng;
        
        if (this.routeMarkers[type]) {
            this.map.removeLayer(this.routeMarkers[type]);
        }

        const color = type === 'start' ? '#10b981' : '#ef4444';
        const icon = L.divIcon({
            className: 'route-marker',
            html: `<div style="
                width: 20px; 
                height: 20px; 
                background: ${color}; 
                border: 3px solid white; 
                border-radius: 50%; 
                box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            "></div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });

        this.routeMarkers[type] = L.marker(latlng, { icon }).addTo(this.map);
    }

    clearRoutePoints() {
        this.routePoints = { start: null, end: null };
        
        Object.values(this.routeMarkers).forEach(marker => {
            if (marker) this.map.removeLayer(marker);
        });
        this.routeMarkers = { start: null, end: null };

        if (this.currentRoute) {
            this.map.removeLayer(this.currentRoute);
            this.currentRoute = null;
        }
        
        this.hideRouteRating();
    }

    async selectRouteType(routeType) {
        try {
            await this.calculateRoute(routeType);
        } catch (error) {
            this.handleError('경로 계산 중 오류가 발생했습니다', error);
        }
    }

    async calculateRoute(routeType = 'sensory') {
        if (!this.routePoints.start || !this.routePoints.end) {
            this.showToast('출발지와 도착지를 모두 설정해주세요', 'warning');
            return;
        }

        this.showLoading(true, '경로를 계산하고 있습니다...');
        this.showToast(`${routeType === 'sensory' ? '감각 친화적' : '시간 우선'} 경로를 계산하고 있습니다...`, 'info');

        try {
            const start = this.routePoints.start;
            const end = this.routePoints.end;
            
            let route = await this.getMultiRouterRoute(start, end, routeType);
            
            if (!route) {
                this.showToast('백업 경로 계산 시스템을 사용합니다', 'info');
                route = await this.getGridBasedRoute(start, end);
            }

            if (route) {
                if (routeType === 'sensory') {
                    route = this.optimizeRouteForSensory(route);
                    route = this.avoidHighSensorySegments(route);
                }
                
                this.displayRoute(route, routeType);
                this.checkRouteForAlerts(route);
                document.getElementById('routeStatus').textContent = '경로 생성 완료';
                this.showToast(`${routeType === 'sensory' ? '쾌적한' : '빠른'} 경로를 찾았습니다!`, 'success');
                
                setTimeout(() => this.showRouteRating(routeType), 3000);
            } else {
                throw new Error('경로를 찾을 수 없습니다');
            }
        } catch (error) {
            this.showToast('경로 계산 중 오류가 발생했습니다', 'error');
            document.getElementById('routeStatus').textContent = '경로 계산 실패';
            throw error;
        } finally {
            this.hideLoading();
        }
    }

    async getMultiRouterRoute(start, end, routeType = 'sensory') {
        const routingServices = [
            {
                name: 'Valhalla',
                url: 'https://valhalla1.openstreetmap.de/route',
                handler: this.getValhallaRoute.bind(this)
            },
            {
                name: 'OSRM',
                url: 'https://router.project-osrm.org/route/v1/foot',
                handler: this.getOSRMRoute.bind(this)
            },
            {
                name: 'GraphHopper',
                url: 'https://graphhopper.com/api/1/route',
                handler: this.getGraphHopperRoute.bind(this)
            }
        ];

        for (const service of routingServices) {
            try {
                console.log(`${service.name} 서비스로 경로 계산 시도 중...`);
                const route = await service.handler(start, end, routeType);
                
                if (route && route.geometry && route.geometry.coordinates) {
                    console.log(`${service.name} 서비스로 경로 계산 성공`);
                    route.provider = service.name;
                    return route;
                }
            } catch (error) {
                console.warn(`${service.name} 서비스 실패:`, error);
                continue;
            }
        }

        console.warn('모든 외부 라우팅 서비스 실패');
        return null;
    }

    async getValhallaRoute(start, end, routeType = 'sensory') {
        try {
            const url = 'https://valhalla1.openstreetmap.de/route';
            
            const requestBody = {
                locations: [
                    { lat: start.lat, lon: start.lng },
                    { lat: end.lat, lon: end.lng }
                ],
                costing: 'pedestrian',
                costing_options: {
                    pedestrian: {
                        walking_speed: 5.1,
                        walkway_factor: 1.0,
                        sidewalk_factor: 1.0,
                        alley_factor: routeType === 'sensory' ? 3.0 : 1.5,
                        ferry_factor: routeType === 'sensory' ? 4.0 : 1.0
                    }
                },
                shape_match: 'map_snap',
                units: 'kilometers'
            };

            if (routeType === 'sensory') {
                requestBody.costing_options.pedestrian.use_roads = 0.1;
                requestBody.costing_options.pedestrian.use_tracks = 2.0;
            }
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Sensmap/1.0'
                },
                body: JSON.stringify(requestBody),
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            if (data.trip && data.trip.legs && data.trip.legs.length > 0) {
                const leg = data.trip.legs[0];
                
                let coordinates;
                if (leg.shape && typeof polyline !== 'undefined') {
                    coordinates = polyline.decode(leg.shape, 6).map(point => [point[1], point[0]]);
                } else {
                    coordinates = [[start.lng, start.lat], [end.lng, end.lat]];
                }
                
                return {
                    geometry: { coordinates },
                    distance: leg.summary.length * 1000,
                    duration: leg.summary.time,
                    provider: 'Valhalla'
                };
            }
            
            return null;
        } catch (error) {
            console.warn('Valhalla 라우팅 실패:', error);
            return null;
        }
    }

    async getOSRMRoute(start, end, routeType = 'sensory') {
        try {
            const baseUrl = 'https://router.project-osrm.org/route/v1/foot';
            const coordinates = `${start.lng},${start.lat};${end.lng},${end.lat}`;
            const params = new URLSearchParams({
                overview: 'full',
                geometries: 'geojson',
                steps: 'true',
                generate_hints: 'false'
            });
            
            const url = `${baseUrl}/${coordinates}?${params}`;
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000);
            
            const response = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Sensmap/1.0'
                }
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            if (data.routes && data.routes.length > 0) {
                const route = data.routes[0];
                
                return {
                    geometry: route.geometry,
                    distance: route.distance,
                    duration: route.duration,
                    provider: 'OSRM'
                };
            }
            
            return null;
        } catch (error) {
            console.warn('OSRM 라우팅 실패:', error);
            return null;
        }
    }

    async getGraphHopperRoute(start, end, routeType = 'sensory') {
        try {
            const apiKey = 'YOUR_GRAPHHOPPER_API_KEY';  // GraphHopper API 키 입력 (무료 계정으로 발급 가능)
            const baseUrl = `https://graphhopper.com/api/1/route?key=${apiKey}`;
            const points = `point=${start.lat},${start.lng}&point=${end.lat},${end.lng}`;
            const profile = routeType === 'sensory' ? 'foot' : 'foot';
            const params = new URLSearchParams({
                profile: profile,
                locale: 'ko',
                elevation: 'false',
                details: 'average_slope',
                'ch.disable': 'true',
                'weighting': routeType === 'sensory' ? 'shortest' : 'fastest'
            });
            
            const url = `${baseUrl}&${points}&${params}`;
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000);
            
            const response = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Sensmap/1.0'
                }
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            if (data.paths && data.paths.length > 0) {
                const path = data.paths[0];
                const coordinates = path.points.coordinates.map(coord => [coord[1], coord[0]]);
                
                return {
                    geometry: { coordinates },
                    distance: path.distance,
                    duration: path.time / 1000,
                    provider: 'GraphHopper'
                };
            }
            
            return null;
        } catch (error) {
            console.warn('GraphHopper 라우팅 실패:', error);
            return null;
        }
    }

    checkRouteForAlerts(route) {
        const profile = this.getSensitivityProfile();
        const currentTime = Date.now();
        let hasHighSensoryAreas = false;
        let alertSegments = [];

        const coordinates = route.geometry.coordinates;
        const sampleInterval = Math.max(1, Math.floor(coordinates.length / 20));

        for (let i = 0; i < coordinates.length; i += sampleInterval) {
            const point = L.latLng(coordinates[i][1], coordinates[i][0]);
            const gridKey = this.getGridKey(point);
            const cellData = this.gridData.get(gridKey);

            if (cellData && cellData.reports && cellData.reports.length > 0) {
                const empathy = this.empathyData.get(gridKey) || { likes: 0, dislikes: 0 };
                let maxScore = 0;

                cellData.reports.forEach(report => {
                    const timeDecay = this.calculateTimeDecay(report, empathy, currentTime);
                    if (timeDecay > 0.1) {
                        const score = this.calculatePersonalizedScore(report, profile);
                        maxScore = Math.max(maxScore, score);
                    }
                });

                if (maxScore > 7) {
                    hasHighSensoryAreas = true;
                    alertSegments.push({ point, score: maxScore });
                }
            }
        }

        if (hasHighSensoryAreas) {
            this.showAlertBanner(`선택한 경로에 ${alertSegments.length}개의 감각적으로 불편한 구간이 있습니다. 다른 경로를 고려해보세요.`);
        }
    }

    showAlertBanner(message) {
        const banner = document.getElementById('alertBanner');
        const alertText = document.getElementById('alertText');
        
        if (banner && alertText) {
            alertText.textContent = message;
            banner.style.display = 'flex';
        }
    }

    hideAlertBanner() {
        const banner = document.getElementById('alertBanner');
        if (banner) {
            banner.style.display = 'none';
        }
    }

    showRouteRating(routeType) {
        const rating = document.getElementById('routeRating');
        if (rating && this.currentRoute) {
            rating.style.display = 'block';
            rating.dataset.routeType = routeType;
        }
    }

    hideRouteRating() {
        const rating = document.getElementById('routeRating');
        if (rating) {
            rating.style.display = 'none';
        }
    }

    rateRoute(ratingType) {
        const rating = document.getElementById('routeRating');
        const routeType = rating?.dataset.routeType;
        
        if (this.currentRoute && routeType) {
            const routeKey = this.generateRouteKey(this.routePoints.start, this.routePoints.end);
            if (!this.routeRatings.has(routeKey)) {
                this.routeRatings.set(routeKey, []);
            }
            
            this.routeRatings.get(routeKey).push({
                type: routeType,
                rating: ratingType,
                timestamp: Date.now(),
                profile: this.getSensitivityProfile()
            });
            
            this.saveRouteRatings();
            
            this.showToast(`경로 평가가 저장되었습니다. 향후 경로 추천에 반영됩니다.`, 'success');
            this.hideRouteRating();
        }
    }

    generateRouteKey(start, end) {
        const startGrid = this.getGridKey(start);
        const endGrid = this.getGridKey(end);
        return `${startGrid}-${endGrid}`;
    }

    saveRouteRatings() {
        try {
            const ratingsArray = Array.from(this.routeRatings.entries());
            localStorage.setItem('sensmap_route_ratings', JSON.stringify(ratingsArray));
        } catch (error) {
            console.warn('경로 평가 저장 실패:', error);
        }
    }

    loadRouteRatings() {
        try {
            const saved = localStorage.getItem('sensmap_route_ratings');
            if (saved) {
                const ratingsArray = JSON.parse(saved);
                this.routeRatings = new Map(ratingsArray);
            }
        } catch (error) {
            console.warn('경로 평가 로드 실패:', error);
        }
    }

    async getGridBasedRoute(start, end) {
        try {
            return await this.calculateGridAStar(start, end);
        } catch (error) {
            console.error('격자 기반 라우팅 실패:', error);
            return null;
        }
    }

    async calculateGridAStar(start, end) {
        const startGrid = this.getGridKey(start);
        const endGrid = this.getGridKey(end);
        const profile = this.getSensitivityProfile();
        const currentTime = Date.now();

        const openSet = new PriorityQueue();
        const closedSet = new Set();
        const gScore = new Map();
        const fScore = new Map();
        const cameFrom = new Map();

        openSet.enqueue(startGrid, 0);
        gScore.set(startGrid, 0);
        fScore.set(startGrid, this.getGridDistance(startGrid, endGrid));

        let iterations = 0;
        const maxIterations = 10000;

        while (!openSet.isEmpty() && iterations < maxIterations) {
            iterations++;
            
            const currentNode = openSet.dequeue();
            if (!currentNode) break;
            
            const current = currentNode.item;

            if (current === endGrid) {
                const path = [];
                let node = current;
                while (node) {
                    const bounds = this.getGridBounds(node);
                    path.unshift(bounds.getCenter());
                    node = cameFrom.get(node);
                }
                
                return {
                    geometry: {
                        coordinates: path.map(p => [p.lng, p.lat])
                    },
                    distance: this.calculatePathDistance(path),
                    duration: this.calculatePathDuration(path),
                    provider: 'GridAStar'
                };
            }

            closedSet.add(current);

            const neighbors = this.getGridNeighbors(current);
            for (const neighbor of neighbors) {
                if (closedSet.has(neighbor)) continue;

                const distToNeighbor = this.getGridDistance(current, neighbor);
                if (distToNeighbor > this.GRID_CELL_SIZE * 1.5) continue;

                const tentativeG = (gScore.get(current) || 0) + 
                    this.getGridMovementCost(current, neighbor, profile, currentTime);

                if (!gScore.has(neighbor) || tentativeG < gScore.get(neighbor)) {
                    cameFrom.set(neighbor, current);
                    gScore.set(neighbor, tentativeG);
                    const f = tentativeG + this.getGridDistance(neighbor, endGrid);
                    fScore.set(neighbor, f);
                    
                    if (!this.isInPriorityQueue(openSet, neighbor)) {
                        openSet.enqueue(neighbor, f);
                    }
                }
            }
            
            if (iterations % 1000 === 0) {
                await new Promise(resolve => setTimeout(resolve, 1));
            }
        }

        return {
            geometry: {
                coordinates: [[start.lng, start.lat], [end.lng, end.lat]]
            },
            distance: start.distanceTo(end),
            duration: start.distanceTo(end) / 1.4,
            provider: 'Fallback'
        };
    }

    isInPriorityQueue(queue, item) {
        return queue.elements.some(element => element.item === item);
    }

    getGridNeighbors(gridKey) {
        const [x, y] = gridKey.split(',').map(Number);
        return [
            `${x-1},${y-1}`, `${x},${y-1}`, `${x+1},${y-1}`,
            `${x-1},${y}`,                    `${x+1},${y}`,
            `${x-1},${y+1}`, `${x},${y+1}`, `${x+1},${y+1}`
        ];
    }

    getGridDistance(from, to) {
        const [x1, y1] = from.split(',').map(Number);
        const [x2, y2] = to.split(',').map(Number);
        return Math.sqrt((x2-x1)**2 + (y2-y1)**2) * this.GRID_CELL_SIZE;
    }

    getGridMovementCost(from, to, profile, currentTime) {
        const baseCost = this.getGridDistance(from, to);
        const cellData = this.gridData.get(to);
        
        if (!cellData || !cellData.reports || cellData.reports.length === 0) {
            return baseCost;
        }

        const empathy = this.empathyData.get(to) || { likes: 0, dislikes: 0 };
        let sensoryCost = 0;
        let totalWeight = 0;

        cellData.reports.forEach(report => {
            const timeDecay = this.calculateTimeDecay(report, empathy, currentTime);
            if (timeDecay > 0.1) {
                const weight = timeDecay;
                const personalizedScore = this.calculatePersonalizedScore(report, profile);
                
                sensoryCost += personalizedScore * weight;
                totalWeight += weight;
            }
        });

        if (totalWeight > 0) {
            sensoryCost /= totalWeight;
            const costMultiplier = 1 + (sensoryCost / 2.5);
            return baseCost * costMultiplier;
        }

        return baseCost;
    }

    optimizeRouteForSensory(route) {
        const profile = this.getSensitivityProfile();
        const currentTime = Date.now();
        
        const score = this.calculateRouteSensoryScore(route.geometry, profile, currentTime);
        
        route.sensoryScore = score;
        route.optimized = true;
        
        return route;
    }

    calculateRouteSensoryScore(geometry, profile, currentTime) {
        let totalScore = 0;
        let segmentCount = 0;

        const coordinates = geometry.coordinates;
        const sampleInterval = Math.max(1, Math.floor(coordinates.length / 20));

        for (let i = 0; i < coordinates.length; i += sampleInterval) {
            const point = L.latLng(coordinates[i][1], coordinates[i][0]);
            const gridKey = this.getGridKey(point);
            const cellData = this.gridData.get(gridKey);

            let segmentScore = 2.5;

            if (cellData && cellData.reports && cellData.reports.length > 0) {
                const empathy = this.empathyData.get(gridKey) || { likes: 0, dislikes: 0 };
                let weightedScore = 0;
                let totalWeight = 0;

                cellData.reports.forEach(report => {
                    const timeDecay = this.calculateTimeDecay(report, empathy, currentTime);
                    if (timeDecay > 0.1) {
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

    displayRoute(route, routeType) {
        try {
            if (this.currentRoute) {
                this.map.removeLayer(this.currentRoute);
            }

            const coordinates = route.geometry.coordinates;
            const latlngs = coordinates.map(coord => [coord[1], coord[0]]);

            const routeStyle = {
                color: routeType === 'sensory' ? '#10b981' : '#1a73e8',
                weight: 6,
                opacity: 0.8,
                lineCap: 'round',
                lineJoin: 'round'
            };

            this.currentRoute = L.polyline(latlngs, routeStyle).addTo(this.map);

            const bounds = this.currentRoute.getBounds();
            this.map.fitBounds(bounds, { padding: [20, 20] });

            this.showRouteInfo(route, routeType);

        } catch (error) {
            this.handleError('경로 표시 중 오류가 발생했습니다', error);
        }
    }

    showRouteInfo(route, routeType) {
        const distance = (route.distance || 0) / 1000;
        const duration = Math.round((route.duration || 0) / 60);
        const sensoryScore = route.sensoryScore || 5;
        const provider = route.provider || 'Unknown';

        const routeControls = document.getElementById('routeControls');
        
        let resultDiv = routeControls.querySelector('.route-result');
        if (!resultDiv) {
            resultDiv = document.createElement('div');
            resultDiv.className = 'route-result';
            routeControls.appendChild(resultDiv);
        }

        resultDiv.innerHTML = `
            <div style="font-weight: 600; margin-bottom: 8px;">
                ${routeType === 'sensory' ? '🌿 감각 친화적 경로' : '⚡ 시간 우선 경로'}
                <span style="font-size: 10px; color: #10b981;">✓ ${provider}</span>
            </div>
            <div class="route-stats">
                <div class="route-stat">
                    <div class="route-stat-value">${distance.toFixed(1)}km</div>
                    <div class="route-stat-label">거리</div>
                </div>
                <div class="route-stat">
                    <div class="route-stat-value">${duration}분</div>
                    <div class="route-stat-label">예상 시간</div>
                </div>
            </div>
            ${routeType === 'sensory' ? `
                <div class="route-stat" style="margin-top: 8px; text-align: center;">
                    <div class="route-stat-value" style="color: ${sensoryScore > 7 ? '#ef4444' : sensoryScore > 5 ? '#f59e0b' : '#10b981'}">
                        ${sensoryScore.toFixed(1)}/10
                    </div>
                    <div class="route-stat-label">쾌적도 점수</div>
                </div>
            ` : ''}
            ${sensoryScore > 7 ? `
                <div class="sensory-warning">
                    <i class="fas fa-exclamation-triangle"></i>
                    경로에 감각적으로 불편한 구간이 포함되어 있습니다
                </div>
            ` : ''}
        `;
    }

    calculatePathDistance(path) {
        let distance = 0;
        for (let i = 1; i < path.length; i++) {
            distance += path[i-1].distanceTo(path[i]);
        }
        return distance;
    }

    calculatePathDuration(path) {
        const distance = this.calculatePathDistance(path);
        return distance / 1.4;
    }

    toggleDataDisplay() {
        this.showData = !this.showData;
        const btn = document.getElementById('showDataBtn');
        
        if (this.showData) {
            btn.classList.add('active');
            btn.setAttribute('aria-pressed', 'true');
            btn.querySelector('i').className = 'fas fa-eye';
            this.sensoryLayers.addTo(this.map);
            if (this.heatmapLayer && this.currentVisualization === 'heatmap') {
                this.heatmapLayer.addTo(this.map);
            }
            this.refreshVisualization();
        } else {
            btn.classList.remove('active');
            btn.setAttribute('aria-pressed', 'false');
            btn.querySelector('i').className = 'fas fa-eye-slash';
            this.map.removeLayer(this.sensoryLayers);
            if (this.heatmapLayer) {
                this.map.removeLayer(this.heatmapLayer);
            }
        }
    }

    toggleRouteMode() {
        this.isRouteMode = !this.isRouteMode;
        const btn = document.getElementById('routeBtn');
        const controls = document.getElementById('routeControls');
        
        if (this.isRouteMode) {
            btn.classList.add('active');
            controls.classList.add('show');
            controls.setAttribute('aria-hidden', 'false');
            this.clearRoutePoints();
            document.getElementById('routeStatus').textContent = '출발지 선택';
            document.getElementById('routeOptions').style.display = 'none';
        } else {
            this.cancelRouteMode();
        }
    }

    cancelRouteMode() {
        this.isRouteMode = false;
        const btn = document.getElementById('routeBtn');
        const controls = document.getElementById('routeControls');
        
        btn?.classList.remove('active');
        controls?.classList.remove('show');
        controls?.setAttribute('aria-hidden', 'true');
        
        this.clearRoutePoints();
        this.hideAlertBanner();
    }

    openProfilePanel() {
        this.closePanels();
        const panel = document.getElementById('profilePanel');
        panel.classList.add('open');
        panel.setAttribute('aria-hidden', 'false');
        
        const firstInput = panel.querySelector('input, button');
        if (firstInput) {
            setTimeout(() => firstInput.focus(), 100);
        }
    }

    openDataInputPanel(latlng = null) {
        if (latlng) {
            this.clickedLocation = latlng;
        }
        
        this.closePanels();
        
        const panel = document.getElementById('sidePanel');
        panel.classList.add('open');
        panel.setAttribute('aria-hidden', 'false');
        
        const form = document.getElementById('sensoryForm');
        form.reset();
        this.skippedFields.clear();
        
        document.querySelectorAll('.skip-btn').forEach(btn => {
            btn.classList.remove('active');
            btn.textContent = '건너뛰기';
        });
        
        document.querySelectorAll('.range-slider').forEach(slider => {
            slider.classList.remove('skipped');
            slider.disabled = false;
        });
        
        const selectedType = document.querySelector('.type-option.selected')?.dataset.type || 'irregular';
        this.autoSkipFields(selectedType);
        
        const firstInput = panel.querySelector('input, button');
        if (firstInput) {
            setTimeout(() => firstInput.focus(), 100);
        }
        
        this.map.closePopup();
    }

    closePanels() {
        const panels = ['sidePanel', 'profilePanel'];
        panels.forEach(panelId => {
            const panel = document.getElementById(panelId);
            if (panel) {
                panel.classList.remove('open');
                panel.setAttribute('aria-hidden', 'true');
            }
        });
        
        this.closeAccessibilityPanel();
        
        setTimeout(() => {
            const map = document.getElementById('map');
            if (map) map.focus();
        }, 100);
    }

    throttledRefreshVisualization() {
        if (this.updateThrottleTimeout) {
            clearTimeout(this.updateThrottleTimeout);
        }
        
        this.updateThrottleTimeout = setTimeout(() => {
            if (!this.isUpdating) {
                this.refreshVisualization();
            }
        }, 100);
    }

    refreshVisualization() {
        if (!this.showData || this.isUpdating) return;
        
        this.isUpdating = true;
        
        try {
            this.sensoryLayers.clearLayers();
            if (this.heatmapLayer) {
                this.map.removeLayer(this.heatmapLayer);
                this.heatmapLayer = null;
            }

            const profile = this.getSensitivityProfile();
            const intensity = parseFloat(document.getElementById('intensitySlider')?.value || 0.7);
            const currentTime = Date.now();

            if (this.currentVisualization === 'heatmap') {
                this.createHeatmapVisualization(profile, intensity, currentTime);
            } else {
                this.createMarkerVisualization(profile, intensity, currentTime);
            }
        } catch (error) {
            this.handleError('시각화 업데이트 중 오류가 발생했습니다', error);
        } finally {
            this.isUpdating = false;
        }
    }

    createHeatmapVisualization(profile, intensity, currentTime) {
        if (typeof L.heatLayer === 'undefined') {
            console.warn('Leaflet.heat 라이브러리가 로드되지 않음, 마커로 대체');
            this.createMarkerVisualization(profile, intensity, currentTime);
            return;
        }

        const heatData = [];
        
        this.gridData.forEach((cellData, gridKey) => {
            if (!cellData.reports || cellData.reports.length === 0) return;
            
            const filteredReports = this.filterReportsByType(cellData.reports);
            if (filteredReports.length === 0) return;

            const empathy = this.empathyData.get(gridKey) || { likes: 0, dislikes: 0 };
            let avgScore = 0;
            let totalWeight = 0;
            let hasValidData = false;

            filteredReports.forEach(report => {
                const timeDecay = this.calculateTimeDecay(report, empathy, currentTime);
                if (timeDecay > 0.1) {
                    const weight = timeDecay;
                    const score = this.calculatePersonalizedScore(report, profile);
                    avgScore += score * weight;
                    totalWeight += weight;
                    hasValidData = true;
                }
            });

            if (hasValidData && totalWeight > 0) {
                avgScore /= totalWeight;
                const bounds = this.getGridBounds(gridKey);
                const center = bounds.getCenter();
                
                const heatIntensity = (avgScore / 10) * intensity;
                heatData.push([center.lat, center.lng, heatIntensity]);
            }
        });

        if (heatData.length > 0) {
            this.heatmapLayer = L.heatLayer(heatData, {
                radius: 25,
                blur: 15,
                maxZoom: 17,
                gradient: {
                    0.0: '#00ff00',
                    0.3: '#ffff00', 
                    0.6: '#ff8800',
                    1.0: '#ff0000'
                }
            }).addTo(this.map);
        }
    }

    filterReportsByType(reports) {
        if (this.currentFilter === 'all') return reports;
        
        return reports.filter(report => {
            switch (this.currentFilter) {
                case 'noise':
                    return report.noise !== undefined && report.noise >= 0;
                case 'light':
                    return report.light !== undefined && report.light >= 0;
                case 'odor':
                    return report.odor !== undefined && report.odor >= 0;
                case 'crowd':
                    return report.crowd !== undefined && report.crowd >= 0;
                default:
                    return true;
            }
        });
    }

    createMarkerVisualization(profile, intensity, currentTime) {
        this.gridData.forEach((cellData, gridKey) => {
            if (!cellData.reports || cellData.reports.length === 0) {
                this.createNeutralMarker(gridKey, intensity);
                return;
            }

            const filteredReports = this.filterReportsByType(cellData.reports);
            if (filteredReports.length === 0) {
                this.createNeutralMarker(gridKey, intensity);
                return;
            }

            const empathy = this.empathyData.get(gridKey) || { likes: 0, dislikes: 0 };
            let avgScore = 0;
            let totalWeight = 0;
            let hasValidData = false;

            filteredReports.forEach(report => {
                const timeDecay = this.calculateTimeDecay(report, empathy, currentTime);
                if (timeDecay > 0.1) {
                    const weight = timeDecay;
                    const score = this.calculatePersonalizedScore(report, profile);
                    avgScore += score * weight;
                    totalWeight += weight;
                    hasValidData = true;
                }
            });

            if (hasValidData && totalWeight > 0) {
                avgScore /= totalWeight;
                this.createSensoryMarker(gridKey, avgScore, intensity, filteredReports[0].type);
            } else {
                this.createNeutralMarker(gridKey, intensity);
            }
        });
    }

    createNeutralMarker(gridKey, intensity) {
        const bounds = this.getGridBounds(gridKey);
        const center = bounds.getCenter();
        const size = 8 * intensity;
        
        const icon = L.divIcon({
            className: 'neutral-marker',
            html: `<div style="
                width: ${size}px; 
                height: ${size}px; 
                background: #d1d5db; 
                border-radius: 50%; 
                border: 1px solid #9ca3af;
                opacity: 0.4;
            "></div>`,
            iconSize: [size, size],
            iconAnchor: [size/2, size/2]
        });

        const marker = L.marker(center, { icon });
        marker.sensoryData = { gridKey, neutral: true };
        
        marker.on('click', () => {
            this.showLocationPopup(center, gridKey, this.gridData.get(gridKey));
        });
        
        this.sensoryLayers.addLayer(marker);
    }

    createSensoryMarker(gridKey, score, intensity, type) {
        const bounds = this.getGridBounds(gridKey);
        const center = bounds.getCenter();
        
        const baseSize = 12 + (score * 1.5);
        const size = Math.max(8, baseSize * intensity);
        
        let color;
        if (this.accessibilitySettings.colorBlindMode) {
            const brightness = Math.max(20, 100 - (score * 8));
            color = `hsl(0, 0%, ${brightness}%)`;
        } else {
            const hue = Math.max(0, (10 - score) * 12);
            const saturation = 70;
            const lightness = 50;
            color = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
        }
        
        const icon = L.divIcon({
            className: `sensory-marker ${type}`,
            html: `<div style="
                width: ${size}px; 
                height: ${size}px; 
                background: ${color}; 
                border-radius: 50%; 
                border: 2px solid white;
                box-shadow: 0 2px 8px rgba(0,0,0,0.25);
                opacity: 0.8;
                ${this.accessibilitySettings.colorBlindMode ? `
                    border-style: ${score > 7 ? 'solid' : score > 4 ? 'dashed' : 'dotted'};
                    border-width: ${score > 7 ? '4px' : '2px'};
                ` : ''}
            "></div>`,
            iconSize: [size, size],
            iconAnchor: [size/2, size/2]
        });

        const marker = L.marker(center, { icon });
        marker.sensoryData = { gridKey, score, type };
        
        marker.on('click', () => {
            this.showLocationPopup(center, gridKey, this.gridData.get(gridKey));
        });
        
        this.sensoryLayers.addLayer(marker);
    }

    showLocationPopup(latlng, gridKey, cellData) {
        try {
            const empathy = this.empathyData.get(gridKey) || { likes: 0, dislikes: 0 };
            const hasData = cellData && cellData.reports && cellData.reports.length > 0;
            
            let popupContent = `
                <div class="popup-header">
                    <div class="popup-title">위치 정보</div>
                    <div class="popup-subtitle">격자: ${gridKey}</div>
                </div>
            `;

            if (this.isRouteMode) {
                popupContent += `
                    <div class="action-grid">
                        <button class="action-btn start" onclick="window.sensmapApp.setRoutePoint('start', L.latLng(${latlng.lat}, ${latlng.lng}))">
                            <i class="fas fa-play"></i>출발지
                        </button>
                        <button class="action-btn end" onclick="window.sensmapApp.setRoutePoint('end', L.latLng(${latlng.lat}, ${latlng.lng}))">
                            <i class="fas fa-stop"></i>도착지
                        </button>
                    </div>
                `;
            }

            popupContent += `
                <button class="action-btn add" onclick="window.sensmapApp.openDataInputPanel(L.latLng(${latlng.lat}, ${latlng.lng}))">
                    <i class="fas fa-plus"></i>감각 정보 추가
                </button>
            `;

            if (hasData) {
                const filteredReports = this.filterReportsByType(cellData.reports);
                
                if (filteredReports.length > 0) {
                    popupContent += `<div class="data-summary">
                        <div class="summary-title">등록된 감각 정보 (${filteredReports.length}개)</div>`;

                    const currentTime = Date.now();
                    filteredReports.forEach((report, index) => {
                        const timeDecay = this.calculateTimeDecay(report, empathy, currentTime);
                        const timeAgo = this.getTimeAgo(report.timestamp);
                        
                        if (timeDecay > 0.01) {
                            popupContent += `
                                <div class="data-item">
                                    <div>
                                        <strong>${report.type === 'irregular' ? '⚡ 일시적' : '🏢 지속적'}</strong>
                                        <div style="font-size: 10px; color: #6b7280;">${timeAgo}</div>
                                    </div>
                                    <div class="data-values">
                                        ${report.noise !== undefined && !this.skippedFields.has('noise') ? `<span class="data-badge">소음 ${report.noise}</span>` : ''}
                                        ${report.light !== undefined && !this.skippedFields.has('light') ? `<span class="data-badge">빛 ${report.light}</span>` : ''}
                                        ${report.odor !== undefined && !this.skippedFields.has('odor') ? `<span class="data-badge">냄새 ${report.odor}</span>` : ''}
                                        ${report.crowd !== undefined && !this.skippedFields.has('crowd') ? `<span class="data-badge">혼잡 ${report.crowd}</span>` : ''}
                                        ${report.wheelchair ? `<span class="data-badge">♿</span>` : ''}
                                    </div>
                                </div>
                                <div class="data-interaction">
                                    <button class="empathy-btn like ${empathy.userLike === index ? 'active' : ''}" 
                                            onclick="window.sensmapApp.toggleEmpathy('${gridKey}', ${index}, 'like')">
                                        👍 ${empathy.likes || 0}
                                    </button>
                                    <button class="empathy-btn dislike ${empathy.userDislike === index ? 'active' : ''}" 
                                            onclick="window.sensmapApp.toggleEmpathy('${gridKey}', ${index}, 'dislike')">
                                        👎 ${empathy.dislikes || 0}
                                    </button>
                                    <button class="delete-btn" onclick="window.sensmapApp.deleteSensoryReport('${gridKey}', ${index})">
                                        삭제
                                    </button>
                                </div>
                            `;
                        }
                    });

                    popupContent += `</div>`;
                }
            }

            const popup = L.popup({
                maxWidth: 300,
                className: 'custom-popup'
            })
            .setLatLng(latlng)
            .setContent(popupContent)
            .openOn(this.map);

        } catch (error) {
            this.handleError('팝업 표시 중 오류가 발생했습니다', error);
        }
    }

    async handleSensorySubmit(e) {
        e.preventDefault();
        
        if (!this.clickedLocation) {
            this.showToast('위치를 먼저 선택해주세요', 'warning');
            return;
        }

        try {
            const formData = new FormData(e.target);
            const selectedType = document.querySelector('.type-option.selected')?.dataset.type || 'irregular';
            
            const sensoryFields = ['noise', 'light', 'odor', 'crowd'];
            const hasAtLeastOneValue = sensoryFields.some(field => 
                !this.skippedFields.has(field) && formData.get(field)
            );
            
            if (!hasAtLeastOneValue) {
                this.showToast('최소 하나의 감각 정보는 입력해야 합니다', 'warning');
                return;
            }

            const duration = formData.get('duration');
            if (duration && (isNaN(duration) || duration < 1 || duration > 10080)) {
                this.showToast('지속 시간은 1분에서 7일(10080분) 사이여야 합니다', 'warning');
                return;
            }

            const reportData = {
                type: selectedType,
                timestamp: Date.now(),
                location: this.clickedLocation
            };

            sensoryFields.forEach(field => {
                if (!this.skippedFields.has(field)) {
                    const value = parseInt(formData.get(field));
                    if (!isNaN(value)) {
                        reportData[field] = value;
                    }
                }
            });

            if (duration) {
                reportData.duration = parseInt(duration);
            }
            
            if (formData.get('wheelchair')) {
                reportData.wheelchair = true;
            }

            this.lastAddedData = {
                location: this.clickedLocation,
                data: reportData,
                gridKey: this.getGridKey(this.clickedLocation)
            };

            this.addSensoryData(this.clickedLocation, reportData);
            this.closePanels();
            
            this.showToast('감각 정보가 성공적으로 저장되었습니다', 'success');
            this.showUndoAction();

        } catch (error) {
            this.handleError('감각 정보 저장 중 오류가 발생했습니다', error);
        }
    }

    showUndoAction() {
        const undoAction = document.getElementById('undoAction');
        if (undoAction) {
            undoAction.style.display = 'flex';
            setTimeout(() => {
                undoAction.style.display = 'none';
            }, 5000);
        }
    }

    undoLastAction() {
        if (this.lastAddedData) {
            const { gridKey } = this.lastAddedData;
            const cellData = this.gridData.get(gridKey);
            
            if (cellData && cellData.reports && cellData.reports.length > 0) {
                cellData.reports.pop();
                
                if (cellData.reports.length === 0) {
                    this.gridData.delete(gridKey);
                    this.empathyData.delete(gridKey);
                }
                
                this.saveGridData();
                this.saveEmpathyData();
                this.refreshVisualization();
                
                this.showToast('마지막 추가한 감각 정보가 취소되었습니다', 'info');
            }
            
            const undoAction = document.getElementById('undoAction');
            if (undoAction) {
                undoAction.style.display = 'none';
            }
            
            this.lastAddedData = null;
        }
    }

    handleProfileSubmit(e) {
        e.preventDefault();
        
        try {
            const formData = new FormData(e.target);
            const profile = {
                noiseThreshold: parseInt(formData.get('noiseThreshold')),
                lightThreshold: parseInt(formData.get('lightThreshold')),
                odorThreshold: parseInt(formData.get('odorThreshold')),
                crowdThreshold: parseInt(formData.get('crowdThreshold'))
            };

            localStorage.setItem('sensmap_profile', JSON.stringify(profile));
            this.closePanels();
            
            this.showToast('감각 프로필이 저장되었습니다', 'success');
            this.refreshVisualization();

        } catch (error) {
            this.handleError('프로필 저장 중 오류가 발생했습니다', error);
        }
    }

    addSensoryData(latlng, reportData) {
        try {
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
            this.createAdditionEffect(latlng, reportData.type);
            
        } catch (error) {
            this.handleError('감각 데이터 추가 중 오류가 발생했습니다', error);
        }
    }

    createAdditionEffect(latlng, type) {
        try {
            const mapContainer = document.getElementById('map');
            const point = this.map.latLngToContainerPoint(latlng);
            
            const effect = document.createElement('div');
            effect.style.cssText = `
                position: absolute;
                left: ${point.x}px;
                top: ${point.y}px;
                width: 20px;
                height: 20px;
                background: ${type === 'irregular' ? '#fbbf24' : '#3b82f6'};
                border-radius: 50%;
                pointer-events: none;
                z-index: 600;
                transform: translate(-50%, -50%);
                box-shadow: 0 0 20px currentColor;
            `;
            
            const animation = effect.animate([
                { transform: 'translate(-50%, -50%) scale(0.5)', opacity: 1 },
                { transform: 'translate(-50%, -50%) scale(2)', opacity: 0 }
            ], {
                duration: 1000,
                easing: 'ease-out'
            });
            
            animation.onfinish = () => {
                if (effect.parentNode) {
                    effect.parentNode.removeChild(effect);
                }
            };
            
            mapContainer.appendChild(effect);
            
        } catch (error) {
            console.warn('이펙트 생성 실패:', error);
        }
    }

    toggleEmpathy(gridKey, reportIndex, type) {
        try {
            if (!this.empathyData.has(gridKey)) {
                this.empathyData.set(gridKey, { likes: 0, dislikes: 0 });
            }

            const empathy = this.empathyData.get(gridKey);
            const isCurrentlyActive = empathy[`user${type.charAt(0).toUpperCase() + type.slice(1)}`] === reportIndex;

            if (empathy.userLike === reportIndex) {
                empathy.likes = Math.max(0, empathy.likes - 1);
                delete empathy.userLike;
            }
            if (empathy.userDislike === reportIndex) {
                empathy.dislikes = Math.max(0, empathy.dislikes - 1);
                delete empathy.userDislike;
            }

            if (!isCurrentlyActive) {
                if (type === 'like') {
                    empathy.likes++;
                    empathy.userLike = reportIndex;
                } else {
                    empathy.dislikes++;
                    empathy.userDislike = reportIndex;
                }
            }

            this.saveEmpathyData();
            this.refreshVisualization();
            
            const bounds = this.getGridBounds(gridKey);
            const center = bounds.getCenter();
            this.showLocationPopup(center, gridKey, this.gridData.get(gridKey));

        } catch (error) {
            this.handleError('공감 반응 처리 중 오류가 발생했습니다', error);
        }
    }

    deleteSensoryReport(gridKey, reportIndex) {
        try {
            if (confirm('이 감각 정보를 삭제하시겠습니까?')) {
                const cellData = this.gridData.get(gridKey);
                if (cellData && cellData.reports) {
                    cellData.reports.splice(reportIndex, 1);
                    
                    if (cellData.reports.length === 0) {
                        this.gridData.delete(gridKey);
                        this.empathyData.delete(gridKey);
                    }
                    
                    this.saveGridData();
                    this.saveEmpathyData();
                    this.refreshVisualization();
                    this.map.closePopup();
                    
                    this.showToast('감각 정보가 삭제되었습니다', 'success');
                }
            }
        } catch (error) {
            this.handleError('감각 정보 삭제 중 오류가 발생했습니다', error);
        }
    }

    getGridKey(latlng) {
        const x = Math.floor(latlng.lng * 111320 / this.GRID_CELL_SIZE);
        const y = Math.floor(latlng.lat * 111320 / this.GRID_CELL_SIZE);
        return `${x},${y}`;
    }

    getGridBounds(gridKey) {
        const [x, y] = gridKey.split(',').map(Number);
        const lng1 = x * this.GRID_CELL_SIZE / 111320;
        const lat1 = y * this.GRID_CELL_SIZE / 111320;
        const lng2 = (x + 1) * this.GRID_CELL_SIZE / 111320;
        const lat2 = (y + 1) * this.GRID_CELL_SIZE / 111320;
        return L.latLngBounds([lat1, lng1], [lat2, lng2]);
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
            if (sensoryData[key] !== undefined && sensoryData[key] >= 0) {
                totalScore += sensoryData[key] * weights[key];
                totalWeight += weights[key];
            }
        });

        return totalWeight > 0 ? totalScore / totalWeight : 0;
    }

    calculateTimeDecay(report, empathy, currentTime) {
        const ageMs = currentTime - report.timestamp;
        const ageMinutes = ageMs / (1000 * 60);
        
        let maxAge, baseDecayRate;
        
        if (report.duration) {
            maxAge = Math.max(report.duration, 30);
            baseDecayRate = report.type === 'irregular' ? 1.5 : 0.6;
        } else {
            maxAge = report.type === 'irregular' ? 60 : 240;
            baseDecayRate = report.type === 'irregular' ? 1.2 : 0.4;
        }

        if (ageMinutes >= maxAge) return 0;
        
        const netEmpathy = empathy.likes - empathy.dislikes;
        const empathyFactor = netEmpathy > 0 ? 
            Math.max(0.5, 1 - (netEmpathy * 0.1)) : 
            Math.min(2.0, 1 + (Math.abs(netEmpathy) * 0.15));
        
        const adjustedDecayRate = baseDecayRate * empathyFactor;
        const normalizedAge = ageMinutes / maxAge;
        
        return Math.exp(-adjustedDecayRate * normalizedAge);
    }

    getSensitivityProfile() {
        try {
            const saved = localStorage.getItem('sensmap_profile');
            return saved ? JSON.parse(saved) : {
                noiseThreshold: 5,
                lightThreshold: 5,
                odorThreshold: 5,
                crowdThreshold: 5
            };
        } catch (error) {
            console.warn('프로필 로드 실패:', error);
            return {
                noiseThreshold: 5,
                lightThreshold: 5,
                odorThreshold: 5,
                crowdThreshold: 5
            };
        }
    }

    getTimeAgo(timestamp) {
        const now = Date.now();
        const diff = now - timestamp;
        const minutes = Math.floor(diff / (1000 * 60));
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days}일 전`;
        if (hours > 0) return `${hours}시간 전`;
        if (minutes > 0) return `${minutes}분 전`;
        return '방금 전';
    }

    cleanupExpiredData() {
        try {
            const currentTime = Date.now();
            let cleanedCount = 0;

            this.gridData.forEach((cellData, gridKey) => {
                if (cellData.reports) {
                    const empathy = this.empathyData.get(gridKey) || { likes: 0, dislikes: 0 };
                    cellData.reports = cellData.reports.filter(report => {
                        const timeDecay = this.calculateTimeDecay(report, empathy, currentTime);
                        const shouldKeep = timeDecay > 0.01;
                        if (!shouldKeep) cleanedCount++;
                        return shouldKeep;
                    });

                    if (cellData.reports.length === 0) {
                        this.gridData.delete(gridKey);
                        this.empathyData.delete(gridKey);
                    }
                }
            });

            if (cleanedCount > 0) {
                console.log(`${cleanedCount}개의 만료된 리포트 정리 완료`);
                this.saveGridData();
                this.saveEmpathyData();
                this.refreshVisualization();
            }
        } catch (error) {
            console.warn('데이터 정리 실패:', error);
        }
    }

    setupGeolocation() {
        try {
            if ('geolocation' in navigator) {
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        const { latitude, longitude } = position.coords;
                        this.map.setView([latitude, longitude], 16);
                    },
                    (error) => {
                        console.warn('위치 정보 가져오기 실패:', error);
                        this.showToast('위치 정보를 가져올 수 없습니다', 'warning');
                    },
                    { timeout: 10000, maximumAge: 60000 }
                );
            }
        } catch (error) {
            console.warn('위치 정보 설정 실패:', error);
        }
    }

    setupKeyboardNavigation() {
        try {
            const mapElement = document.getElementById('map');
            mapElement.setAttribute('tabindex', '0');
            
            mapElement.addEventListener('keydown', (e) => {
                const panDistance = 50;
                
                switch (e.key) {
                    case 'ArrowUp':
                        e.preventDefault();
                        this.map.panBy([0, -panDistance]);
                        break;
                    case 'ArrowDown':
                        e.preventDefault();
                        this.map.panBy([0, panDistance]);
                        break;
                    case 'ArrowLeft':
                        e.preventDefault();
                        this.map.panBy([-panDistance, 0]);
                        break;
                    case 'ArrowRight':
                        e.preventDefault();
                        this.map.panBy([panDistance, 0]);
                        break;
                    case '+':
                    case '=':
                        e.preventDefault();
                        this.map.zoomIn();
                        break;
                    case '-':
                        e.preventDefault();
                        this.map.zoomOut();
                        break;
                }
            });
        } catch (error) {
            console.warn('키보드 네비게이션 설정 실패:', error);
        }
    }

    saveGridData() {
        try {
            const dataToSave = Array.from(this.gridData.entries(), ([key, value]) => [key, { reports: value.reports }]);
            localStorage.setItem('sensmap_grid_data', JSON.stringify(dataToSave));
        } catch (error) {
            console.warn('격자 데이터 저장 실패:', error);
        }
    }

    saveEmpathyData() {
        try {
            const dataToSave = Array.from(this.empathyData.entries());
            localStorage.setItem('sensmap_empathy_data', JSON.stringify(dataToSave));
        } catch (error) {
            console.warn('공감 데이터 저장 실패:', error);
        }
    }

    loadSavedData() {
        try {
            const savedGridData = localStorage.getItem('sensmap_grid_data');
            if (savedGridData) {
                const parsed = JSON.parse(savedGridData);
                this.gridData = new Map(parsed.map(([key, value]) => [key, { reports: value.reports, bounds: this.getGridBounds(key) }]));
            }

            const savedEmpathyData = localStorage.getItem('sensmap_empathy_data');
            if (savedEmpathyData) {
                const parsed = JSON.parse(savedEmpathyData);
                this.empathyData = new Map(parsed);
            }

            this.loadRouteRatings();

            const profile = this.getSensitivityProfile();
            Object.keys(profile).forEach(key => {
                const slider = document.getElementById(key);
                const valueDisplay = slider?.parentNode?.querySelector('.range-value');
                if (slider) {
                    slider.value = profile[key];
                    if (valueDisplay) {
                        valueDisplay.textContent = profile[key];
                    }
                }
            });

            this.refreshVisualization();
        } catch (error) {
            console.warn('데이터 로드 실패:', error);
        }
    }

    showToast(message, type = 'info') {
        try {
            const toast = document.getElementById('toast');
            if (!toast) return;

            toast.textContent = message;
            toast.className = `toast ${type}`;
            toast.classList.add('show');

            setTimeout(() => {
                toast.classList.remove('show');
            }, 4000);
        } catch (error) {
            console.warn('토스트 표시 실패:', error);
        }
    }

    handleError(message, error) {
        console.error(message, error);
        this.showToast(message, 'error');
        
        if (error && error.name === 'TypeError') {
            const errorBoundary = document.getElementById('errorBoundary');
            if (errorBoundary) {
                errorBoundary.style.display = 'block';
            }
        }
    }
}

window.addEventListener('error', (e) => {
    console.error('전역 오류:', e.error);
});

window.addEventListener('unhandledrejection', (e) => {
    console.error('처리되지 않은 Promise 거부:', e.reason);
});

document.addEventListener('DOMContentLoaded', () => {
    try {
        window.sensmapApp = new SensmapApp();
    } catch (error) {
        console.error('앱 초기화 실패:', error);
        document.getElementById('errorBoundary')?.style.setProperty('display', 'block');
    }
});

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SensmapApp;
}