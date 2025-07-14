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

let clickedLocation = null;
let tempMarker = null;
let markersLayer = L.markerClusterGroup();
map.addLayer(markersLayer);

// --- Route Planning Variables ---
let isPlanningRoute = false;
let startPoint = null;
let endPoint = null;
let startMarker = null;
let endMarker = null;
let routeControl = null;

// --- 2. CORE FUNCTIONS ---

/**
 * Renders saved sensory data markers on the map.
 * Uses Marker Clustering and highlights markers based on user profile.
 */
function renderSavedMarkers() {
  markersLayer.clearLayers();

  const savedData = JSON.parse(localStorage.getItem('sensoryData') || '[]');
  const profile = JSON.parse(localStorage.getItem('sensoryProfile') || '{}');
  const votedItems = JSON.parse(localStorage.getItem('votedSensoryItems') || '[]');

  savedData.forEach(data => {
    // 이전 데이터를 위해 ID가 없으면 생성
    if (!data.id) {
        data.id = new Date(data.timestamp).getTime();
    }
      
    let isHighAlert = false;
    if (Object.keys(profile).length > 0) {
      if (Number(data.light) > Number(profile.lightThreshold) ||
          Number(data.noise) > Number(profile.noiseThreshold) ||
          Number(data.odor) > Number(profile.odorThreshold) ||
          Number(data.crowd) > Number(profile.crowdThreshold)) {
        isHighAlert = true;
      }
    }

    const average = (Number(data.light) + Number(data.noise) + Number(data.odor) + Number(data.crowd)) / 4;
    let color = "green";
    if (average >= 7) color = "red";
    else if (average >= 4) color = "orange";

    const iconHtml = `<img src='https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-${color}.png' style='width: 25px; height: 41px;'>`;

    const marker = L.marker([data.location.lat, data.location.lng], {
      icon: L.divIcon({
        className: isHighAlert ? 'high-alert-marker' : '',
        html: iconHtml,
        iconSize: [25, 41],
        iconAnchor: [12, 41]
      })
    });

    const isVoted = votedItems.includes(data.id);

    const popupContent = `
      <div style="padding: 10px; max-width: 220px;">
        <p><strong>Light:</strong> ${data.light} | <strong>Noise:</strong> ${data.noise}</p>
        <p><strong>Odor:</strong> ${data.odor} | <strong>Crowd:</strong> ${data.crowd}</p>
        <p><strong>Wheelchair Access:</strong> ${data.wheelchair ? 'Yes' : 'No'}</p>
        ${data.memo ? `<p><strong>Memo:</strong> ${data.memo}</p>` : ''}
        
        <div class="vote-container">
          <button class="vote-btn" data-id="${data.id}" data-vote="up" ${isVoted ? 'disabled' : ''}>👍 공감 <span class="upvote-count">${data.upvotes || 0}</span></button>
          <button class="vote-btn" data-id="${data.id}" data-vote="down" ${isVoted ? 'disabled' : ''}>👎 비공감 <span class="downvote-count">${data.downvotes || 0}</span></button>
        </div>

        <p style="border-top: 1px solid #eee; margin-top: 10px; padding-top: 5px;">
          <small>Registered: ${new Date(data.timestamp).toLocaleString()}</small>
        </p>
        <button class="delete-sensory-btn" data-id="${data.id}" style="margin-top:10px; width:100%; padding:5px; background: #dc3545; color:white; border:none; border-radius:5px; cursor:pointer;">🗑 Delete</button>
      </div>
    `;
    marker.bindPopup(popupContent);
    markersLayer.addLayer(marker);
  });
}

/**
 * Shows a temporary toast message at the bottom of the screen.
 * @param {string} msg - The message to display.
 * @param {boolean} isError - Optional flag for error styling.
 */
function showToast(msg, isError = false) {
  const toast = document.getElementById("toast");
  toast.className = "show";
  toast.innerHTML = isError ? `❌ ${msg}` : `💡 ${msg}`;
  toast.style.backgroundColor = isError ? '#c73e3e' : '#323232';
  setTimeout(() => {
      toast.className = toast.className.replace("show", "");
  }, 3000);
}

// --- Route Planning Functions ---

/**
 * Resets all route-related variables and removes layers from the map.
 */
function resetRoutePlanning() {
    isPlanningRoute = false;
    startPoint = null;
    endPoint = null;
    if (startMarker) map.removeLayer(startMarker);
    if (endMarker) map.removeLayer(endMarker);
    if (routeControl) map.removeControl(routeControl);
    startMarker = null;
    endMarker = null;
    routeControl = null;
    document.getElementById('findRouteBtn').textContent = 'Find My Route';
}

