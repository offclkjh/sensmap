const map = L.map('map').setView([37.5665, 126.9780], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

let clickedLocation = null;
let tempMarker = null;
let savedMarkers = [];

// 길찾기 관련 전역 변수
let startPoint = null;
let endPoint = null;
let startMarker = null;
let endMarker = null;
let routeControl = null;
let isPlanningRoute = false; // 수동 길찾기 모드 플래그

// ==================================================================
// EVENT LISTENERS & HANDLERS
// ==================================================================

map.on('click', function (e) {
    // 수동 길찾기 모드일 때는 이 로직을 건너뜁니다.
    if (isPlanningRoute) {
        handleManualRoutePlanning(e.latlng);
        return;
    }

    // --- 수정된 부분 ---
    // 일반 모드일 때, 임시 파란 마커의 팝업 내용을 수정합니다.
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

      <button id="openSensoryBtn" style="width:100%; background-color:#6c757d; color:white; border:none;">Register Sensory Info</button>
    </div>
  `).openPopup();
});

document.addEventListener('click', function (e) {
    if (e.target?.id === 'openSensoryBtn') {
        document.getElementById('sensoryModal').style.display = 'block';
    }

    if (e.target?.classList.contains('delete-sensory-btn')) {
        const id = e.target.getAttribute('data-id');
        if (confirm('정말로 이 정보를 삭제하시겠습니까?')) {
            deleteSensoryData(id);
        }
    }

    if (e.target?.classList.contains('vote-btn')) {
        const id = e.target.getAttribute('data-id');
        const voteType = e.target.getAttribute('data-vote');
        handleVote(id, voteType);
    }

    // 팝업 내 길찾기 버튼 클릭 핸들러 (기존 코드로 모두 처리 가능)
    if (e.target?.classList.contains('popup-route-btn')) {
        const lat = parseFloat(e.target.getAttribute('data-lat'));
        const lng = parseFloat(e.target.getAttribute('data-lng'));
        const type = e.target.getAttribute('data-type');
        setRoutePoint(L.latLng(lat, lng), type);
    }
});

document.getElementById('sensoryForm')?.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!clickedLocation) return;

    const formData = {
        id: Date.now(),
        light: this.light.value,
        noise: this.noise.value,
        odor: this.odor.value,
        crowd: this.crowd.value,
        wheelchair: this.wheelchair.checked,
        location: { lat: clickedLocation.lat, lng: clickedLocation.lng },
        timestamp: new Date().toISOString(),
        upvotes: 0,
        downvotes: 0
    };

    const existingData = JSON.parse(localStorage.getItem('sensoryData') || '[]');
    existingData.push(formData);
    localStorage.setItem('sensoryData', JSON.stringify(existingData));

    if (tempMarker) map.removeLayer(tempMarker);
    tempMarker = null;

    this.reset();
    document.getElementById('sensoryModal').style.display = 'none';
    clickedLocation = null;
    showToast("Saved!");

    if (document.getElementById('showRegisteredToggle').checked) {
        renderSavedMarkers();
    }
});

document.getElementById('showRegisteredToggle')?.addEventListener('change', function () {
    if (this.checked) {
        renderSavedMarkers();
    } else {
        savedMarkers.forEach(marker => map.removeLayer(marker));
        savedMarkers = [];
    }
});

// ==================================================================
// DATA & RENDERING FUNCTIONS
// ==================================================================

function renderSavedMarkers() {
    savedMarkers.forEach(marker => map.removeLayer(marker));
    savedMarkers = [];

    const savedData = JSON.parse(localStorage.getItem('sensoryData') || '[]');
    const votedItems = JSON.parse(localStorage.getItem('votedSensoryItems') || '[]');

    savedData.forEach(data => {
        if (!data.id) data.id = new Date(data.timestamp).getTime();

        const average = (Number(data.light) + Number(data.noise) + Number(data.odor) + Number(data.crowd)) / 4;
        let color = "green";
        if (average >= 7) color = "red";
        else if (average >= 4) color = "orange";

        const iconUrl = `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-${color}.png`;
        const marker = L.marker([data.location.lat, data.location.lng], {
            icon: L.icon({
                iconUrl,
                iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34],
                shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png', shadowSize: [41, 41]
            }),
        }).addTo(map);

        const isVoted = votedItems.includes(data.id);
        const popupContent = `
      <div style="padding: 10px; max-width:200px;">
        <p><strong>Light:</strong> ${data.light}, <strong>Noise:</strong> ${data.noise}, <strong>Odor:</strong> ${data.odor}, <strong>Crowd:</strong> ${data.crowd}</p>
        <p style="font-size:12px; color:#777;">Registered: ${new Date(data.timestamp).toLocaleString()}</p>
        
        <div class="route-btn-group">
            <button class="popup-route-btn" data-type="start" data-lat="${data.location.lat}" data-lng="${data.location.lng}">Set as Start</button>
            <button class="popup-route-btn" data-type="end" data-lat="${data.location.lat}" data-lng="${data.location.lng}">Set as End</button>
        </div>
        
        <div class="vote-container">
          <small>Is this info helpful?</small><br>
          <button class="vote-btn" data-id="${data.id}" data-vote="up" ${isVoted ? 'disabled' : ''}>👍 <span class="upvote-count">${data.upvotes || 0}</span></button>
          <button class="vote-btn" data-id="${data.id}" data-vote="down" ${isVoted ? 'disabled' : ''}>👎 <span class="downvote-count">${data.downvotes || 0}</span></button>
        </div>
        <button class="delete-sensory-btn" data-id="${data.id}" style="width:100%; margin-top:10px;">🗑 Delete</button>
      </div>
    `;
        marker.bindPopup(popupContent);
        savedMarkers.push(marker);
    });
}

function deleteSensoryData(id) {
    let allData = JSON.parse(localStorage.getItem('sensoryData') || '[]');
    const filteredData = allData.filter(data => data.id !== Number(id));
    localStorage.setItem('sensoryData', JSON.stringify(filteredData));

    renderSavedMarkers();
    showToast("Deleted!");
    map.closePopup();
}

function handleVote(id, voteType) {
    let votedItems = JSON.parse(localStorage.getItem('votedSensoryItems') || '[]');
    const numericId = Number(id);

    if (votedItems.includes(numericId)) {
        showToast("You've already rated this.");
        return;
    }
    let allData = JSON.parse(localStorage.getItem('sensoryData') || '[]');
    const dataIndex = allData.findIndex(d => d.id === numericId);
    if (dataIndex === -1) return;
    const targetData = allData[dataIndex];
    if (voteType === 'up') targetData.upvotes = (targetData.upvotes || 0) + 1;
    else targetData.downvotes = (targetData.downvotes || 0) + 1;

    votedItems.push(numericId);
    localStorage.setItem('votedSensoryItems', JSON.stringify(votedItems));
    localStorage.setItem('sensoryData', JSON.stringify(allData));
    showToast("Thank you for your feedback!");

    const openPopup = map._popup;
    if (openPopup && openPopup.isOpen()) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = openPopup.getContent();
        const popupId = tempDiv.querySelector('.vote-btn')?.getAttribute('data-id');
        if (popupId === id) {
            if (voteType === 'up') tempDiv.querySelector('.upvote-count').textContent = targetData.upvotes;
            else tempDiv.querySelector('.downvote-count').textContent = targetData.downvotes;
            tempDiv.querySelectorAll('.vote-btn').forEach(btn => btn.disabled = true);
            openPopup.setContent(tempDiv.innerHTML);
        }
    }
}

// ==================================================================
// ROUTE PLANNING FUNCTIONS
// ==================================================================

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
    } else { // type === 'end'
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

function calculateAndDrawRoute() {
    if (!startPoint || !endPoint) {
        alert("Please set both start and end points first.");
        return;
    }
    if (routeControl) map.removeControl(routeControl);

    routeControl = L.Routing.control({
        waypoints: [startPoint, endPoint],
        lineOptions: { styles: [{ color: '#1E90FF', weight: 5, opacity: 0.7 }] },
        createMarker: () => null,
        show: false
    }).addTo(map);
    document.getElementById('findRouteBtn').textContent = 'Clear Route';
}

function resetRoutePlanning() {
    if (routeControl) map.removeControl(routeControl);
    if (startMarker) map.removeLayer(startMarker);
    if (endMarker) map.removeLayer(endMarker);
    startPoint = null;
    endPoint = null;
    startMarker = null;
    endMarker = null;
    routeControl = null;
    isPlanningRoute = false;
    document.getElementById('findRouteBtn').textContent = 'Find My Route';
    showToast('Route cleared.');
}

// ==================================================================
// UI & MODAL HANDLING
// ==================================================================

document.getElementById('profileIcon')?.addEventListener('click', function () {
    document.getElementById('profileModal').style.display = 'block';
});
document.getElementById('closeProfileModal')?.addEventListener('click', function () {
    document.getElementById('profileModal').style.display = 'none';
});
document.getElementById('closeSensoryModal')?.addEventListener('click', function () {
    document.getElementById('sensoryModal').style.display = 'none';
});

document.getElementById('profileForm')?.addEventListener('submit', function (e) {
    e.preventDefault();
    const profileData = {
        lightThreshold: this.lightThreshold.value,
        noiseThreshold: this.noiseThreshold.value,
        odorThreshold: this.odorThreshold.value,
        crowdThreshold: this.crowdThreshold.value
    };
    localStorage.setItem('sensoryProfile', JSON.stringify(profileData));
    document.getElementById('profileModal').style.display = 'none';
    showToast("Preferences saved!");
});

document.getElementById('findRouteBtn')?.addEventListener('click', function () {
    if (routeControl) {
        resetRoutePlanning();
    } else {
        isPlanningRoute = true;
        document.getElementById('profileModal').style.display = 'none';
        showToast('Click on the map to set START point.');
    }
});

window.addEventListener('load', function () {
    const savedProfile = JSON.parse(localStorage.getItem('sensoryProfile') || '{}');
    const profileForm = document.getElementById('profileForm');
    if (profileForm && Object.keys(savedProfile).length > 0) {
        for (const [key, value] of Object.entries(savedProfile)) {
            if (profileForm[key]) profileForm[key].value = value;
        }
    }

    const sliders = document.querySelectorAll('input[type="range"]');
    sliders.forEach(slider => {
        let span = slider.nextElementSibling;
        if (!span || span.tagName !== 'SPAN') {
            span = document.createElement('span');
            slider.insertAdjacentElement('afterend', span);
        }
        span.textContent = slider.value;
        span.style.marginLeft = '8px';
        slider.addEventListener('input', () => {
            span.textContent = slider.value;
        });
    });
});

function showToast(msg) {
    const toast = document.getElementById("toast");
    toast.textContent = msg;
    toast.className = "show";
    setTimeout(() => toast.className = toast.className.replace("show", ""), 2500);
} {

}
