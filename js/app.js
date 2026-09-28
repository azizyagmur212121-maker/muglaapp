import { db } from "./firebase.js";
import { doc, collection, query, where, getDocs, addDoc, updateDoc, getDoc } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const loader = document.getElementById('loader');
const loaderText = document.getElementById('loader-text');
const errorScreen = document.getElementById('error-screen');
const portalContainer = document.getElementById('portal-container');
const businessesGrid = document.getElementById('businesses-grid');
const categoryButtons = document.querySelectorAll('.cat-btn');

const appContainer = document.getElementById('app-container');
const businessLogoEl = document.getElementById('business-logo');
const businessNameEl = document.getElementById('business-name');
const businessAddressEl = document.getElementById('business-address');
const directionBtn = document.getElementById('direction-btn');

const servicesGrid = document.getElementById('services-grid');
const stepPersonnel = document.getElementById('step-personnel');
const personnelGrid = document.getElementById('personnel-grid');
const step2 = document.getElementById('step-2');
const bookingDateInput = document.getElementById('booking-date');
const slotsContainer = document.getElementById('slots-container');

// VİTRİN İÇİN GLOBAL DEĞİŞKENLER
let targetBusinessId = null;
let businessSettings = null;
let selectedService = null;
let selectedPersonnel = null;
let allBusinesses = [];

// SweetAlert Açık Tema
const Toast = Swal.mixin({
    background: '#ffffff', color: '#1e293b', confirmButtonColor: '#0ea5e9', cancelButtonColor: '#ef4444'
});

document.addEventListener("DOMContentLoaded", async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const slug = urlParams.get('isletme');

    if (slug) {
        loaderText.textContent = "İşletme bilgileri yükleniyor...";
        await loadBusinessVitrin(slug);

        // Vitrine girdiğinde geçmiş randevuyu sor
        setTimeout(() => checkPastAppointmentsForReview(), 1500);
    } else {
        loaderText.textContent = "İşletmeler yükleniyor...";
        await loadMainPortal();

        // Ana Portala girdiğinde de geçmiş randevuyu sor
        setTimeout(() => checkPastAppointmentsForReview(), 1500);
    }
});

// --- 1. PORTAL EKRANI VE BAYESIAN SIRALAMA ---
async function loadMainPortal() {
    try {
        const q = query(collection(db, "businesses"));
        const snapshot = await getDocs(q);

        allBusinesses = [];
        const fetchPromises = [];

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            if (data.settings && data.settings.schedule && data.businessName !== "Yeni İşletme") {
                const bizObj = { id: docSnap.id, ...data, avgRating: 0, reviewCount: 0, sortScore: 0 };
                allBusinesses.push(bizObj);

                const revPromise = getDocs(query(collection(db, "businesses", docSnap.id, "reviews"))).then(revSnap => {
                    if (!revSnap.empty) {
                        let total = 0;
                        revSnap.forEach(r => total += r.data().rating);
                        bizObj.reviewCount = revSnap.size;
                        bizObj.avgRating = total / revSnap.size;

                        const countBonus = Math.min(bizObj.reviewCount * 0.05, 1.5);
                        bizObj.sortScore = bizObj.avgRating + countBonus;
                    }
                });
                fetchPromises.push(revPromise);
            }
        });

        await Promise.all(fetchPromises);
        allBusinesses.sort((a, b) => b.sortScore - a.sortScore);

        renderBusinessesGrid(allBusinesses);
        loader.classList.add('hidden');
        portalContainer.classList.remove('hidden');
    } catch (error) {
        console.error(error);
        showError("İşletmeler yüklenirken bir hata oluştu.");
    }
}

function renderBusinessesGrid(businessArray) {
    businessesGrid.innerHTML = '';
    if (businessArray.length === 0) { businessesGrid.innerHTML = '<p class="empty-text">Bu kategoride henüz işletme bulunmuyor.</p>'; return; }

    businessArray.forEach(biz => {
        const catName = biz.category === 'diyetisyen' ? 'Diyetisyen' : (biz.category === 'guzellik' ? 'Güzellik Merkezi' : (biz.category === 'kuafor' ? 'Kuaför' : 'İşletme'));
        const logoHtml = biz.logoBase64 ? `<div class="card-logo" style="background-image: url(${biz.logoBase64});"></div>` : `<div class="card-logo">${biz.businessName.charAt(0).toUpperCase()}</div>`;
        const businessLink = `index.html?isletme=${biz.slug || biz.id}`;

        let ratingHtml = '';
        if (biz.reviewCount > 0) {
            ratingHtml = `<div class="card-rating">⭐ ${biz.avgRating.toFixed(1)} <span style="font-size:0.7rem; color:#b45309; font-weight:normal;">(${biz.reviewCount})</span></div>`;
        }

        const card = document.createElement('div');
        card.className = 'business-card';
        card.onclick = () => window.location.href = businessLink;
        card.innerHTML = `
            ${ratingHtml}
            ${logoHtml}
            <div class="card-category">${catName}</div>
            <h3 class="card-name">${biz.businessName}</h3>
            <p class="card-address">📍 ${biz.address || "Muğla"}</p>
            <button class="card-btn">Randevu Al</button>
        `;
        businessesGrid.appendChild(card);
    });
}

categoryButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
        categoryButtons.forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        const filter = e.target.getAttribute('data-filter');
        if (filter === 'all') { renderBusinessesGrid(allBusinesses); }
        else { renderBusinessesGrid(allBusinesses.filter(biz => biz.category === filter)); }
    });
});

// --- 2. İŞLETME VİTRİNİ (V2 RANDEVU ALMA & YORUMLAR & GALERİ) ---
async function loadBusinessVitrin(slug) {
    try {
        const q = query(collection(db, "businesses"), where("slug", "==", slug));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            const fallbackSnap = await getDocs(query(collection(db, "businesses"), where("__name__", "==", slug)));
            if (fallbackSnap.empty) { showError("Böyle bir işletme sistemimizde bulunamadı."); return; }
            else { await setupVitrinUI(fallbackSnap.docs[0]); }
        } else { await setupVitrinUI(querySnapshot.docs[0]); }
    } catch (error) {
        console.error(error);
        showError("Sunucu bağlantısında bir hata oluştu.");
    }
}

async function setupVitrinUI(businessDoc) {
    targetBusinessId = businessDoc.id;
    const data = businessDoc.data();
    businessSettings = data.settings;

    if (!businessSettings || !businessSettings.schedule) { showError("Bu işletme henüz randevu ayarlarını tamamlamamış."); return; }

    businessNameEl.textContent = data.businessName;
    businessAddressEl.textContent = data.address || "Muğla";
    if (data.logoBase64) { businessLogoEl.style.backgroundImage = `url(${data.logoBase64})`; businessLogoEl.textContent = ""; }
    else { businessLogoEl.textContent = data.businessName.charAt(0).toUpperCase(); }

    if (data.lat && data.lng && directionBtn) {
        directionBtn.classList.remove('hidden');
        directionBtn.onclick = () => {
            const mapUrl = `https://www.google.com/maps/dir/?api=1&destination=${data.lat},${data.lng}`;
            window.open(mapUrl, '_blank');
        };
    } else if (directionBtn) {
        directionBtn.classList.add('hidden');
    }

    await loadVitrinReviews();
    await loadVitrinGallery();

    renderServices();
    loader.classList.add('hidden'); appContainer.classList.remove('hidden');
}

async function loadVitrinGallery() {
    const gallerySection = document.getElementById('step-gallery');
    const sliderContainer = document.getElementById('vitrin-gallery-slider');
    if (!gallerySection || !sliderContainer) return;

    try {
        const q = query(collection(db, "businesses", targetBusinessId, "gallery"));
        const snap = await getDocs(q);

        if (snap.empty) {
            gallerySection.classList.add('hidden');
            return;
        }

        let galleryHTML = '';
        const galleryData = [];
        snap.forEach(d => { galleryData.push(d.data()); });
        galleryData.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        galleryData.forEach(img => {
            galleryHTML += `<div class="gallery-slider-item" style="background-image: url('${img.image}');" onclick="openLightbox('${img.image}')"></div>`;
        });

        sliderContainer.innerHTML = galleryHTML;
        gallerySection.classList.remove('hidden');

    } catch (err) { console.error("Galeri çekilirken hata:", err); }
}

window.openLightbox = (imgSrc) => {
    const overlay = document.getElementById('lightbox-overlay');
    const imgEl = document.getElementById('lightbox-img');
    if (overlay && imgEl) {
        imgEl.src = imgSrc;
        overlay.classList.remove('hidden');
    }
};

window.closeLightbox = () => {
    const overlay = document.getElementById('lightbox-overlay');
    if (overlay) {
        overlay.classList.add('hidden');
        document.getElementById('lightbox-img').src = '';
    }
};

function renderServices() {
    servicesGrid.innerHTML = '';
    let services = businessSettings.services || [];
    if (services.length === 0) { services = [{ name: "Genel Randevu", duration: businessSettings.appointmentDuration || 30, price: 0 }]; }

    services.forEach((srv) => {
        const btn = document.createElement('div'); btn.className = 'service-btn';
        let priceHtml = srv.price > 0 ? `<span class="service-price">${srv.price} ₺</span>` : `<span class="service-price" style="color:#64748b; font-size:0.9rem;">Ücretsiz</span>`;

        btn.innerHTML = `
            <div class="service-left">
                <span class="service-name">${srv.name}</span>
                <span class="service-duration">⏱️ ${srv.duration} Dakika</span>
            </div>
            ${priceHtml}
        `;
        btn.addEventListener('click', () => selectService(srv, btn));
        servicesGrid.appendChild(btn);
    });
}