/**
 * Handles clicks on the map when in route planning mode.
 * @param {L.latlng} latlng - The location of the click.
 */
function handleRoutePlanningClick(latlng) {
    if (!startPoint) {
        startPoint = latlng;
        startMarker = L.marker(latlng, {
            icon: L.icon({
                iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
                iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
            })
        }).addTo(map).bindPopup('<b>Start Point</b>').openPopup();
        showToast('Start point set. Now click to set your DESTINATION.');
    } else if (!endPoint) {
        endPoint = latlng;
        endMarker = L.marker(latlng, {
            icon: L.icon({
                iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
                iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
            })
        }).addTo(map).bindPopup('<b>Destination</b>').openPopup();
        
        isPlanningRoute = false; // End planning mode immediately
        calculateAndDrawRoute();
    }
}

/**
 * Calculates and displays the route on the map using the start and end points.
 */
function calculateAndDrawRoute() {
    if (!startPoint || !endPoint) return;

    routeControl = L.Routing.control({
        waypoints: [ L.latLng(startPoint.lat, startPoint.lng), L.latLng(endPoint.lat, endPoint.lng) ],
        lineOptions: { styles: [{ color: '#1E90FF', weight: 5, opacity: 0.8 }] },
        routeWhileDragging: false,
        show: false,
        addWaypoints: false,
        createMarker: () => null
    })
    .on('routesfound', function(e) {
        showToast('Route calculated!');
        document.getElementById('findRouteBtn').textContent = 'Clear Route';
    })
    .on('routingerror', function(e) {
        showToast('Error: Could not find a route.', true);
        resetRoutePlanning();
    })
    .addTo(map);
}

/**
 * 신뢰도 투표를 처리하고 UI를 즉시 업데이트합니다.
 * @param {string} id - 투표할 데이터의 고유 ID
 * @param {string} voteType - 'up' 또는 'down'
 */
function handleVote(id, voteType) {
  let votedItems = JSON.parse(localStorage.getItem('votedSensoryItems') || '[]');
  const numericId = Number(id);

  if (votedItems.includes(numericId)) {
    showToast("이미 평가한 항목입니다.", true);
    return;
  }

  let allData = JSON.parse(localStorage.getItem('sensoryData') || '[]');
  const dataIndex = allData.findIndex(d => d.id === numericId);

  if (dataIndex === -1) return;

  const targetData = allData[dataIndex];

  if (voteType === 'up') {
    targetData.upvotes = (targetData.upvotes || 0) + 1;
  } else if (voteType === 'down') {
    targetData.downvotes = (targetData.downvotes || 0) + 1;
  }

  votedItems.push(numericId);
  localStorage.setItem('votedSensoryItems', JSON.stringify(votedItems));
  localStorage.setItem('sensoryData', JSON.stringify(allData));
  
  showToast("평가해 주셔서 감사합니다!");

  const openPopup = map._popup;
  if (openPopup && openPopup.isOpen()) {
    const popupContent = openPopup.getContent();
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = popupContent;
    
    const popupId = tempDiv.querySelector('.vote-btn')?.getAttribute('data-id');
    if (popupId === id) {
        if (voteType === 'up') {
            tempDiv.querySelector('.upvote-count').textContent = targetData.upvotes;
        } else {
            tempDiv.querySelector('.downvote-count').textContent = targetData.downvotes;
        }
        
        tempDiv.querySelectorAll('.vote-btn').forEach(btn => btn.disabled = true);
        openPopup.setContent(tempDiv.innerHTML);
    }
  }
}


// --- 3. EVENT LISTENERS ---

// Map click event: Delegates to route planning or sensory info creation.
map.on('click', function(e) {
  if (isPlanningRoute) {
    handleRoutePlanningClick(e.latlng);
    return;
  }
  
  if (tempMarker) map.removeLayer(tempMarker);
  clickedLocation = e.latlng;
  tempMarker = L.marker(e.latlng, { zIndexOffset: 1000 }).addTo(map);
  tempMarker.bindPopup(`
    <div style="padding: 10px; text-align: center;">
      <p>Register sensory info for this spot?</p>
      <button id="openSensoryBtn" style="width:100%;">Register</button>
    </div>
  `).openPopup();
});

