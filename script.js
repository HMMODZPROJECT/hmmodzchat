const firebaseConfig = {
  apiKey: "AIzaSyCsspPJYkPTzZsQz8OOYvTcIuFFxAdnKp4",
  authDomain: "hmmodz-c9623.firebaseapp.com",
  databaseURL: "https://hmmodz-c9623-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "hmmodz-c9623",
  storageBucket: "hmmodz-c9623.firebasestorage.app",
  messagingSenderId: "626862782296",
  appId: "1:626862782296:web:1355c5280ea29ab151d72d",
  measurementId: "G-KWDQLEEPEC"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const database = firebase.database();

// --- VARIABEL GLOBAL ---
let myUserId = null;
let myUsername = '';
let currentGroupId = null;
let isAdmin = false;

// --- ELEMEN DOM ---
const loginScreen = document.getElementById('login-screen');
const groupSelectionScreen = document.getElementById('group-selection-screen');
const chatContainer = document.getElementById('chat-container');
const loginForm = document.getElementById('login-form');
const usernameInput = document.getElementById('username-input');
const createGroupForm = document.getElementById('create-group-form');
const joinGroupForm = document.getElementById('join-group-form');
const groupIdInput = document.getElementById('group-id-input');
const groupIdDisplay = document.getElementById('group-id');
const adminNameDisplay = document.getElementById('admin-name');
const memberCountDisplay = document.getElementById('member-count');
const messagesContainer = document.getElementById('messages-container');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const leaderboardModal = document.getElementById('leaderboard-modal');
const memberList = document.getElementById('member-list');
const notification = document.getElementById('notification');

// --- FUNGSI UTAMA ---

// Fungsi untuk membuat ID Grup 8 digit unik
async function generateGroupId() {
    let newId;
    let idExists = true;
    while (idExists) {
        // Buat angka acak 8 digit (dari 10000000 hingga 99999999)
        newId = Math.floor(10000000 + Math.random() * 90000000).toString();
        const snapshot = await database.ref('groups/' + newId).once('value');
        idExists = snapshot.exists();
    }
    return newId;
}

// Fungsi untuk membersihkan listener saat keluar
function detachListeners() {
    if (currentGroupId && myUserId) {
        database.ref(`groups/${currentGroupId}/messages`).off();
        database.ref(`groups/${currentGroupId}/members`).off();
        database.ref(`groups/${currentGroupId}/members/${myUserId}`).off();
    }
}

// Fungsi untuk menampilkan notifikasi
function showNotification(message, duration = 5000) {
    notification.textContent = message;
    notification.classList.add('show');
    setTimeout(() => {
        notification.classList.remove('show');
    }, duration);
}

// Fungsi untuk memperbarui info grup (admin, jumlah anggota)
function updateGroupInfo() {
    if (!currentGroupId) return;

    // Update jumlah anggota secara real-time
    database.ref(`groups/${currentGroupId}/members`).on('value', snapshot => {
        memberCountDisplay.textContent = snapshot.numChildren();
    });

    // Update nama admin
    database.ref(`groups/${currentGroupId}/info/adminId`).once('value').then(adminSnapshot => {
        const adminId = adminSnapshot.val();
        if (adminId) {
            database.ref(`groups/${currentGroupId}/members/${adminId}/name`).once('value').then(nameSnapshot => {
                adminNameDisplay.textContent = nameSnapshot.val() || 'Tidak diketahui';
            });
        }
    });
}

// Fungsi untuk menghapus pesan (ADMIN ONLY)
function deleteMessage(messageId) {
    if (!isAdmin || !currentGroupId) return;
    
    if (confirm('Apakah Anda yakin ingin menghapus pesan ini?')) {
        database.ref(`groups/${currentGroupId}/messages/${messageId}`).remove()
            .then(() => {
                // Pesan akan hilang otomatis dari UI karena listener child_removed
                showNotification('Pesan telah dihapus.');
            })
            .catch((error) => {
                console.error("Gagal menghapus pesan: ", error);
                showNotification('Gagal menghapus pesan.');
            });
    }
}

// Fungsi untuk memasuki ruang chat
function enterChat(groupId, userId) {
    detachListeners(); // Hapus listener lama

    currentGroupId = groupId;
    myUserId = userId;
    
    // SIMPAN KE LOCALSTORE UNTUK KEPERLUAN REFRESH
    localStorage.setItem('chatGroupId', groupId);
    localStorage.setItem('chatUserId', userId);
    
    // Tampilkan layar chat
    groupSelectionScreen.style.display = 'none';
    chatContainer.style.display = 'flex';
    groupIdDisplay.textContent = groupId;

    // Perbarui info grup
    updateGroupInfo();

    // Cek apakah user ini admin
    database.ref(`groups/${groupId}/info/adminId`).once('value').then(snapshot => {
        isAdmin = (snapshot.val() === myUserId);
    });

    // Listener untuk pesan baru
    database.ref(`groups/${groupId}/messages`).on('child_added', snapshot => {
        const msg = snapshot.val();
        const messageId = snapshot.key; // Dapatkan ID unik pesan
        addMessageToUI(msg, messageId);
    });

    // Listener untuk pesan yang dihapus
    database.ref(`groups/${groupId}/messages`).on('child_removed', snapshot => {
        const messageId = snapshot.key;
        const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
        if (messageElement) {
            messageElement.remove();
        }
    });

    // Listener untuk daftar anggota (untuk notifikasi join/leave)
    database.ref(`groups/${groupId}/members`).on('child_added', snapshot => {
        const member = snapshot.val();
        if (snapshot.key !== myUserId) {
            addSystemMessage(`${member.name} telah bergabung.`);
        }
    });

    database.ref(`groups/${groupId}/members`).on('child_removed', snapshot => {
        const member = snapshot.val();
        if (member) {
            addSystemMessage(`${member.name} telah keluar.`);
        }
    });
    
    // Listener untuk memantau status kick/ban pada diri sendiri
    database.ref(`groups/${groupId}/members/${myUserId}`).on('value', snapshot => {
        const userData = snapshot.val();
        if (!userData) {
            showNotification('Anda telah dikeluarkan dari grup oleh admin.');
            localStorage.removeItem('chatGroupId');
            localStorage.removeItem('chatUserId');
            setTimeout(() => location.reload(), 3000);
        } else if (userData.isBanned) {
            const banDuration = userData.banExpiresAt ? Math.ceil((userData.banExpiresAt - Date.now()) / 60000) : 'selamanya';
            showNotification(`Anda dibanned oleh admin selama ${banDuration} menit.`);
            localStorage.removeItem('chatGroupId');
            localStorage.removeItem('chatUserId');
            setTimeout(() => location.reload(), 3000);
        }
    });

    updateLeaderboard();
}

// Fungsi menambahkan pesan ke UI
function addMessageToUI(msg, messageId) {
    const messageEl = document.createElement('div');
    const isSent = msg.senderId === myUserId;
    messageEl.classList.add('message', isSent ? 'sent' : 'received');
    
    // Tambahkan atribut data untuk identifikasi unik
    messageEl.setAttribute('data-message-id', messageId);
    
    if (!isSent) {
        messageEl.innerHTML = `<div class="sender">${msg.senderName}</div>`;
    }
    messageEl.innerHTML += `<div>${msg.text}</div>`;
    
    // --- TAMBAHAN: Tombol hapus hanya untuk admin ---
    if (isAdmin) {
        const deleteBtn = document.createElement('button');
        deleteBtn.classList.add('delete-btn');
        deleteBtn.innerHTML = '&times;'; // Simbol 'X'
        deleteBtn.setAttribute('title', 'Hapus Pesan');
        deleteBtn.onclick = () => deleteMessage(messageId);
        messageEl.appendChild(deleteBtn);
    }
    
    messagesContainer.appendChild(messageEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Fungsi menambahkan pesan sistem
function addSystemMessage(text) {
    const sysMsgEl = document.createElement('div');
    sysMsgEl.classList.add('message', 'system-message');
    sysMsgEl.textContent = text;
    messagesContainer.appendChild(sysMsgEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Fungsi update leaderboard
function updateLeaderboard() {
    if (!currentGroupId) return;
    memberList.innerHTML = ''; // Kosongkan dulu
    database.ref(`groups/${currentGroupId}/members`).once('value').then(snapshot => {
        snapshot.forEach(childSnapshot => {
            const member = childSnapshot.val();
            const userId = childSnapshot.key;
            const li = document.createElement('li');
            li.innerHTML = `<span class="member-name">${member.name} ${isAdmin && userId === myUserId ? '(Admin)' : ''}</span>`;
            
            if (isAdmin && userId !== myUserId) {
                const actionsDiv = document.createElement('div');
                actionsDiv.classList.add('member-actions');
                actionsDiv.innerHTML = `
                    <button class="btn btn-danger btn-small" onclick="kickUser('${userId}')">Kick</button>
                    <button class="btn btn-danger btn-small" onclick="banUser('${userId}')">Ban</button>
                `;
                li.appendChild(actionsDiv);
            }
            memberList.appendChild(li);
        });
    });
}

// --- EVENT LISTENER ---

// Login Form
loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    myUsername = usernameInput.value.trim();
    if (myUsername) {
        localStorage.setItem('chatUsername', myUsername);
        loginScreen.style.display = 'none';
        groupSelectionScreen.style.display = 'flex';
    }
});

// Create Group Form
createGroupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    showNotification('Membuat grup, harap tunggu...');
    const groupId = await generateGroupId(); // Tunggu hingga ID unik dibuat
    const groupRef = database.ref('groups/' + groupId);

    const userRef = groupRef.child('members').push();
    const userId = userRef.key;
    
    // Set user data dan admin
    await userRef.set({ name: myUsername, joinedAt: Date.now() });
    await groupRef.child('info').set({ adminId: userId, createdAt: Date.now() });

    enterChat(groupId, userId);
});

// Join Group Form
joinGroupForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const groupId = groupIdInput.value.trim();
    const groupRef = database.ref(`groups/${groupId}`);

    groupRef.once('value').then(snapshot => {
        if (snapshot.exists()) {
            const userRef = groupRef.child('members').push();
            const userId = userRef.key;
            userRef.set({ name: myUsername, joinedAt: Date.now() });
            enterChat(groupId, userId);
        } else {
            showNotification('ID Grup tidak ditemukan!', 3000);
        }
    });
});

