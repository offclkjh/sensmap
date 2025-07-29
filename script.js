/*
MAJOR ROUTING ALGORITHM OVERHAUL:
- Replaced with OpenRouteService-first sensory-aware routing
- Implemented time decay for sensory data
- Added personalized sensory costs
- Real walkable path validation using ORS
- Path filtering: exclude >150% shortest time
- Color-coded route with sensory levels
- Fuzzy logic penalties
- Enhanced sensory vs time mode
- Fallback with basic sensory check
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
        const maxRetries = 7;

        while (retryCount < maxRetries) {
            try {
                this.map = L.map('map', {
                    center: [37.5665, 126.9780],
                    zoom: 14,
                    zoomControl: true,
                    attributionControl: true,
                    preferCanvas: true
                });

                const tileUrls = [
                    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
                    'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
                    'https://{s}.tile.stamen.com/terrain/{z}/{x}/{y}.png',
                    'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
                    'https://{s}.tile.openstreetmap.de/{z}/{x}/{y}.png',
                    'https://{s}.tile.cyclosm.org/{z}/{x}/{y}.png',
                    'https://{s}.tile.thunderforest.com/transport/{z}/{x}/{y}.png'
                ];

                let tileLayer = null;
                for (const url of tileUrls) {
                    try {
                        this.showToast(`타일 서버 시도 중: ${url.split('//')[1].split('/')[0]}`, 'info');
                        tileLayer = L.tileLayer(url, {
                            attribution: '© OpenStreetMap contributors | Map data from various providers',
                            maxZoom: 19,
                            timeout: 15000,
                            retryLimit: 5,
                            crossOrigin: 'anonymous'
                        });
                        
                        await new Promise((resolve, reject) => {
                            const timeout = setTimeout(() => reject(new Error('Tile timeout')), 15000);
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
                
                await new Promise(resolve => setTimeout(resolve, 2000 * retryCount));
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

            document.getElementById('hamburgerBtn')?.addEventListener('click', () => this.toggleHamburgerMenu());
            document.getElementById('profileMenuBtn')?.addEventListener('click', () => {
                this.closeHamburgerMenu();
                this.openProfilePanel();
            });
            document.getElementById('settingsBtn')?.addEventListener('click', () => {
                this.closeHamburgerMenu();
                this.openSettingsPanel();
            });
            document.getElementById('helpBtn')?.addEventListener('click', () => {
                this.closeHamburgerMenu();
                this.showTutorial();
            });
            document.getElementById('contactBtn')?.addEventListener('click', () => {
                this.closeHamburgerMenu();
                this.openContactModal();
            });

            document.getElementById('closeSettingsBtn')?.addEventListener('click', () => this.closeSettingsPanel());
            
            document.getElementById('closeContactBtn')?.addEventListener('click', () => this.closeContactModal());

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
            
            document.getElementById('colorBlindMode')?.addEventListener('change', (e) => this.toggleColorBlindMode(e.target.checked));
            document.getElementById('highContrastMode')?.addEventListener('change', (e) => this.toggleHighContrastMode(e.target.checked));
            document.getElementById('reducedMotionMode')?.addEventListener('change', (e) => this.toggleReducedMotionMode(e.target.checked));
            document.getElementById('textSizeSlider')?.addEventListener('input', (e) => this.adjustTextSize(e.target.value));

            document.getElementById('showDataBtn')?.addEventListener('click', () => this.toggleDataDisplay());
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

            document.addEventListener('click', (e) => {
                if (!e.target.closest('.hamburger-menu')) {
                    this.closeHamburgerMenu();
                }
                if (!e.target.closest('.modal-overlay') && !e.target.closest('#contactBtn')) {
                    this.closeContactModal();
                }
            });

            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    this.closePanels();
                    this.cancelRouteMode();
                    this.closeSettingsPanel();
                    this.closeHamburgerMenu();
                    this.closeContactModal();
                    this.hideRouteRating();
                }
            });

            window.addEventListener('error', (e) => this.handleError('예상치 못한 오류가 발생했습니다', e.error));
            window.addEventListener('unhandledrejection', (e) => this.handleError('비동기 작업 중 오류가 발생했습니다', e.reason));

        } catch (error) {
            this.handleError('이벤트 리스너 설정 중 오류가 발생했습니다', error);
        }
    }

    toggleHamburgerMenu() {
        const btn = document.getElementById('hamburgerBtn');
        const dropdown = document.getElementById('hamburgerDropdown');
        const isOpen = btn.getAttribute('aria-expanded') === 'true';
        
        btn.setAttribute('aria-expanded', !isOpen);
        dropdown.setAttribute('aria-hidden', isOpen);
    }

    closeHamburgerMenu() {
        const btn = document.getElementById('hamburgerBtn');
        const dropdown = document.getElementById('hamburgerDropdown');
        btn.setAttribute('aria-expanded', 'false');
        dropdown.setAttribute('aria-hidden', 'true');
    }

    openSettingsPanel() {
        this.closePanels();
        const panel = document.getElementById('settingsPanel');
        panel.classList.add('open');
    }

    closeSettingsPanel() {
        const panel = document.getElementById('settingsPanel');
        panel.classList.remove('open');
    }

    openContactModal() {
        const modal = document.getElementById('contactModal');
        modal.classList.add('show');
    }

    closeContactModal() {
        const modal = document.getElementById('contactModal');
        modal.classList.remove('show');
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

        this.showLoading(true, '감각 친화적 경로를 계산하고 있습니다...');
        this.showToast(`${routeType === 'sensory' ? '감각 친화적' : '시간 우선'} 경로를 계산하고 있습니다...`, 'info');

        try {
            const start = this.routePoints.start;
            const end = this.routePoints.end;
            
            // Step 1: Get base walking routes from OpenRouteService
            const routeCandidates = await this.getOpenRouteServicePaths(start, end, routeType);
            
            if (!routeCandidates || routeCandidates.length === 0) {
                throw new Error('실제 도보 경로를 찾을 수 없습니다');
            }

            // Step 2: Process sensory data with time decay
            const currentTime = Date.now();
            const profile = this.getSensitivityProfile();

            // Step 3: Calculate sensory costs for each route
            const evaluatedRoutes = routeCandidates.map(route => 
                this.evaluateRouteSensoryCost(route, profile, currentTime, routeType)
            );

            // Step 4: Filter out routes exceeding 150% of shortest time
            const shortestTime = Math.min(...evaluatedRoutes.map(r => r.duration));
            const timeThreshold = shortestTime * 1.5;
            const validRoutes = evaluatedRoutes.filter(route => route.duration <= timeThreshold);

            if (validRoutes.length === 0) {
                throw new Error('시간 제약 조건을 만족하는 경로가 없습니다');
            }

            // Step 5: Select route with lowest total cost (distance + sensory penalties)
            const bestRoute = validRoutes.reduce((best, current) => 
                current.totalCost < best.totalCost ? current : best
            );

            // Step 6: Apply color-coded visualization with sensory levels
            this.displaySensoryAwareRoute(bestRoute, routeType);
            this.checkRouteForAlerts(bestRoute);
            
            document.getElementById('routeStatus').textContent = '경로 생성 완료';  
            this.showToast(`${routeType === 'sensory' ? '쾌적한' : '빠른'} 경로를 찾았습니다!`, 'success');
            
            setTimeout(() => this.showRouteRating(routeType), 3000);

        } catch (error) {
            console.warn('고급 라우팅 실패, 백업 시스템 사용:', error);
            await this.fallbackToSimpleRoute();
        } finally {
            this.hideLoading();
        }
    }

    async getOpenRouteServicePaths(start, end, routeType) {
        const apiKey = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImYwZmEzYWM1MzFiODlhZTQ1ZDg3YjljNmViMGM3NmU5NzM4MTY1NGViYTgxOWY2YWNiZDJhNTMwIiwiaCI6Im11cm11cjY0In0=';
        const baseUrl = 'https://api.openrouteservice.org/v2/directions/foot-walking';
        
        try {
            // Generate multiple route alternatives
            const requestBody = {
                coordinates: [[start.lng, start.lat], [end.lng, end.lat]],
                format: 'geojson',
                preference: routeType === 'sensory' ? 'recommended' : 'fastest',
                alternative_routes: {
                    target_count: 3,
                    weight_factor: 1.4,
                    share_factor: 0.6
                },
                options: {
                    avoid_features: routeType === 'sensory' ? ['highways'] : [],
                    profile_params: {
                        weightings: {
                            green: routeType === 'sensory' ? 0.8 : 0.2,
                            quiet: routeType === 'sensory' ? 0.9 : 0.1
                        }
                    }
                }
            };

            const response = await fetch(baseUrl, {
                method: 'POST',
                headers: {
                    'Authorization': apiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                this.showToast(`ORS API 오류: ${response.status} - 키나 네트워크 확인하세요`, 'error');
                throw new Error(`OpenRouteService API error: ${response.status}`);
            }

            const data = await response.json();
            
            if (!data.features || data.features.length === 0) {
                throw new Error('경로를 찾을 수 없습니다');
            }

            return data.features.map(feature => ({
                geometry: feature.geometry,
                distance: feature.properties.segments[0].distance,
                duration: feature.properties.segments[0].duration,
                provider: 'OpenRouteService'
            }));

        } catch (error) {
            console.warn('OpenRouteService 실패:', error);
            return null;
        }
    }

    evaluateRouteSensoryCost(route, profile, currentTime, routeType) {
        const coordinates = route.geometry.coordinates;
        let totalSensoryCost = 0;
        let segmentCount = 0;
        
        // Sample points along the route for sensory evaluation
        const sampleInterval = Math.max(1, Math.floor(coordinates.length / 30));
        
        for (let i = 0; i < coordinates.length; i += sampleInterval) {
            const point = L.latLng(coordinates[i][1], coordinates[i][0]);
            const gridKey = this.getGridKey(point);
            const cellData = this.gridData.get(gridKey);
            
            if (cellData && cellData.reports && cellData.reports.length > 0) {
                const empathy = this.empathyData.get(gridKey) || { likes: 0, dislikes: 0 };
                const segmentCost = this.calculateSegmentSensoryCost(
                    cellData.reports, empathy, profile, currentTime, routeType
                );
                totalSensoryCost += segmentCost;
            }
            segmentCount++;
        }

        // Calculate average sensory cost per segment
        const avgSensoryCost = segmentCount > 0 ? totalSensoryCost / segmentCount : 0;
        
        // Apply fuzzy logic for gradual penalty scaling
        const fuzzyPenalty = this.applyFuzzyLogicPenalty(avgSensoryCost, routeType);
        
        // Combined cost: base time/distance + sensory penalties
        const baseCost = routeType === 'sensory' ? route.distance : route.duration;
        const totalCost = baseCost + (fuzzyPenalty * baseCost * 0.3); // 30% max penalty
        
        return {
            ...route,
            sensoryScore: avgSensoryCost,
            fuzzyPenalty: fuzzyPenalty,
            totalCost: totalCost,
            segmentDetails: this.generateSegmentDetails(coordinates, profile, currentTime)
        };
    }

    calculateSegmentSensoryCost(reports, empathy, profile, currentTime, routeType) {
        let weightedCost = 0;
        let totalWeight = 0;

        reports.forEach(report => {
            // Apply time decay to reduce influence of old data
            const timeDecay = this.calculateTimeDecay(report, empathy, currentTime);
            if (timeDecay < 0.1) return; // Skip very old data
            
            // Calculate personalized sensory cost based on user sensitivity
            let reportCost = 0;
            let factorCount = 0;
            
            ['noise', 'light', 'odor', 'crowd'].forEach(factor => {
                if (report[factor] !== undefined && !this.skippedFields.has(factor)) {
                    const sensitivity = profile[`${factor}Threshold`] / 10; // Normalize to 0-1
                    const stimulusLevel = report[factor] / 10; // Normalize to 0-1
                    
                    // Personalized cost: stimulus × sensitivity
                    reportCost += stimulusLevel * sensitivity;
                    factorCount++;
                }
            });
            
            if (factorCount > 0) {
                reportCost /= factorCount; // Average cost across factors
                const weight = timeDecay;
                weightedCost += reportCost * weight;
                totalWeight += weight;
            }
        });

        return totalWeight > 0 ? weightedCost / totalWeight : 0;
    }

    applyFuzzyLogicPenalty(sensoryCost, routeType) {
        if (routeType === 'time') {
            // Minimal penalty for time-priority routes
            return sensoryCost > 0.8 ? Math.min(0.2, sensoryCost * 0.25) : 0;
        }
        
        // Gradual penalty scaling for sensory routes using fuzzy logic
        if (sensoryCost <= 0.3) return 0; // No penalty for low stimulus
        if (sensoryCost <= 0.5) return (sensoryCost - 0.3) * 0.5; // Gentle increase
        if (sensoryCost <= 0.7) return 0.1 + (sensoryCost - 0.5) * 1.0; // Moderate increase
        return 0.3 + (sensoryCost - 0.7) * 2.0; // Steep increase for high stimulus
    }

    generateSegmentDetails(coordinates, profile, currentTime) {
        const segments = [];
        const sampleInterval = Math.max(1, Math.floor(coordinates.length / 30));
        
        for (let i = 0; i < coordinates.length; i += sampleInterval) {
            const point = L.latLng(coordinates[i][1], coordinates[i][0]);
            const gridKey = this.getGridKey(point);
            const cellData = this.gridData.get(gridKey);
            
            let stimulusLevel = 'low';
            let details = {};
            
            if (cellData && cellData.reports && cellData.reports.length > 0) {
                const empathy = this.empathyData.get(gridKey) || { likes: 0, dislikes: 0 };
                const segmentCost = this.calculateSegmentSensoryCost(
                    cellData.reports, empathy, profile, currentTime, 'sensory'
                );
                
                if (segmentCost > 0.7) stimulusLevel = 'high';
                else if (segmentCost > 0.4) stimulusLevel = 'medium';
                
                // Aggregate stimulus details for tooltip
                const totals = { noise: 0, light: 0, odor: 0, crowd: 0, count: 0 };
                cellData.reports.forEach(report => {
                    ['noise', 'light', 'odor', 'crowd'].forEach(factor => {
                        if (report[factor] !== undefined) {
                            totals[factor] += report[factor];
                            totals.count++;
                        }
                    });
                });
                
                if (totals.count > 0) {
                    details = {
                        noise: Math.round(totals.noise / totals.count),
                        light: Math.round(totals.light / totals.count),
                        odor: Math.round(totals.odor / totals.count),
                        crowd: Math.round(totals.crowd / totals.count)
                    };
                }
            }
            
            segments.push({
                point,
                stimulusLevel,
                details
            });
        }
        
        return segments;
    }

    displaySensoryAwareRoute(route, routeType) {
        try {
            if (this.currentRoute) {
                this.map.removeLayer(this.currentRoute);
            }

            const coordinates = route.geometry.coordinates;
            const segments = route.segmentDetails || [];
            
            // Create color-coded polyline segments
            const polylines = [];
            const colors = {
                low: '#10b981',    // Green for low stimulus
                medium: '#f59e0b', // Yellow for medium stimulus  
                high: '#ef4444'    // Red for high stimulus
            };
            
            for (let i = 0; i < segments.length - 1; i++) {
                const currentSeg = segments[i];
                const nextSeg = segments[i + 1];
                const color = colors[currentSeg.stimulusLevel] || colors.low;
                
                const segmentLine = L.polyline(
                    [currentSeg.point, nextSeg.point], 
                    {
                        color: color,
                        weight: 6,
                        opacity: 0.8,
                        lineCap: 'round',
                        lineJoin: 'round'
                    }
                );
                
                // Add tooltip with stimulus details
                if (Object.keys(currentSeg.details).length > 0) {
                    const tooltipContent = `
                        <div style="font-size: 12px;">
                            <strong>감각 수준: ${currentSeg.stimulusLevel === 'high' ? '높음' : 
                                                  currentSeg.stimulusLevel === 'medium' ? '보통' : '낮음'}</strong><br>
                            ${currentSeg.details.noise ? `소음: ${currentSeg.details.noise}/10<br>` : ''}
                            ${currentSeg.details.light ? `빛: ${currentSeg.details.light}/10<br>` : ''}
                            ${currentSeg.details.odor ? `냄새: ${currentSeg.details.odor}/10<br>` : ''}
                            ${currentSeg.details.crowd ? `혼잡: ${currentSeg.details.crowd}/10` : ''}
                        </div>
                    `;
                    segmentLine.bindTooltip(tooltipContent);
                }
                
                polylines.push(segmentLine);
            }
            
            // Add all segments to map as a group
            this.currentRoute = L.layerGroup(polylines).addTo(this.map);

            const bounds = L.latLngBounds(coordinates.map(coord => [coord[1], coord[0]]));
            this.map.fitBounds(bounds, { padding: [20, 20] });

            this.showRouteInfo(route, routeType);

        } catch (error) {
            this.handleError('경로 표시 중 오류가 발생했습니다', error);
        }
    }

    async fallbackToSimpleRoute() {
        try {
            this.showToast('백업 경로 계산 시스템을 사용합니다', 'info');
            
            const start = this.routePoints.start;
            const end = this.routePoints.end;
            
            // Simple straight line fallback with basic sensory check
            const fallbackRoute = {
                geometry: {
                    coordinates: [[start.lng, start.lat], [end.lng, end.lat]]
                },
                distance: start.distanceTo(end),
                duration: start.distanceTo(end) / 1.4, // Assume 1.4 m/s walking speed
                provider: 'Fallback',
                sensoryScore: 5.0,  // 수정: 기본 5점으로 fallback 강화
                totalCost: start.distanceTo(end)
            };
            
            this.displayRoute(fallbackRoute, 'fallback');
            document.getElementById('routeStatus').textContent = '단순 경로 생성 완료';
            this.showToast('직선 경로로 대체되었습니다', 'warning');
            
        } catch (error) {
            this.handleError('백업 경로 생성 실패', error);
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
                ${routeType === 'sensory' ? '🌿 감각 친화적 경로' : 
                  routeType === 'fallback' ? '📍 직선 경로' : '⚡ 시간 우선 경로'}
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
            ${routeType !== 'fallback' ? `
                <div class="route-stat" style="margin-top: 8px; text-align: center;">
                    <div class="route-stat-value" style="color: ${sensoryScore > 7 ? '#ef4444' : sensoryScore > 5 ? '#f59e0b' : '#10b981'}">
                        ${(sensoryScore * 10).toFixed(1)}/10
                    </div>
                    <div class="route-stat-label">쾌적도 점수</div>
                </div>
            ` : ''}
            ${sensoryScore > 0.7 ? `
                <div class="sensory-warning">
                    <i class="fas fa-exclamation-triangle"></i>
                    경로에 감각적으로 불편한 구간이 포함되어 있습니다
                </div>
            ` : ''}
        `;
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
        
        this.closeSettingsPanel();
        
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