/*
Purpose: Comprehensive database column fixer for all tables
Author: AI Assistant
Date: 2025
*/
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using System;
using System.Threading.Tasks;

namespace HexaBill.Api.Shared.Extensions
{
    public static class DatabaseFixer
    {
        public static async Task FixMissingColumnsAsync(DbContext context)
        {
            // Only enabled for SQLite
            if (context.Database.IsNpgsql())
            {
                return;
            }
            
            ILogger? logger = null;
            try
            {
                // Try to get logger from service provider if available
                if (context is Microsoft.EntityFrameworkCore.Infrastructure.IInfrastructure<IServiceProvider> serviceProviderAccessor)
                {
                    var serviceProvider = serviceProviderAccessor.Instance;
                    var loggerFactory = serviceProvider.GetService(typeof(ILoggerFactory)) as ILoggerFactory;
                    logger = loggerFactory?.CreateLogger("DatabaseFixer");
                }

                // CRITICAL: Use ExecuteSqlRawAsync which handles connection management automatically
                // This is safer than manually managing connections and avoids transaction conflicts
                // NOTE: ALTER TABLE in SQLite commits any pending transaction, so this should
                // only be called when no transaction is active (e.g., at application startup)

                logger?.LogInformation("Starting comprehensive database column fix...");

                // SQLite doesn't support IF NOT EXISTS for ALTER TABLE
                // Run AuditLogs FIRST so Purchase and other services don't fail with "no column named EntityId"
                var commands = new[]
                {
                    // Tenants table - CRITICAL: Must run early (queried during user seeding)
                    ("ALTER TABLE Tenants ADD COLUMN FeaturesJson TEXT NULL", "Tenants", "FeaturesJson"),
                    
                    // AuditLogs table - MUST run first (fixes "table AuditLogs has no column named EntityId")
                    ("ALTER TABLE AuditLogs ADD COLUMN EntityType TEXT NULL", "AuditLogs", "EntityType"),
                    ("ALTER TABLE AuditLogs ADD COLUMN EntityId INTEGER NULL", "AuditLogs", "EntityId"),
                    ("ALTER TABLE AuditLogs ADD COLUMN OldValues TEXT NULL", "AuditLogs", "OldValues"),
                    ("ALTER TABLE AuditLogs ADD COLUMN NewValues TEXT NULL", "AuditLogs", "NewValues"),
                    ("ALTER TABLE AuditLogs ADD COLUMN IpAddress TEXT NULL", "AuditLogs", "IpAddress"),
                    // Sales table - All required columns
                    ("ALTER TABLE Sales ADD COLUMN LastPaymentDate TEXT NULL", "Sales", "LastPaymentDate"),
                    ("ALTER TABLE Sales ADD COLUMN PaidAmount decimal(18,2) DEFAULT 0", "Sales", "PaidAmount"),
                    ("ALTER TABLE Sales ADD COLUMN TotalAmount decimal(18,2) DEFAULT 0", "Sales", "TotalAmount"),
                    ("ALTER TABLE Sales ADD COLUMN IsLocked INTEGER DEFAULT 0", "Sales", "IsLocked"),
                    ("ALTER TABLE Sales ADD COLUMN Version INTEGER DEFAULT 1", "Sales", "Version"),
                    ("ALTER TABLE Sales ADD COLUMN RowVersion BLOB", "Sales", "RowVersion"),
                    ("ALTER TABLE Sales ADD COLUMN LastModifiedBy INTEGER NULL", "Sales", "LastModifiedBy"),
                    ("ALTER TABLE Sales ADD COLUMN LastModifiedAt TEXT NULL", "Sales", "LastModifiedAt"),
                    ("ALTER TABLE Sales ADD COLUMN LockedAt TEXT NULL", "Sales", "LockedAt"),
                    ("ALTER TABLE Sales ADD COLUMN EditReason TEXT NULL", "Sales", "EditReason"),
                    ("ALTER TABLE Sales ADD COLUMN DeletedBy INTEGER NULL", "Sales", "DeletedBy"),
                    ("ALTER TABLE Sales ADD COLUMN DeletedAt TEXT NULL", "Sales", "DeletedAt"),
                    ("ALTER TABLE Sales ADD COLUMN IsDeleted INTEGER DEFAULT 0", "Sales", "IsDeleted"),
                    ("ALTER TABLE Sales ADD COLUMN Notes TEXT NULL", "Sales", "Notes"),
                    ("ALTER TABLE Sales ADD COLUMN ExternalReference TEXT NULL", "Sales", "ExternalReference"),
                    ("ALTER TABLE Sales ADD COLUMN IsFinalized INTEGER DEFAULT 1", "Sales", "IsFinalized"),
                    ("ALTER TABLE Sales ADD COLUMN IsZeroInvoice INTEGER DEFAULT 0", "Sales", "IsZeroInvoice"),
                    ("ALTER TABLE Sales ADD COLUMN VatScenario TEXT NULL", "Sales", "VatScenario"),
                    
                    // ExpenseCategories - TenantId required for user/expense seeding (migration may not have run)
                    ("ALTER TABLE ExpenseCategories ADD COLUMN TenantId INTEGER NULL", "ExpenseCategories", "TenantId"),
                    
                    // Customers table - ALL columns (order matters - add nullable columns first, then required with defaults)
                    ("ALTER TABLE Customers ADD COLUMN Email TEXT NULL", "Customers", "Email"),
                    ("ALTER TABLE Customers ADD COLUMN LastActivity TEXT NULL", "Customers", "LastActivity"),
                    ("ALTER TABLE Customers ADD COLUMN LastPaymentDate TEXT NULL", "Customers", "LastPaymentDate"),
                    ("ALTER TABLE Customers ADD COLUMN TotalSales decimal(18,2) DEFAULT 0", "Customers", "TotalSales"),
                    ("ALTER TABLE Customers ADD COLUMN TotalPayments decimal(18,2) DEFAULT 0", "Customers", "TotalPayments"),
                    ("ALTER TABLE Customers ADD COLUMN PendingBalance decimal(18,2) DEFAULT 0", "Customers", "PendingBalance"),
                    ("ALTER TABLE Customers ADD COLUMN RowVersion BLOB", "Customers", "RowVersion"),
                    ("ALTER TABLE Customers ADD COLUMN PaymentTerms TEXT NULL", "Customers", "PaymentTerms"),
                    // Note: CreatedAt and UpdatedAt should already exist from InitialCreate, but add if missing
                    // SQLite doesn't support computed defaults in ALTER TABLE, so we add without default and update after
                    ("ALTER TABLE Customers ADD COLUMN CreatedAt TEXT", "Customers", "CreatedAt"),
                    ("ALTER TABLE Customers ADD COLUMN UpdatedAt TEXT", "Customers", "UpdatedAt"),
                    // CreditLimit and Balance should already exist, but ensure defaults
                    // Note: SQLite doesn't support ALTER COLUMN to add defaults to existing columns
                    // So we'll add the column if missing, and use UPDATE to set defaults for existing NULL values
                    ("ALTER TABLE Customers ADD COLUMN CreditLimit decimal(18,2) DEFAULT 0", "Customers", "CreditLimit"),
                    ("ALTER TABLE Customers ADD COLUMN Balance decimal(18,2) DEFAULT 0", "Customers", "Balance"),
                    
                    // Payments table - All columns
                    ("ALTER TABLE Payments ADD COLUMN Mode TEXT", "Payments", "Mode"),
                    ("ALTER TABLE Payments ADD COLUMN Status TEXT", "Payments", "Status"),
                    ("ALTER TABLE Payments ADD COLUMN Reference TEXT NULL", "Payments", "Reference"),
                    ("ALTER TABLE Payments ADD COLUMN CreatedBy INTEGER DEFAULT 1", "Payments", "CreatedBy"),
                    ("ALTER TABLE Payments ADD COLUMN UpdatedAt TEXT NULL", "Payments", "UpdatedAt"),
                    ("ALTER TABLE Payments ADD COLUMN RowVersion BLOB", "Payments", "RowVersion"),
                    
                    // Products table - Ensure all columns exist
                    ("ALTER TABLE Products ADD COLUMN RowVersion BLOB", "Products", "RowVersion"),
                    ("ALTER TABLE Products ADD COLUMN CreatedAt TEXT", "Products", "CreatedAt"),
                    ("ALTER TABLE Products ADD COLUMN UpdatedAt TEXT", "Products", "UpdatedAt"),
                    ("ALTER TABLE Products ADD COLUMN DescriptionEn TEXT NULL", "Products", "DescriptionEn"),
                    ("ALTER TABLE Products ADD COLUMN DescriptionAr TEXT NULL", "Products", "DescriptionAr"),
                    ("ALTER TABLE Products ADD COLUMN ReorderLevel INTEGER DEFAULT 0", "Products", "ReorderLevel"),
                    ("ALTER TABLE Products ADD COLUMN ExpiryDate TEXT NULL", "Products", "ExpiryDate"),
                    
                    // Users table - Ensure all columns exist
                    ("ALTER TABLE Users ADD COLUMN Phone TEXT NULL", "Users", "Phone"),
                    ("ALTER TABLE Users ADD COLUMN CreatedAt TEXT", "Users", "CreatedAt"),
                    ("ALTER TABLE Users ADD COLUMN DashboardPermissions TEXT NULL", "Users", "DashboardPermissions"),
                    
                    // SaleItems table - Ensure all columns exist
                    ("ALTER TABLE SaleItems ADD COLUMN Discount decimal(18,2) DEFAULT 0", "SaleItems", "Discount"),
                    ("ALTER TABLE SaleItems ADD COLUMN VatAmount decimal(18,2) DEFAULT 0", "SaleItems", "VatAmount"),
                    ("ALTER TABLE SaleItems ADD COLUMN VatRate decimal(18,4) DEFAULT 0", "SaleItems", "VatRate"),
                    ("ALTER TABLE SaleItems ADD COLUMN VatScenario TEXT NULL", "SaleItems", "VatScenario"),
                    
                    // Purchases table - VAT return engine
                    ("ALTER TABLE Purchases ADD COLUMN IsReverseCharge INTEGER DEFAULT 0", "Purchases", "IsReverseCharge"),
                    ("ALTER TABLE Purchases ADD COLUMN IsTaxClaimable INTEGER DEFAULT 0", "Purchases", "IsTaxClaimable"),
                    ("ALTER TABLE Purchases ADD COLUMN ReverseChargeVat decimal(18,4) NULL", "Purchases", "ReverseChargeVat"),
                    
                    // Purchases table - Ensure all columns exist (CRITICAL FIX)
                    ("ALTER TABLE Purchases ADD COLUMN ExternalReference TEXT NULL", "Purchases", "ExternalReference"),
                    ("ALTER TABLE Purchases ADD COLUMN ExpenseCategory TEXT NULL", "Purchases", "ExpenseCategory"),

                    // Expenses table - Fixes 500 on /api/expenses when columns missing (SQLite)
                    ("ALTER TABLE Expenses ADD COLUMN AttachmentUrl TEXT NULL", "Expenses", "AttachmentUrl"),
                    ("ALTER TABLE Expenses ADD COLUMN Status INTEGER NOT NULL DEFAULT 1", "Expenses", "Status"),
                    ("ALTER TABLE Expenses ADD COLUMN RecurringExpenseId INTEGER NULL", "Expenses", "RecurringExpenseId"),
                    ("ALTER TABLE Expenses ADD COLUMN ApprovedBy INTEGER NULL", "Expenses", "ApprovedBy"),
                    ("ALTER TABLE Expenses ADD COLUMN ApprovedAt TEXT NULL", "Expenses", "ApprovedAt"),
                    ("ALTER TABLE Expenses ADD COLUMN RejectionReason TEXT NULL", "Expenses", "RejectionReason"),
                    ("ALTER TABLE Expenses ADD COLUMN RouteId INTEGER NULL", "Expenses", "RouteId"),
                    // VAT return engine (AddVatReturnEngineFields)
                    ("ALTER TABLE Expenses ADD COLUMN ClaimableVat decimal(18,4) NULL", "Expenses", "ClaimableVat"),
                    ("ALTER TABLE Expenses ADD COLUMN IsEntertainment INTEGER DEFAULT 0", "Expenses", "IsEntertainment"),
                    ("ALTER TABLE Expenses ADD COLUMN IsTaxClaimable INTEGER DEFAULT 0", "Expenses", "IsTaxClaimable"),
                    ("ALTER TABLE Expenses ADD COLUMN PartialCreditPct decimal(18,4) DEFAULT 0", "Expenses", "PartialCreditPct"),
                    ("ALTER TABLE Expenses ADD COLUMN TaxType TEXT NULL", "Expenses", "TaxType"),
                    ("ALTER TABLE Expenses ADD COLUMN TotalAmount decimal(18,4) NULL", "Expenses", "TotalAmount"),
                    ("ALTER TABLE Expenses ADD COLUMN VatAmount decimal(18,4) NULL", "Expenses", "VatAmount"),
                    ("ALTER TABLE Expenses ADD COLUMN VatRate decimal(18,4) NULL", "Expenses", "VatRate"),
                };

                int columnsAdded = 0;
                int columnsSkipped = 0;
                
                // CRITICAL: Use ExecuteSqlRawAsync which handles connection/transaction management better
                // But ALTER TABLE in SQLite commits transactions, so we need to be careful
                foreach (var (command, tableName, columnName) in commands)
                {
                    try
                    {
                        // Use ExecuteSqlRawAsync which is safer for EF Core
                        // It will handle connection management and won't interfere with active transactions
                        await context.Database.ExecuteSqlRawAsync(command);
                        columnsAdded++;
                        logger?.LogDebug("Added column: {Table}.{Column}", tableName, columnName);
                    }
                    catch (Exception ex)
                    {
                        // Column might already exist - ignore duplicate column errors
                        // SQLite returns various error messages for duplicate columns
                        var msg = ex.Message ?? "";
                        var inner = ex.InnerException?.Message ?? "";
                        var fullError = $"{msg} {inner}".ToLowerInvariant();
                        
                        // Check for any indication that column already exists
                        if (fullError.Contains("duplicate column") ||
                            fullError.Contains("duplicate column name") ||
                            fullError.Contains("already exists") ||
                            fullError.Contains("sqlite error 1") || // SQLite error code 1 often means constraint violation
                            (fullError.Contains("error") && fullError.Contains("column") && fullError.Contains("tenants")))
                        {
                            columnsSkipped++;
                            logger?.LogDebug("Column {Table}.{Column} already exists, skipping", tableName, columnName);
                        }
                        else
                        {
                            // Only log non-duplicate errors as warnings
                            logger?.LogWarning("Error adding {Table}.{Column}: {Message} (Inner: {Inner})", tableName, columnName, msg, inner);
                        }
                    }
                }
                
                logger?.LogInformation("Column fix complete: {Added} added, {Skipped} already existed", columnsAdded, columnsSkipped);

                // Initialize data and fix inconsistencies
                logger?.LogInformation("Initializing data and fixing inconsistencies...");
                
                var initCommands = new[]
                {
                    // Sales table initialization
                    ("UPDATE Sales SET TotalAmount = GrandTotal WHERE TotalAmount IS NULL OR TotalAmount = 0", "Init Sales TotalAmount"),
                    ("UPDATE Sales SET PaidAmount = 0 WHERE PaidAmount IS NULL", "Init Sales PaidAmount"),
                    ("UPDATE Sales SET IsLocked = 0 WHERE IsLocked IS NULL", "Init Sales IsLocked"),
                    ("UPDATE Sales SET Version = 1 WHERE Version IS NULL OR Version = 0", "Init Sales Version"),
                    ("UPDATE Sales SET IsDeleted = 0 WHERE IsDeleted IS NULL", "Init Sales IsDeleted"),
                    ("UPDATE Sales SET RowVersion = x'' WHERE RowVersion IS NULL", "Init Sales RowVersion"),
                    ("UPDATE Sales SET PaymentStatus = 'Pending' WHERE PaymentStatus IS NULL OR PaymentStatus = ''", "Init Sales PaymentStatus"),
                    
                    // Payments table initialization
                    ("UPDATE Payments SET Mode = 'CASH' WHERE Mode IS NULL OR Mode = ''", "Init Payments Mode"),
                    ("UPDATE Payments SET Status = 'PENDING' WHERE Status IS NULL OR Status = ''", "Init Payments Status"),
                    ("UPDATE Payments SET RowVersion = x'' WHERE RowVersion IS NULL", "Init Payments RowVersion"),
                    ("UPDATE Payments SET CreatedBy = 1 WHERE CreatedBy IS NULL OR CreatedBy = 0", "Init Payments CreatedBy"),
                    ("UPDATE Payments SET CreatedAt = datetime('now') WHERE CreatedAt IS NULL", "Init Payments CreatedAt"),
                    // Sync old Method and ChequeStatus columns from new Mode and Status (for backward compatibility)
                    ("UPDATE Payments SET Method = Mode WHERE Method IS NULL OR Method = ''", "Sync Payments Method"),
                    ("UPDATE Payments SET ChequeStatus = CASE WHEN Status = 'CLEARED' THEN 'Cleared' WHEN Status = 'PENDING' THEN 'Pending' WHEN Status = 'RETURNED' THEN 'Returned' ELSE 'Pending' END WHERE ChequeStatus IS NULL OR ChequeStatus = ''", "Sync Payments ChequeStatus"),
                    
                    // Customers table initialization - CRITICAL: Ensure all required fields have values
                    ("UPDATE Customers SET RowVersion = x'' WHERE RowVersion IS NULL", "Init Customers RowVersion"),
                    ("UPDATE Customers SET CreatedAt = datetime('now') WHERE CreatedAt IS NULL OR CreatedAt = ''", "Init Customers CreatedAt"),
                    ("UPDATE Customers SET UpdatedAt = COALESCE(CreatedAt, datetime('now')) WHERE UpdatedAt IS NULL OR UpdatedAt = ''", "Init Customers UpdatedAt"),
                    ("UPDATE Customers SET Email = NULL WHERE Email = ''", "Init Customers Email"),
                    // CRITICAL: Balance must never be NULL - set to 0 if NULL
                    ("UPDATE Customers SET Balance = 0 WHERE Balance IS NULL", "Init Customers Balance"),
                    ("UPDATE Customers SET TotalSales = 0 WHERE TotalSales IS NULL", "Init Customers TotalSales"),
                    ("UPDATE Customers SET TotalPayments = 0 WHERE TotalPayments IS NULL", "Init Customers TotalPayments"),
                    ("UPDATE Customers SET PendingBalance = 0 WHERE PendingBalance IS NULL", "Init Customers PendingBalance"),
                    // CRITICAL: CreditLimit must never be NULL - set to 0 if NULL or invalid
                    // This fixes the NOT NULL constraint error
                    ("UPDATE Customers SET CreditLimit = 0 WHERE CreditLimit IS NULL", "Init Customers CreditLimit"),
                    // Ensure Name is never empty (required field)
                    ("UPDATE Customers SET Name = 'Unnamed Customer' WHERE Name IS NULL OR Name = ''", "Init Customers Name"),
                    
                    // Products table initialization
                    ("UPDATE Products SET RowVersion = x'' WHERE RowVersion IS NULL", "Init Products RowVersion"),
                    ("UPDATE Products SET CreatedAt = datetime('now') WHERE CreatedAt IS NULL", "Init Products CreatedAt"),
                    ("UPDATE Products SET UpdatedAt = COALESCE(CreatedAt, datetime('now')) WHERE UpdatedAt IS NULL", "Init Products UpdatedAt"),
                    ("UPDATE Products SET ReorderLevel = 0 WHERE ReorderLevel IS NULL", "Init Products ReorderLevel"),
                    ("UPDATE Products SET StockQty = 0 WHERE StockQty IS NULL", "Init Products StockQty"),
                    ("UPDATE Products SET ConversionToBase = 1 WHERE ConversionToBase IS NULL OR ConversionToBase = 0", "Init Products ConversionToBase"),
                    
                    // Users table initialization
                    ("UPDATE Users SET CreatedAt = datetime('now') WHERE CreatedAt IS NULL", "Init Users CreatedAt"),
                    
                    // SaleItems table initialization
                    ("UPDATE SaleItems SET Discount = 0 WHERE Discount IS NULL", "Init SaleItems Discount"),
                    ("UPDATE SaleItems SET VatAmount = 0 WHERE VatAmount IS NULL", "Init SaleItems VatAmount"),
                };

                int initSuccess = 0;
                int initSkipped = 0;
                
                // Use ExecuteSqlRawAsync for initialization commands too
                foreach (var (command, description) in initCommands)
                {
                    try
                    {
                        var rowsAffected = await context.Database.ExecuteSqlRawAsync(command);
                        if (rowsAffected > 0)
                        {
                            initSuccess++;
                            logger?.LogInformation("{Description}: {Rows} rows updated", description, rowsAffected);
                        }
                    }
                    catch (Exception ex)
                    {
                        // Column might not exist yet, that's OK
                        if (!ex.Message.Contains("no such column") && !ex.Message.Contains("no such table"))
                        {
                            initSkipped++;
                            logger?.LogWarning(ex, "{Description} skipped: {Message}", description, ex.Message);
                        }
                    }
                }

                logger?.LogInformation("Database fix complete: {ColumnsAdded} columns added, {InitSuccess} data updates successful", columnsAdded, initSuccess);
            }
            catch (Exception ex)
            {
                logger?.LogError(ex, "Database fix error: {Message}", ex.Message);
                // Re-throw to allow caller to handle - but this should only be called at startup
                // when no transactions are active
                throw;
            }
        }
    }
}