// Listener for dynamically created buttons
document.addEventListener('click', function (e) {
  if (e.target?.id === 'openSensoryBtn') {
    document.getElementById('sensoryModal').style.display = 'block';
  }

  // 삭제 로직: ID 기반으로 수정
  if (e.target?.classList.contains('delete-sensory-btn')) {
    const id = e.target.getAttribute('data-id'); // index 대신 id 사용
    const allData = JSON.parse(localStorage.getItem('sensoryData') || '[]');
    const filteredData = allData.filter(data => data.id !== Number(id)); // ID로 필터링
    localStorage.setItem('sensoryData', JSON.stringify(filteredData));

    if (document.getElementById('showRegisteredToggle').checked) {
      renderSavedMarkers();
    }
    showToast("Deleted!");
    map.closePopup();
  }
    
  // 신뢰도 투표 버튼 로직
  if (e.target?.classList.contains('vote-btn')) {
    const id = e.target.getAttribute('data-id');
    const voteType = e.target.getAttribute('data-vote');
    handleVote(id, voteType);
  }
});

// Toggle to show/hide registered markers
document.getElementById('showRegisteredToggle')?.addEventListener('change', function() {
  if (this.checked) {
    renderSavedMarkers();
  } else {
    markersLayer.clearLayers();
  }
});


// --- 4. MODAL & FORM HANDLING ---

// Sensory Info Form Submission
document.getElementById('sensoryForm')?.addEventListener('submit', function(e) {
  e.preventDefault();
  if (!clickedLocation) return;

  const formData = {
    id: Date.now(), // 고유 ID 생성
    upvotes: 0,     // 신뢰도 데이터 추가
    downvotes: 0,   // 신뢰도 데이터 추가
    light: this.light.value,
    noise: this.noise.value,
    odor: this.odor.value,
    crowd: this.crowd.value,
    wheelchair: this.wheelchair.checked,
    memo: this.memo.value.trim(),
    location: { lat: clickedLocation.lat, lng: clickedLocation.lng },
    timestamp: new Date().toISOString()
  };

  const existingData = JSON.parse(localStorage.getItem('sensoryData') || '[]');
  existingData.push(formData);
  localStorage.setItem('sensoryData', JSON.stringify(existingData));

  if (tempMarker) {
    map.removeLayer(tempMarker);
    tempMarker = null;
  }
  this.reset();
  document.getElementById('sensoryModal').style.display = 'none';
  clickedLocation = null;
  if (document.getElementById('showRegisteredToggle').checked) {
      renderSavedMarkers();
  }
  showToast("Sensory info saved!");
});

// Profile Form Submission
document.getElementById('profileForm')?.addEventListener('submit', function(e) {
  e.preventDefault();
  const profileData = {
    lightThreshold: this.lightThreshold.value,
    noiseThreshold: this.noiseThreshold.value,
    odorThreshold: this.odorThreshold.value,
    crowdThreshold: this.crowdThreshold.value
  };
  localStorage.setItem('sensoryProfile', JSON.stringify(profileData));
  document.getElementById('profileModal').style.display = 'none';
  if (document.getElementById('showRegisteredToggle').checked) {
      renderSavedMarkers();
  }
  showToast("Preferences saved!");
});

// "Find My Route" Button
document.getElementById('findRouteBtn')?.addEventListener('click', function () {
    if (routeControl) {
        resetRoutePlanning();
        showToast('Route cleared.');
        return;
    }
    document.getElementById('profileModal').style.display = 'none';
    resetRoutePlanning();
    isPlanningRoute = true;
    showToast('Click on the map to set your START point.');
});

// --- 5. UI INITIALIZATION & HELPERS ---

// Open/Close Modals
document.getElementById('profileIcon')?.addEventListener('click', () => {
  document.getElementById('profileModal').style.display = 'block';
});
document.getElementById('closeProfileModal')?.addEventListener('click', () => {
  document.getElementById('profileModal').style.display = 'none';
});
document.getElementById('closeSensoryModal')?.addEventListener('click', () => {
  document.getElementById('sensoryModal').style.display = 'none';
});

// On page load
window.addEventListener('load', function() {
  const savedProfile = JSON.parse(localStorage.getItem('sensoryProfile') || '{}');
  const profileForm = document.getElementById('profileForm');
  if (profileForm && Object.keys(savedProfile).length > 0) {
    for (const [key, value] of Object.entries(savedProfile)) {
      if(profileForm[key]) profileForm[key].value = value;
    }
  }

  document.querySelectorAll('input[type="range"]').forEach(slider => {
    const valueSpan = slider.closest('label').querySelector('span');
    if (valueSpan) {
      valueSpan.textContent = slider.value;
      slider.addEventListener('input', () => {
        valueSpan.textContent = slider.value;
      });
    }
  });
});
