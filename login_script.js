
// Tab switching functionality
document.querySelectorAll('.form-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const targetTab = tab.dataset.tab;

        document.querySelectorAll('.form-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        document.querySelectorAll('.form-content').forEach(content => {
            content.classList.remove('active');
        });
        document.getElementById(targetTab + 'Form').classList.add('active');

        hideMessages();
    });
});

// Password toggle
function togglePassword(inputId) {
    const input = document.getElementById(inputId);
    const toggleBtn = input.nextElementSibling;
    const icon = toggleBtn.querySelector('i');

    if (input.type === 'password') {
        input.type = 'text';
        icon.className = 'fas fa-eye-slash';
    } else {
        input.type = 'password';
        icon.className = 'fas fa-eye';
    }
}

// Validators
function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

function validatePassword(password) {
    return password.length >= 8;
}

function validateName(name) {
    return name.trim().length >= 2;
}

// Message handlers
function showError(message) {
    const errorDiv = document.getElementById('errorMessage');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    document.getElementById('successMessage').style.display = 'none';
    errorDiv.classList.add('shake');
    setTimeout(() => errorDiv.classList.remove('shake'), 500);
}

function showSuccess(message) {
    const successDiv = document.getElementById('successMessage');
    successDiv.textContent = message;
    successDiv.style.display = 'block';
    document.getElementById('errorMessage').style.display = 'none';
}

function hideMessages() {
    document.getElementById('errorMessage').style.display = 'none';
    document.getElementById('successMessage').style.display = 'none';
}

// Login
document.getElementById('loginFormElement').addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const rememberMe = document.getElementById('rememberMe').checked;

    if (!validateEmail(email)) return showError('올바른 이메일 주소를 입력해주세요.');
    if (!password) return showError('비밀번호를 입력해주세요.');

    const submitBtn = document.getElementById('loginSubmitBtn');
    submitBtn.classList.add('loading');
    submitBtn.disabled = true;

    try {
        const res = await fetch('http://localhost:4000/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });

        const data = await res.json();

        if (!res.ok) {
            return showError(data.message || '로그인 실패');
        }

        localStorage.setItem('token', data.token);
        localStorage.setItem('userEmail', data.email);
        
        // 로컬로 저장
        if (rememberMe) localStorage.setItem('rememberMe', 'true');

        showSuccess('로그인 성공! 메인 페이지로 이동합니다.');

        setTimeout(() => {
            window.location.href = 'index.html';
        }, 1500);
    } catch (error) {
        showError('서버 오류로 로그인에 실패했습니다.');
    } finally {
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
    }
});

// Signup
document.getElementById('signupFormElement').addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('signupName').value;
    const email = document.getElementById('signupEmail').value;
    const password = document.getElementById('signupPassword').value;
    const confirmPassword = document.getElementById('signupConfirmPassword').value;
    const agreeTerms = document.getElementById('agreeTerms').checked;

    if (!validateName(name)) return showError('이름을 2자 이상 입력해주세요.');
    if (!validateEmail(email)) return showError('올바른 이메일 주소를 입력해주세요.');
    if (!validatePassword(password)) return showError('비밀번호는 8자 이상이어야 합니다.');
    if (password !== confirmPassword) return showError('비밀번호가 일치하지 않습니다.');
    if (!agreeTerms) return showError('이용약관에 동의해주세요.');

    const submitBtn = document.getElementById('signupSubmitBtn');
    submitBtn.classList.add('loading');
    submitBtn.disabled = true;

    try {
        const res = await fetch('http://localhost:4000/api/auth/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, password }),
        });

        const data = await res.json();

        if (!res.ok) {
            return showError(data.message || '회원가입 실패');
        }

        showSuccess('회원가입이 완료되었습니다! 로그인해주세요.');
        setTimeout(() => {
            document.querySelector('[data-tab="login"]').click();
            document.getElementById('loginEmail').value = email;
        }, 1500);
    } catch (error) {
        showError('서버 오류로 회원가입에 실패했습니다.');
    } finally {
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
    }
});

// Social login (dummy)
function socialLogin(provider) {
    showSuccess(`${provider} 로그인을 시도합니다...`);
    setTimeout(() => {
        localStorage.setItem('isLoggedIn', 'true');
        localStorage.setItem('userEmail', `user@${provider}.com`);
        window.location.href = 'index.html';
    }, 1500);
}

// Forgot password (stub)
function showForgotPassword() {
    const email = document.getElementById('loginEmail').value;
    if (email && validateEmail(email)) {
        showSuccess('비밀번호 재설정 링크가 이메일로 전송되었습니다.');
    } else {
        showError('먼저 이메일 주소를 입력해주세요.');
    }
}

// Redirect if already logged in
window.addEventListener('load', () => {
    const token = localStorage.getItem('token');
    if (token) {
        window.location.href = 'index.html';
    }
});

// Live input feedback
document.getElementById('signupConfirmPassword').addEventListener('input', () => {
    const password = document.getElementById('signupPassword').value;
    const confirmPassword = document.getElementById('signupConfirmPassword').value;
    const field = document.getElementById('signupConfirmPassword');
    if (confirmPassword && password !== confirmPassword) {
        field.classList.add('error');
    } else {
        field.classList.remove('error');
    }
});

document.getElementById('loginEmail').addEventListener('blur', () => {
    const email = document.getElementById('loginEmail').value;
    const field = document.getElementById('loginEmail');
    field.classList.toggle('error', email && !validateEmail(email));
});

document.getElementById('signupEmail').addEventListener('blur', () => {
    const email = document.getElementById('signupEmail').value;
    const field = document.getElementById('signupEmail');
    field.classList.toggle('error', email && !validateEmail(email));
});