function selectService(service, btnElement) {
    document.querySelectorAll('.service-btn').forEach(b => b.classList.remove('selected'));
    btnElement.classList.add('selected');
    selectedService = service;

    renderPersonnelForService(service.name);
    stepPersonnel.scrollIntoView({ behavior: 'smooth' });
}

function renderPersonnelForService(serviceName) {
    stepPersonnel.classList.remove('hidden');
    personnelGrid.innerHTML = '';
    step2.classList.add('hidden');

    let availablePersonnel = [];
    const allPersonnel = businessSettings.personnel || [];

    if (allPersonnel.length > 0) {
        availablePersonnel = allPersonnel.filter(p => p.services && p.services.includes(serviceName));
    }

    if (availablePersonnel.length === 0) {
        selectedPersonnel = "all";
        showDateSelection();
        return;
    }

    const anyBtn = document.createElement('div');
    anyBtn.className = 'service-btn';
    anyBtn.innerHTML = `<span class="service-name">👥 Herhangi Biri (Fark Etmez)</span>`;
    anyBtn.addEventListener('click', () => {
        document.querySelectorAll('#personnel-grid .service-btn').forEach(b => b.classList.remove('selected'));
        anyBtn.classList.add('selected');
        selectedPersonnel = "all";
        showDateSelection();
    });
    personnelGrid.appendChild(anyBtn);

    availablePersonnel.forEach(p => {
        const pBtn = document.createElement('div');
        pBtn.className = 'service-btn';
        pBtn.innerHTML = `<span class="service-name">👤 ${p.name}</span>`;
        pBtn.addEventListener('click', () => {
            document.querySelectorAll('#personnel-grid .service-btn').forEach(b => b.classList.remove('selected'));
            pBtn.classList.add('selected');
            selectedPersonnel = p.name;
            showDateSelection();
        });
        personnelGrid.appendChild(pBtn);
    });
}

