// ============================================================================
// AUTHOR: Nkululeko Freedom Ntanzi
// SYSTEM: Project V.O.L.T. Single Page Application Logic
// DESCRIPTION: Core state engine, signature pad drawing logic, dynamic screen
//              routing, and REST API calls to the FastAPI backend microservice.
// ============================================================================

const API_BASE_URL = "http://127.0.0.1:8000/api/v1";
const EMPLOYEE_ID = "CT-8891";

// Central Application State
const appState = {
    employeeId: EMPLOYEE_ID,
    basicSalary: 15000.00,
    maxCap: 4500.00,
    requestedPrincipal: 2000.00,
    adminFee: 100.00,
    totalDeduction: 2100.00,
    signatureData: "",
    otpCode: "",
    advanceId: "",
    sha256Hash: ""
};

document.addEventListener("DOMContentLoaded", () => {
    initSignaturePad();
    initEventListeners();
    fetchEligibility();
});

// View Navigation Handler (Supports Navigation to Screen 1 on Header Click)
function navigateToScreen(screenNumber) {
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    const target = document.getElementById(`screen-${screenNumber}`);
    if (target) {
        target.classList.add("active");
        if (screenNumber === 3 && canvas) {
            resizeCanvas();
        }
    }
}

// Fetch Eligibility Data from FastAPI Endpoint
async function fetchEligibility() {
    try {
        const response = await fetch(`${API_BASE_URL}/eligibility/${appState.employeeId}`);
        if (!response.ok) throw new Error("Backend offline.");
        
        const data = await response.json();
        appState.basicSalary = parseFloat(data.basic_salary);
        appState.maxCap = parseFloat(data.max_allowable_advance);

        // Update Screen 1 Metrics
        document.getElementById("val-basic-salary").innerText = formatZAR(appState.basicSalary);
        document.getElementById("val-max-cap").innerText = formatZAR(appState.maxCap);

        // Update Screen 2 Slider Boundaries
        const slider = document.getElementById("advance-slider");
        slider.max = appState.maxCap;
        document.getElementById("display-cap-label").innerText = `MAX: ${formatZAR(appState.maxCap)}`;
        
        updateCalculations(parseFloat(slider.value));
    } catch (err) {
        // Fallback calculation state if database is offline during preview
        updateCalculations(appState.requestedPrincipal);
    }
}

// Perform Financial Calculations (5% Flat Admin Fee & Salary Cap Enforcement)
function updateCalculations(principal) {
    appState.requestedPrincipal = principal;
    appState.adminFee = principal * 0.05;
    appState.totalDeduction = principal + appState.adminFee;

    const remainingSalary = appState.basicSalary - appState.totalDeduction;

    document.getElementById("display-requested-amount").innerText = formatZAR(principal);
    document.getElementById("calc-principal").innerText = formatZAR(principal);
    document.getElementById("calc-fee").innerText = formatZAR(appState.adminFee);
    document.getElementById("calc-total").innerText = formatZAR(appState.totalDeduction);
    document.getElementById("calc-net-remaining").innerText = formatZAR(remainingSalary);
    document.getElementById("aod-amount").innerText = formatZAR(appState.totalDeduction);
}

// Digital Signature Canvas Setup
let isDrawing = false;
let canvas, ctx;

function resizeCanvas() {
    if (!canvas) return;
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = 160;
    ctx.strokeStyle = "#FF7A00";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
}

function initSignaturePad() {
    canvas = document.getElementById("signature-pad");
    ctx = canvas.getContext("2d");

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    const getPos = (e) => {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return { x: clientX - rect.left, y: clientY - rect.top };
    };

    const startDraw = (e) => { isDrawing = true; const pos = getPos(e); ctx.beginPath(); ctx.moveTo(pos.x, pos.y); };
    const moveDraw = (e) => { if (!isDrawing) return; const pos = getPos(e); ctx.lineTo(pos.x, pos.y); ctx.stroke(); };
    const stopDraw = () => { isDrawing = false; };

    canvas.addEventListener("mousedown", startDraw);
    canvas.addEventListener("mousemove", moveDraw);
    canvas.addEventListener("mouseup", stopDraw);

    canvas.addEventListener("touchstart", startDraw);
    canvas.addEventListener("touchmove", moveDraw);
    canvas.addEventListener("touchend", stopDraw);
}

function clearSignature() {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    appState.signatureData = "";
}

// UI Event Handlers
function initEventListeners() {
    // Header Click -> Return to Screen 1 (Home)
    const headerHomeBtn = document.getElementById("header-home-btn");
    if (headerHomeBtn) {
        headerHomeBtn.addEventListener("click", () => {
            navigateToScreen(1);
        });
    }

    document.getElementById("btn-to-screen-2").addEventListener("click", () => navigateToScreen(2));
    
    document.getElementById("advance-slider").addEventListener("input", (e) => {
        updateCalculations(parseFloat(e.target.value));
    });

    document.getElementById("btn-to-screen-3").addEventListener("click", () => navigateToScreen(3));
    
    document.getElementById("btn-clear-sig").addEventListener("click", clearSignature);

    document.getElementById("btn-to-screen-4").addEventListener("click", () => {
        appState.signatureData = canvas.toDataURL("image/png");
        navigateToScreen(4);
    });

    document.getElementById("btn-verify-disburse").addEventListener("click", executeAdvanceSubmission);

    document.getElementById("btn-withdraw-now").addEventListener("click", () => navigateToScreen(6));
}

// Submit Application Payload to Backend
async function executeAdvanceSubmission() {
    const otpInput = document.getElementById("otp-input").value.trim();
    const errorBox = document.getElementById("otp-error");
    errorBox.style.display = "none";

    if (otpInput.length !== 6) {
        errorBox.innerText = "ERR_OTP_INVALID: Please enter a 6-digit passcode.";
        errorBox.style.display = "block";
        return;
    }

    appState.otpCode = otpInput;

    const payload = {
        employee_id: appState.employeeId,
        requested_principal: appState.requestedPrincipal,
        signature_blob: appState.signatureData || "data:image/png;base64,sample_signature_blob",
        otp_code: appState.otpCode
    };

    try {
        const response = await fetch(`${API_BASE_URL}/advances/apply`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
            errorBox.innerText = data.detail || "Submission failed.";
            errorBox.style.display = "block";
            return;
        }

        appState.advanceId = data.advance_id;
        appState.sha256Hash = data.sha256_contract_hash;

        document.getElementById("wallet-balance").innerText = formatZAR(appState.requestedPrincipal);
        document.getElementById("final-ref-id").innerText = appState.advanceId;
        document.getElementById("final-deduction-amount").innerText = formatZAR(appState.totalDeduction);
        document.getElementById("final-hash").innerText = appState.sha256Hash;

        navigateToScreen(5);
    } catch (err) {
        // Fallback response for local presentation preview
        appState.advanceId = "VOLT-2026-8891";
        appState.sha256Hash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        
        document.getElementById("wallet-balance").innerText = formatZAR(appState.requestedPrincipal);
        document.getElementById("final-ref-id").innerText = appState.advanceId;
        document.getElementById("final-deduction-amount").innerText = formatZAR(appState.totalDeduction);
        document.getElementById("final-hash").innerText = appState.sha256Hash;

        navigateToScreen(5);
    }
}

// Utility: Format Currency to South African Rand (ZAR)
function formatZAR(value) {
    return new Intl.NumberFormat("en-ZA", {
        style: "currency",
        currency: "ZAR",
        minimumFractionDigits: 2
    }).format(value);
}