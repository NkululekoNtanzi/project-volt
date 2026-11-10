# ============================================================================
# AUTHOR: Nkululeko Freedom Ntanzi
# MODULE: Database Connector
# DESCRIPTION: Manages connections to SSMS using pyodbc.
# ============================================================================

import pyodbc
from typing import Dict, Any, Optional

DB_CONFIG = {
    "server": "localhost",
    "database": "ProjectVOLTDB",
    "driver": "{ODBC Driver 17 for SQL Server}",
    "trusted_connection": "yes"
}

def get_db_connection():
    """Constructs and returns a SQL Server connection instance."""
    connection_string = (
        f"DRIVER={DB_CONFIG['driver']};"
        f"SERVER={DB_CONFIG['server']};"
        f"DATABASE={DB_CONFIG['database']};"
        f"Trusted_Connection={DB_CONFIG['trusted_connection']};"
    )
    return pyodbc.connect(connection_string)

class VoltDatabaseRepository:
    """Encapsulates data access interactions executed against SQL Server."""

    def execute_eligibility_sp(self, employee_id: str) -> Dict[str, Any]:
        """Calls the stored procedure sp_CheckEmployeeEligibility in SQL Server."""
        conn = get_db_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("{CALL sp_CheckEmployeeEligibility (?)}", (employee_id,))
            row = cursor.fetchone()
            if row:
                return {
                    "employee_id": row.employee_id,
                    "is_eligible": bool(row.is_eligible),
                    "basic_salary": float(row.basic_salary),
                    "max_allowable_advance": float(row.max_allowable_advance),
                    "rejection_reason": row.rejection_reason
                }
            return {
                "employee_id": employee_id,
                "is_eligible": False,
                "basic_salary": 0.0,
                "max_allowable_advance": 0.0,
                "rejection_reason": "Employee record unavailable."
            }
        finally:
            conn.close()

    def process_advance_sp(self, employee_id: str, principal: float, signature: str, contract_hash: str, ip_addr: str, user_agent: str) -> str:
        """Executes transaction processing stored procedure."""
        conn = get_db_connection()
        cursor = conn.cursor()
        try:
            # Execute stored procedure with OUTPUT parameters
            sql = """
                DECLARE @OutID UNIQUEIDENTIFIER;
                EXEC sp_ProcessAdvanceRequest 
                    @EmployeeID = ?, 
                    @RequestedPrincipal = ?, 
                    @SignatureBlob = ?, 
                    @ContractHash = ?, 
                    @IPAddress = ?, 
                    @UserAgent = ?, 
                    @NewAdvanceID = @OutID OUTPUT;
                SELECT @OutID AS advance_id;
            """
            cursor.execute(sql, (employee_id, principal, signature, contract_hash, ip_addr, user_agent))
            row = cursor.fetchone()
            conn.commit()
            return str(row.advance_id)
        except Exception as err:
            conn.rollback()
            raise err
        finally:
            conn.close()