function showDateSelection() {
    step2.classList.remove('hidden');
    if (!bookingDateInput.value) {
        const today = new Date();
        bookingDateInput.value = new Date(today.getTime() - (today.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
    }
    generateAvailableSlots();
    setTimeout(() => step2.scrollIntoView({ behavior: 'smooth' }), 100);
}

bookingDateInput.addEventListener('change', generateAvailableSlots);

function timeToMinutes(timeStr) { const [hours, minutes] = timeStr.split(':').map(Number); return (hours * 60) + minutes; }
function minutesToTime(minutesTotal) { const hours = Math.floor(minutesTotal / 60).toString().padStart(2, '0'); const minutes = (minutesTotal % 60).toString().padStart(2, '0'); return `${hours}:${minutes}`; }
function checkBreakOverlap(slotStartMin, duration, breaks) { if (!breaks || breaks.length === 0) return false; const slotEndMin = slotStartMin + duration; for (let br of breaks) { if (slotStartMin < timeToMinutes(br.end) && slotEndMin > timeToMinutes(br.start)) return true; } return false; }

async function generateAvailableSlots() {
    if (!selectedService || !targetBusinessId || !selectedPersonnel) return;
    const selectedDateStr = bookingDateInput.value;
    slotsContainer.innerHTML = '<p class="empty-text">Saatler kontrol ediliyor...</p>';

    if (businessSettings.closedDates && businessSettings.closedDates.includes(selectedDateStr)) { slotsContainer.innerHTML = '<p class="empty-text" style="color:#ef4444; font-weight:bold;">İşletme bu tarihte kapalıdır.</p>'; return; }

    try {
        const [yyyy, mm, dd] = selectedDateStr.split('-'); const dateObj = new Date(yyyy, mm - 1, dd);
        const dayMap = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const selectedDayId = dayMap[dateObj.getDay()];

        const gridStep = businessSettings.appointmentDuration || 30;
        const serviceDuration = selectedService.duration;

        let daySettings;
        let activeCapacity;
        const allPersonnel = businessSettings.personnel || [];

        if (selectedPersonnel !== "all") {
            const pObj = allPersonnel.find(p => p.name === selectedPersonnel);
            daySettings = pObj ? pObj.schedule[selectedDayId] : businessSettings.schedule[selectedDayId];
            activeCapacity = 1;
        } else {
            daySettings = businessSettings.schedule[selectedDayId];
            activeCapacity = allPersonnel.length > 0 ? allPersonnel.filter(p => p.schedule[selectedDayId].active).length : (businessSettings.capacity || 1);
            if (activeCapacity === 0) activeCapacity = 1;
        }

        if (!daySettings || !daySettings.active) {
            slotsContainer.innerHTML = `<p class="empty-text" style="color:#ef4444; font-weight:bold;">${selectedPersonnel !== 'all' ? selectedPersonnel + ' bu gün çalışmıyor.' : 'İşletme bu gün hizmet vermemektedir.'}</p>`;
            return;
        }

        const bookedIntervals = [];
        const q = query(collection(db, "businesses", targetBusinessId, "appointments"), where("date", "==", selectedDateStr), where("status", "in", ["confirmed", "pending"]));
        const querySnapshot = await getDocs(q);

        querySnapshot.forEach(doc => {
            const data = doc.data();
            if (!data.date) return;
            const startMin = timeToMinutes(data.time);
            const endMin = data.endTime ? timeToMinutes(data.endTime) : startMin + gridStep;
            bookedIntervals.push({ startMin, endMin, personnelName: data.personnelName });
        });

        slotsContainer.innerHTML = '';
        let currentTimeMinutes = timeToMinutes(daySettings.start);
        const endTimeMinutes = timeToMinutes(daySettings.end);
        let hasSlotsToShow = false;

        const now = new Date(); const localNowStr = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
        const currentMinutesNow = (now.getHours() * 60) + now.getMinutes();

        while (currentTimeMinutes + serviceDuration <= endTimeMinutes) {
            if (selectedDateStr === localNowStr && currentTimeMinutes <= currentMinutesNow) { currentTimeMinutes += gridStep; continue; }

            const slotStartStr = minutesToTime(currentTimeMinutes);
            const isBreak = checkBreakOverlap(currentTimeMinutes, serviceDuration, daySettings.breaks);

            if (!isBreak) {
                hasSlotsToShow = true;
                let overlapCount = 0;

                for (let b of bookedIntervals) {
                    if (currentTimeMinutes < b.endMin && (currentTimeMinutes + serviceDuration) > b.startMin) {
                        if (selectedPersonnel !== "all") {
                            if (b.personnelName === selectedPersonnel) overlapCount++;
                        } else {
                            overlapCount++;
                        }
                    }
                }

                if (overlapCount < activeCapacity) {
                    slotsContainer.insertAdjacentHTML('beforeend', `<div class="time-slot" onclick="openBookingForm('${selectedDateStr}', '${slotStartStr}')">${slotStartStr}</div>`);
                } else {
                    slotsContainer.insertAdjacentHTML('beforeend', `<div class="time-slot disabled"><span class="slot-time-strike">${slotStartStr}</span><span class="slot-dolu">Dolu</span></div>`);
                }
            }
            currentTimeMinutes += gridStep;
        }
        if (!hasSlotsToShow) { slotsContainer.innerHTML = '<p class="empty-text">Bu tarihte uygun saat bulunmamaktadır.</p>'; }
    } catch (err) { console.error(err); slotsContainer.innerHTML = '<p class="empty-text">Hata oluştu.</p>'; }
}

function generateTicketId() { return '#' + Math.random().toString(36).substr(2, 5).toUpperCase(); }

function saveTicketToDevice(ticketId, serviceName, dateStr) {
    let myTickets = JSON.parse(localStorage.getItem('muglaapp_tickets')) || [];
    myTickets.push({ ticketId: ticketId, businessId: targetBusinessId, serviceName: serviceName, date: dateStr });
    localStorage.setItem('muglaapp_tickets', JSON.stringify(myTickets));
}

window.copyTicketToClipboard = (ticketId) => {
    navigator.clipboard.writeText(ticketId).then(() => {
        const btn = document.getElementById('copy-ticket-btn');
        if (btn) { btn.innerHTML = "✅ Kopyalandı"; setTimeout(() => btn.innerHTML = "📋 Kopyala", 2000); }
    });
};

window.openBookingForm = async (date, time) => {
    const endTimeStr = minutesToTime(timeToMinutes(time) + selectedService.duration);

    let priceInfo = selectedService.price > 0 ? `<br><strong style="color:#10b981; font-size:1.2rem;">${selectedService.price} ₺</strong>` : '';
    let personnelInfo = selectedPersonnel !== 'all' ? ` | 👤 ${selectedPersonnel}` : '';

    const { value: formValues } = await Swal.fire({
        title: 'Randevu Bilgileri',
        html: `
            <div style="background:#f8fafc; border: 1px solid #e2e8f0; padding:15px; border-radius:10px; margin-bottom:20px; text-align:left; box-shadow:0 2px 5px rgba(0,0,0,0.05);">
                <strong style="color:#0ea5e9; font-size:1.1rem; display:block; margin-bottom:5px;">🏷️ ${selectedService.name} ${personnelInfo}</strong>
                <span style="color:#64748b; font-size:0.9rem; font-weight:600;">📅 ${new Date(date).toLocaleDateString('tr-TR')} &nbsp;|&nbsp; ⏰ ${time} - ${endTimeStr}</span>
                ${priceInfo}
            </div>
            
            <input id="customer-name" class="modern-input" placeholder="Adınız Soyadınız" style="background:#fff; margin-bottom: 15px;" required>
            
            <div class="swal-phone-group">
                <span class="swal-phone-prefix">+90</span>
                <input id="customer-phone" class="swal-phone-input" type="tel" placeholder="5XX XXX XX XX" maxlength="10">
            </div>
            
            <textarea id="customer-note" class="modern-input" placeholder="Varsa İşletmeye Notunuz" rows="2" style="background:#fff; resize:none; margin-bottom:0;"></textarea>
        `,
        focusConfirm: false, showCancelButton: true, confirmButtonText: 'Randevuyu Tamamla', cancelButtonText: 'İptal',
        preConfirm: () => {
            const name = document.getElementById('customer-name').value; const phoneRaw = document.getElementById('customer-phone').value; const note = document.getElementById('customer-note').value;
            if (!name) { Swal.showValidationMessage('Ad soyad zorunludur!'); return false; } if (phoneRaw.length < 10) { Swal.showValidationMessage('Geçerli telefon numarası girin!'); return false; }
            return { name, phone: "+90" + phoneRaw.replace(/\s+/g, ''), note };
        }
    });

    if (formValues) {
        Swal.fire({ title: 'İşleniyor...', didOpen: () => { Swal.showLoading(); } });
        try {
            const ticketId = generateTicketId();
            await addDoc(collection(db, "businesses", targetBusinessId, "appointments"), {
                date: date, time: time, endTime: endTimeStr,
                clientName: formValues.name, clientPhone: formValues.phone, note: formValues.note,
                serviceName: selectedService.name, duration: selectedService.duration,
                personnelName: selectedPersonnel === 'all' ? '' : selectedPersonnel,
                status: 'pending', ticketId: ticketId, reviewed: false, createdAt: new Date()
            });

            saveTicketToDevice(ticketId, selectedService.name, date);

            Swal.fire({
                title: 'Randevunuz Alındı! 🎉',
                html: `
                    <div style="background:#f0f9ff; padding:25px; border-radius:12px; margin:20px 0; border:1px dashed #7dd3fc;">
                        <p style="color:#0284c7; font-size:0.9rem; font-weight:700; margin-bottom:8px; text-transform:uppercase;">Takip Numaranız (Fiş)</p>
                        <h2 style="color:#0369a1; font-size: 2.2rem; letter-spacing:3px; margin-bottom:15px; font-weight:900;">${ticketId}</h2>
                        <button id="copy-ticket-btn" onclick="copyTicketToClipboard('${ticketId}')" style="background:#ffffff; color:#0ea5e9; border:1px solid #0ea5e9; padding:8px 20px; border-radius:8px; font-size:0.9rem; cursor:pointer; font-weight:bold; transition:0.2s;">📋 Kopyala</button>
                    </div>
                    <p style="color:#64748b; font-size:0.95rem; line-height:1.5; font-weight:500;">İşletme yetkilisi randevunuzu inceleyecektir. Fiş numaranız bu cihaza kaydedildi. <b>Fiş Sorgula</b> butonundan durumu kontrol edebilirsiniz.</p>
                `,
                icon: 'success', showConfirmButton: true, confirmButtonText: 'Tamam', allowOutsideClick: false
            });

            generateAvailableSlots();
        } catch (error) { Toast.fire({ icon: 'error', title: 'Bir hata oluştu.' }); }
    }
};

window.fillTicketInput = (tId) => { document.getElementById('swal-ticket').value = tId; };

window.queryAppointment = async () => {
    let allTickets = JSON.parse(localStorage.getItem('muglaapp_tickets')) || [];
    let localTickets = allTickets.filter(t => t.businessId === targetBusinessId);

    let localTicketsHTML = '';
    if (localTickets.length > 0) {
        localTickets.reverse();
        const itemsHtml = localTickets.map(t => `
            <div class="local-ticket-item" onclick="fillTicketInput('${t.ticketId}')">
                <span class="local-ticket-id">${t.ticketId}</span>
                <div class="local-ticket-info">
                    <div style="color:var(--text-main); font-weight:700; margin-bottom:3px;">${t.serviceName}</div>
                    <div>${new Date(t.date).toLocaleDateString('tr-TR')}</div>
                </div>
            </div>
        `).join('');

        localTicketsHTML = `
            <div class="local-tickets-container">
                <div class="local-tickets-title">📱 Bu Cihazdaki Randevularım</div>
                <div class="local-tickets-list">${itemsHtml}</div>
            </div>
        `;
    }

    const { value: ticketId } = await Swal.fire({
        title: 'Randevu Sorgula',
        html: `
            <input id="swal-ticket" class="modern-input" placeholder="Fiş No (Örn: #X7KL)" style="background:#fff; text-transform:uppercase; text-align:center; font-weight:bold; letter-spacing:2px; font-size:1.2rem; margin-top:15px; margin-bottom:0;">
            ${localTicketsHTML}
        `,
        focusConfirm: false, showCancelButton: true, confirmButtonText: 'Sorgula', cancelButtonText: 'İptal',
        preConfirm: () => {
            const ticket = document.getElementById('swal-ticket').value.toUpperCase().trim();
            if (!ticket) { Swal.showValidationMessage('Fiş numarası giriniz veya listeden seçiniz!'); return false; }
            return ticket;
        }
    });

    if (ticketId) {
        Swal.fire({ title: 'Aranıyor...', didOpen: () => Swal.showLoading() });
        try {
            const q = query(collection(db, "businesses", targetBusinessId, "appointments"), where("ticketId", "==", ticketId));
            const snap = await getDocs(q);

            if (snap.empty) {
                Swal.fire({ icon: 'error', title: 'Bulunamadı', text: 'Bu işletmeye ait böyle bir fiş numarası sistemde yok.' });
            } else {
                const appDoc = snap.docs[0];
                const appData = appDoc.data();

                let statusText = appData.status === 'confirmed' ? '✅ Onaylandı' : (appData.status === 'pending' ? '⏳ Onay Bekliyor' : '❌ İptal Edildi');
                let statusColor = appData.status === 'confirmed' ? '#10b981' : (appData.status === 'pending' ? '#f59e0b' : '#ef4444');

                const appDateObj = new Date(`${appData.date}T${appData.time}`);
                const isPast = appDateObj < new Date();
                let reviewBtnHtml = '';

                // Burada da openReviewModal için parametreleri güncelledim
                if (appData.status === 'confirmed' && isPast && !appData.reviewed) {
                    reviewBtnHtml = `<button onclick="openReviewModal('${appDoc.id}', '${appData.personnelName || ''}', '${appData.clientName}', '${targetBusinessId}', '${ticketId}')" style="margin-top:15px; width:100%; background:#f59e0b; color:#fff; border:none; padding:12px; border-radius:8px; font-weight:bold; cursor:pointer; font-size:1rem; box-shadow:0 4px 10px rgba(245,158,11,0.3);">⭐ Hizmeti Değerlendir</button>`;
                } else if (appData.reviewed) {
                    reviewBtnHtml = `<p style="margin-top:15px; color:#10b981; font-weight:bold; font-size:0.9rem;">✅ Bu hizmeti değerlendirdiniz. Teşekkürler!</p>`;
                }

                Swal.fire({
                    title: 'Randevu Durumu',
                    html: `
                        <div style="text-align:left; background:#f8fafc; padding:20px; border-radius:10px; border:1px solid #e2e8f0; margin-top:15px;">
                            <p style="color:#64748b; font-size:0.85rem; margin-bottom:3px; font-weight:700;">Hizmet</p>
                            <p style="color:#1e293b; font-size:1.1rem; font-weight:800; margin-bottom:15px;">${appData.serviceName} ${appData.personnelName ? '(👤 ' + appData.personnelName + ')' : ''}</p>
                            
                            <p style="color:#64748b; font-size:0.85rem; margin-bottom:3px; font-weight:700;">Tarih / Saat</p>
                            <p style="color:#1e293b; font-size:1.1rem; font-weight:800; margin-bottom:15px;">📅 ${appData.date} &nbsp;|&nbsp; ⏰ ${appData.time}</p>
                            
                            <div style="margin-top:20px; padding:15px; border-radius:8px; background:#ffffff; text-align:center; border:2px solid ${statusColor}; box-shadow:0 4px 10px ${statusColor}30;">
                                <strong style="color:${statusColor}; font-size:1.3rem;">${statusText}</strong>
                            </div>
                            ${reviewBtnHtml}
                        </div>
                    `,
                    showConfirmButton: false, showCloseButton: true
                });
            }
        } catch (e) { Swal.fire({ icon: 'error', title: 'Hata', text: 'Sorgulama işlemi başarısız oldu.' }); }
    }
};

// ==========================================
// YENİ, DAHA AKILLI VE HATASIZ YORUM SORMA ZEKASI
// ==========================================
async function checkPastAppointmentsForReview() {
    let allTickets = JSON.parse(localStorage.getItem('muglaapp_tickets')) || [];
    if (allTickets.length === 0) return;

    let popupShown = false; // Bir girişte sadece 1 kere sorması için

    for (let t of allTickets) {
        if (t.reviewedLocal || popupShown) continue;
        if (!t.businessId || !t.ticketId) continue;

        try {
            // Müşterinin cihazındaki bileti veritabanından buluyoruz
            const q = query(collection(db, "businesses", t.businessId, "appointments"), where("ticketId", "==", t.ticketId));
            const snap = await getDocs(q);

            if (!snap.empty) {
                const appDoc = snap.docs[0];
                const appData = appDoc.data();

                // Zaten yorumlandıysa yerelde de işaretle ve atla
                if (appData.reviewed) {
                    t.reviewedLocal = true;
                    localStorage.setItem('muglaapp_tickets', JSON.stringify(allTickets));
                    continue;
                }

                // Randevu onaylanmış mı?
                if (appData.status === 'confirmed') {

                    // SAAT KONTROLÜ İÇİN "BİTİŞ SAATİNİ" (endTime) BAZ ALIYORUZ
                    const endTimeStr = appData.endTime ? appData.endTime : appData.time;

                    // Randevu Tarihi ve Bitiş Saatini birleştirip zaman objesi yapıyoruz
                    const appDateObj = new Date(`${appData.date}T${endTimeStr}:00`);
                    const now = new Date();

                    // EĞER ŞU ANKİ BİLGİSAYAR SAATİ, RANDEVU BİTİŞ SAATİNİ GEÇTİYSE POPUP ÇIKAR!
                    if (now > appDateObj) {
                        popupShown = true;

                        // İşletme adını çekelim ki popup'ta şık dursun
                        let bizName = "İşletme";
                        try {
                            const bizSnap = await getDoc(doc(db, "businesses", t.businessId));
                            if (bizSnap.exists()) bizName = bizSnap.data().businessName;
                        } catch (e) { }

                        Swal.fire({
                            title: 'Hizmetimiz Nasıldı? ⭐',
                            html: `
                                <div style="text-align:left; background:#f8fafc; padding:15px; border-radius:10px; border:1px solid #e2e8f0; margin-bottom:15px;">
                                    <p style="color:#64748b; font-size:0.85rem; font-weight:700;">İşletme</p>
                                    <p style="color:#0ea5e9; font-size:1.1rem; font-weight:800; margin-bottom:10px;">${bizName}</p>
                                    <p style="color:#64748b; font-size:0.85rem; font-weight:700;">Hizmet & Tarih</p>
                                    <p style="color:#1e293b; font-size:1rem; font-weight:700;">🏷️ ${appData.serviceName} ${appData.personnelName ? '(👤 ' + appData.personnelName + ')' : ''}</p>
                                    <p style="color:#1e293b; font-size:0.95rem; font-weight:600;">📅 ${new Date(appData.date).toLocaleDateString('tr-TR')} | ⏰ ${appData.time}</p>
                                </div>
                                <p style="font-weight:600; color:#334155; font-size:0.95rem;">Memnuniyetinizi değerlendirmek ister misiniz?</p>
                            `,
                            icon: 'question',
                            showCancelButton: true,
                            confirmButtonText: 'Evet, Değerlendir',
                            cancelButtonText: 'Daha Sonra',
                            confirmButtonColor: '#f59e0b',
                            cancelButtonColor: '#cbd5e1'
                        }).then((res) => {
                            if (res.isConfirmed) {
                                openReviewModal(appDoc.id, appData.personnelName, appData.clientName, t.businessId, t.ticketId);
                            }
                        });
                    }
                }
            }
        } catch (error) { console.error("Otomatik yorum kontrol hatası:", error); }
    }
}

window.openReviewModal = async (appointmentId, personnelName, clientName, bizId = targetBusinessId, ticketId = null) => {
    const { value: reviewData } = await Swal.fire({
        title: 'Değerlendir',
        html: `
            <div style="text-align:center; margin-bottom:15px;">
                <p style="color:#64748b; font-size:0.9rem; margin-bottom:10px;">Puanınızı Seçin</p>
                <div id="star-rating-container" style="font-size:2.5rem; cursor:pointer; color:#cbd5e1; user-select:none;">
                    <span data-val="1">★</span><span data-val="2">★</span><span data-val="3">★</span><span data-val="4">★</span><span data-val="5">★</span>
                </div>
                <input type="hidden" id="swal-rating" value="0">
            </div>
            <textarea id="swal-comment" class="modern-input" placeholder="Deneyiminizi anlatın..." rows="3" style="resize:none; background:#fff; margin-bottom:0;"></textarea>
        `,
        focusConfirm: false, showCancelButton: true, confirmButtonText: 'Gönder', cancelButtonText: 'İptal',
        didOpen: () => {
            const stars = document.querySelectorAll('#star-rating-container span');
            const ratingInput = document.getElementById('swal-rating');
            stars.forEach(star => {
                star.addEventListener('click', () => {
                    const val = parseInt(star.getAttribute('data-val'));
                    ratingInput.value = val;
                    stars.forEach((s, idx) => { s.style.color = idx < val ? '#f59e0b' : '#cbd5e1'; });
                });
            });
        },
        preConfirm: () => {
            const rating = parseInt(document.getElementById('swal-rating').value);
            const comment = document.getElementById('swal-comment').value.trim();
            if (rating === 0) { Swal.showValidationMessage('Lütfen yıldız verin!'); return false; }
            if (comment.length < 5) { Swal.showValidationMessage('Lütfen en az 5 harflik bir yorum yazın!'); return false; }
            return { rating, comment };
        }
    });

    if (reviewData) {
        Swal.fire({ title: 'Gönderiliyor...', didOpen: () => Swal.showLoading() });
        try {
            await addDoc(collection(db, "businesses", bizId, "reviews"), {
                appointmentId: appointmentId,
                clientName: clientName || "İsimsiz",
                personnelName: personnelName || "",
                rating: reviewData.rating,
                comment: reviewData.comment,
                status: 'published',
                date: new Date().toISOString().split('T')[0],
                createdAt: new Date()
            });

            const appRef = doc(db, "businesses", bizId, "appointments", appointmentId);
            await updateDoc(appRef, { reviewed: true });

            let allTickets = JSON.parse(localStorage.getItem('muglaapp_tickets')) || [];
            let locTick = ticketId ? allTickets.find(t => t.ticketId === ticketId) : allTickets.find(t => t.businessId === bizId);
            if (locTick) {
                locTick.reviewedLocal = true;
                localStorage.setItem('muglaapp_tickets', JSON.stringify(allTickets));
            }

            Toast.fire({ icon: 'success', title: 'Yorumunuz yayınlandı! Teşekkürler.' });

            // Ana ekranda değil de işletme vitrinindeyse listeyi canlı güncelle
            if (bizId === targetBusinessId && typeof loadVitrinReviews === 'function') {
                loadVitrinReviews();
            }
        } catch (err) { Toast.fire({ icon: 'error', title: 'Yorum kaydedilemedi.' }); }
    }
};

async function loadVitrinReviews() {
    const reviewsContainer = document.getElementById('vitrin-reviews-container');
    const badgeContainer = document.getElementById('business-rating-badge');
    const valText = document.getElementById('b-rating-val');
    const countText = document.getElementById('b-rating-count');

    if (!reviewsContainer) return;

    try {
        const q = query(collection(db, "businesses", targetBusinessId, "reviews"));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            reviewsContainer.innerHTML = '<p class="empty-text">Henüz yorum yapılmamış. İlk değerlendiren siz olun!</p>';
            badgeContainer.classList.add('hidden');
            return;
        }

        let totalRating = 0;
        let reviewCount = 0;
        let reviewsHTML = '';

        const reviewsData = [];
        snapshot.forEach(doc => { reviewsData.push(doc.data()); });

        reviewsData.sort((a, b) => new Date(b.createdAt?.toDate() || b.date) - new Date(a.createdAt?.toDate() || a.date)).reverse();

        reviewsData.forEach(rev => {
            totalRating += rev.rating;
            reviewCount++;

            const stars = '★'.repeat(rev.rating) + '☆'.repeat(5 - rev.rating);
            const targetBadge = rev.personnelName ? `<div class="v-review-target">👤 ${rev.personnelName}</div>` : '';

            reviewsHTML += `
                <div class="v-review-card">
                    <div class="v-review-header">
                        <div class="v-review-name">${rev.clientName}</div>
                        <div class="v-review-date">${rev.date}</div>
                    </div>
                    <div class="v-review-stars">${stars}</div>
                    ${targetBadge}
                    <div class="v-review-text">"${rev.comment}"</div>
                </div>
            `;
        });

        const avgRating = (totalRating / reviewCount).toFixed(1);
        valText.textContent = avgRating;
        countText.textContent = `(${reviewCount} Yorum)`;
        badgeContainer.classList.remove('hidden');

        reviewsContainer.innerHTML = reviewsHTML;

    } catch (error) {
        console.error("Yorumlar yüklenirken hata:", error);
    }
} 