// Message Form
messageForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (text && currentGroupId) {
        const messageData = {
            senderId: myUserId,
            senderName: myUsername,
            text: text,
            timestamp: firebase.database.ServerValue.TIMESTAMP
        };
        database.ref(`groups/${currentGroupId}/messages`).push(messageData);
        messageInput.value = '';
    }
});

// Header Buttons
document.getElementById('copy-id-btn').addEventListener('click', () => {
    if (!currentGroupId) return;
    navigator.clipboard.writeText(currentGroupId).then(() => {
        showNotification('ID Grup berhasil disalin!');
    }).catch(err => {
        console.error('Gagal menyalin: ', err);
        showNotification('Gagal menyalin ID.');
    });
});

document.getElementById('share-id-btn').addEventListener('click', () => {
    if (navigator.share) {
        navigator.share({
            title: 'Gabung ke Grup Chat Saya',
            text: `Gabung ke grup chat saya dengan ID: ${currentGroupId}`,
        }).catch(err => console.log('Error sharing', err));
    } else {
        navigator.clipboard.writeText(currentGroupId).then(() => {
            showNotification('Tautan disalin! Bagikan ke temanmu.');
        });
    }
});

// Tombol Keluar Grup
document.getElementById('leave-group-btn').addEventListener('click', () => {
    if (confirm('Apakah Anda yakin ingin keluar dari grup ini?')) {
        localStorage.removeItem('chatGroupId');
        localStorage.removeItem('chatUserId');
        
        database.ref(`groups/${currentGroupId}/members/${myUserId}`).remove()
            .then(() => {
                showNotification('Anda telah keluar dari grup.');
                setTimeout(() => location.reload(), 1500);
            });
    }
});

// Leaderboard Modal
document.getElementById('leaderboard-btn').addEventListener('click', () => {
    leaderboardModal.style.display = 'block';
    updateLeaderboard();
});

document.querySelector('.close').addEventListener('click', () => {
    leaderboardModal.style.display = 'none';
});

window.addEventListener('click', (e) => {
    if (e.target === leaderboardModal) {
        leaderboardModal.style.display = 'none';
    }
});

// --- ADMIN FUNCTIONS ---
function kickUser(userId) {
    if (!isAdmin || !currentGroupId) return;
    if (confirm('Apakah Anda yakin ingin mengeluarkan anggota ini?')) {
        database.ref(`groups/${currentGroupId}/members/${userId}`).remove();
        updateLeaderboard();
    }
}

function banUser(userId) {
    if (!isAdmin || !currentGroupId) return;
    const duration = prompt('Masukkan durasi ban (dalam menit). Kosongkan untuk permanen.', '10');
    if (duration !== null) {
        const banExpiresAt = duration ? Date.now() + (parseInt(duration) * 60000) : null;
        database.ref(`groups/${currentGroupId}/members/${userId}`).update({
            isBanned: true,
            banExpiresAt: banExpiresAt
        }).then(() => {
            database.ref(`groups/${currentGroupId}/members/${userId}`).remove();
            updateLeaderboard();
        });
    }
}

// --- INISIALISASI AWAL ---
window.addEventListener('load', () => {
    const savedUsername = localStorage.getItem('chatUsername');
    const savedGroupId = localStorage.getItem('chatGroupId');
    const savedUserId = localStorage.getItem('chatUserId');

    if (savedUsername && savedGroupId && savedUserId) {
        myUsername = savedUsername;
        loginScreen.style.display = 'none';
        groupSelectionScreen.style.display = 'none';
        enterChat(savedGroupId, savedUserId);
    } else if (savedUsername) {
        myUsername = savedUsername;
        loginScreen.style.display = 'none';
        groupSelectionScreen.style.display = 'flex';
    }
});