# ============================================================================
# AUTHOR: Nkululeko Freedom Ntanzi
# MODULE: FastAPI Application Layer (Project V.O.L.T Core Engine)
# DESCRIPTION: Core microservice with CORS enabled for frontend communication.
# ============================================================================

import hashlib
from decimal import Decimal
from typing import Optional
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from database import VoltDatabaseRepository

app = FastAPI(
    title="Project V.O.L.T. Core Engine",
    description="Vectorized Operational Liquidity & Transaction-Engine Service API",
    version="2.0.0"
)

# Enable Cross-Origin Resource Sharing (CORS) to prevent 404/Preflight errors
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

db_repo = VoltDatabaseRepository()

BASIC_SALARY_CAP_PERCENT = Decimal("0.30")
ADMIN_FEE_PERCENT = Decimal("0.05")


class EligibilityResponse(BaseModel):
    employee_id: str
    is_eligible: bool
    basic_salary: Decimal
    max_allowable_advance: Decimal
    rejection_reason: Optional[str] = None


class AdvanceApplicationRequest(BaseModel):
    employee_id: str = Field(..., example="CT-8891")
    requested_principal: Decimal = Field(..., gt=0, example=2000.00)
    signature_blob: str = Field(...)
    otp_code: str = Field(..., min_length=6, max_length=6, example="841903")


class AdvanceApplicationResponse(BaseModel):
    advance_id: str
    status: str
    principal_amount: Decimal
    admin_fee_amount: Decimal
    total_deduction_amount: Decimal
    sha256_contract_hash: str
    message: str


def compute_sha256_signature(employee_id: str, amount: Decimal, timestamp: str, signature_data: str) -> str:
    raw_payload = f"{employee_id}|{amount:.2f}|{timestamp}|{signature_data}"
    return hashlib.sha256(raw_payload.encode("utf-8")).hexdigest()


@app.get("/api/v1/eligibility/{employee_id}", response_model=EligibilityResponse)
def get_employee_eligibility(employee_id: str):
    result = db_repo.execute_eligibility_sp(employee_id)
    return EligibilityResponse(
        employee_id=result["employee_id"],
        is_eligible=result["is_eligible"],
        basic_salary=Decimal(str(result["basic_salary"])),
        max_allowable_advance=Decimal(str(result["max_allowable_advance"])),
        rejection_reason=result["rejection_reason"]
    )


@app.post("/api/v1/advances/apply", response_model=AdvanceApplicationResponse, status_code=status.HTTP_201_CREATED)
def apply_for_advance(request_data: AdvanceApplicationRequest, request: Request):
    eligibility = db_repo.execute_eligibility_sp(request_data.employee_id)
    if not eligibility["is_eligible"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Application Rejected: {eligibility['rejection_reason']}"
        )

    max_advance = Decimal(str(eligibility["max_allowable_advance"]))
    if request_data.requested_principal > max_advance:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ERR_CAP_EXCEEDED: Amount exceeds maximum allowable limit."
        )

    if request_data.otp_code != "841903":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="ERR_OTP_MISMATCH: Invalid 2FA passcode provided."
        )

    principal = request_data.requested_principal
    admin_fee = (principal * ADMIN_FEE_PERCENT).quantize(Decimal("0.01"))
    total_deduction = principal + admin_fee
    current_timestamp = "2026-09-25T12:00:00Z"

    contract_hash = compute_sha256_signature(
        employee_id=request_data.employee_id,
        amount=principal,
        timestamp=current_timestamp,
        signature_data=request_data.signature_blob
    )

    client_ip = request.client.host if request.client else "127.0.0.1"
    user_agent = request.headers.get("user-agent", "Unknown-Agent")

    try:
        advance_uuid = db_repo.process_advance_sp(
            employee_id=request_data.employee_id,
            principal=float(principal),
            signature=request_data.signature_blob,
            contract_hash=contract_hash,
            ip_addr=client_ip,
            user_agent=user_agent
        )
    except Exception as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database execution error: {str(error)}"
        )

    return AdvanceApplicationResponse(
        advance_id=advance_uuid,
        status="ACTIVE_QUEUED",
        principal_amount=principal,
        admin_fee_amount=admin_fee,
        total_deduction_amount=total_deduction,
        sha256_contract_hash=contract_hash,
        message="Advance successfully approved and queued for payroll deduction."
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
    