-- FILE: 02_Stored_Procedures.sql
-- DESCRIPTION: Stored procedures handling eligibility verification, transaction
--              processing, and payroll export routines.


USE ProjectVOLTDB;
GO

-- Stored Procedure: Check Employee Eligibility
CREATE PROCEDURE sp_CheckEmployeeEligibility
    @EmployeeID VARCHAR(20)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @BasicSalary DECIMAL(10, 2);
    DECLARE @ProbationPassed BIT;
    DECLARE @ActiveWarnings BIT;
    DECLARE @ActiveAdvanceCount INT;
    DECLARE @MaxAllowableAdvance DECIMAL(10, 2);

    -- Check if employee exists
    IF NOT EXISTS (SELECT 1 FROM employees WHERE employee_id = @EmployeeID)
    BEGIN
        SELECT 
            @EmployeeID AS employee_id,
            0 AS is_eligible,
            0.00 AS basic_salary,
            0.00 AS max_allowable_advance,
            'ERR_NOT_FOUND: Employee record not found.' AS rejection_reason;
        RETURN;
    END

    -- Fetch employee parameters
    SELECT 
        @BasicSalary = basic_salary,
        @ProbationPassed = probation_passed,
        @ActiveWarnings = active_warnings
    FROM employees
    WHERE employee_id = @EmployeeID;

    -- Evaluate rule 1: Probation Status
    IF @ProbationPassed = 0
    BEGIN
        SELECT 
            @EmployeeID AS employee_id,
            0 AS is_eligible,
            @BasicSalary AS basic_salary,
            0.00 AS max_allowable_advance,
            'ERR_PROBATION_LOCK: Available post probation completion.' AS rejection_reason;
        RETURN;
    END

    -- Evaluate rule 2: Active Disciplinary Warnings
    IF @ActiveWarnings = 1
    BEGIN
        SELECT 
            @EmployeeID AS employee_id,
            0 AS is_eligible,
            @BasicSalary AS basic_salary,
            0.00 AS max_allowable_advance,
            'ERR_WARNING_LOCK: Active disciplinary record present.' AS rejection_reason;
        RETURN;
    END

    -- Evaluate rule 3: Active Loan Count
    SELECT @ActiveAdvanceCount = COUNT(*) 
    FROM volt_advances 
    WHERE employee_id = @EmployeeID AND advance_status = 'ACTIVE_QUEUED';

    IF @ActiveAdvanceCount > 0
    BEGIN
        SELECT 
            @EmployeeID AS employee_id,
            0 AS is_eligible,
            @BasicSalary AS basic_salary,
            0.00 AS max_allowable_advance,
            'ERR_ACTIVE_LOAN: Active advance exists. Settlement pending.' AS rejection_reason;
        RETURN;
    END

    -- Calculate 30% Basic Salary Cap
    SET @MaxAllowableAdvance = @BasicSalary * 0.30;

    SELECT 
        @EmployeeID AS employee_id,
        1 AS is_eligible,
        @BasicSalary AS basic_salary,
        @MaxAllowableAdvance AS max_allowable_advance,
        NULL AS rejection_reason;
END;
GO

-- Stored Procedure: Execute Loan Advance Processing
CREATE PROCEDURE sp_ProcessAdvanceRequest
    @EmployeeID VARCHAR(20),
    @RequestedPrincipal DECIMAL(10, 2),
    @SignatureBlob VARCHAR(MAX),
    @ContractHash VARCHAR(64),
    @IPAddress VARCHAR(45),
    @UserAgent VARCHAR(MAX),
    @NewAdvanceID UNIQUEIDENTIFIER OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRANSACTION;

    BEGIN TRY
        DECLARE @BasicSalary DECIMAL(10, 2);
        DECLARE @MaxAdvance DECIMAL(10, 2);
        DECLARE @AdminFee DECIMAL(10, 2);
        DECLARE @TotalDeduction DECIMAL(10, 2);
        DECLARE @DeductionDate DATE;

        -- Obtain employee basic salary
        SELECT @BasicSalary = basic_salary FROM employees WHERE employee_id = @EmployeeID;

        IF @BasicSalary IS NULL
        BEGIN
            RAISERROR('Employee record invalid.', 16, 1);
        END

        SET @MaxAdvance = @BasicSalary * 0.30;

        -- Validate request against cap
        IF @RequestedPrincipal > @MaxAdvance
        BEGIN
            RAISERROR('ERR_CAP_EXCEEDED: Requested amount exceeds maximum limit.', 16, 1);
        END

        -- Perform financial calculations
        SET @AdminFee = @RequestedPrincipal * 0.05;
        SET @TotalDeduction = @RequestedPrincipal + @AdminFee;
        SET @DeductionDate = DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 25);

        SET @NewAdvanceID = NEWID();

        -- Insert advance record
        INSERT INTO volt_advances (
            advance_id, employee_id, principal_amount, admin_fee_amount, 
            total_deduction_amount, scheduled_deduction_date, advance_status, 
            signature_blob, sha256_contract_hash, otp_verified_at
        )
        VALUES (
            @NewAdvanceID, @EmployeeID, @RequestedPrincipal, @AdminFee, 
            @TotalDeduction, @DeductionDate, 'ACTIVE_QUEUED', 
            @SignatureBlob, @ContractHash, SYSDATETIMEOFFSET()
        );

        -- Credit user wallet balance
        INSERT INTO wallet_transactions (employee_id, advance_id, amount, transaction_type, payout_reference)
        VALUES (@EmployeeID, @NewAdvanceID, @RequestedPrincipal, 'CREDIT', CONCAT('VOLT-CREDIT-', LEFT(CAST(@NewAdvanceID AS VARCHAR(36)), 8)));

        -- Record system audit log
        INSERT INTO audit_logs (advance_id, event_type, ip_address, user_agent)
        VALUES (@NewAdvanceID, 'ADVANCE_CREATED_AND_DISBURSED', @IPAddress, @UserAgent);

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO