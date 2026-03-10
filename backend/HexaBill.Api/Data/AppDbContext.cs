/*
Purpose: Database context for Entity Framework Core
Author: AI Assistant
Date: 2024
*/
using Microsoft.EntityFrameworkCore;
using Npgsql.EntityFrameworkCore.PostgreSQL;
using HexaBill.Api.Models;

namespace HexaBill.Api.Data
{
    public class AppDbContext : DbContext
    {
        public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
        {
        }

        protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
        {
            if (!optionsBuilder.IsConfigured)
            {
                return;
            }
            
            // Suppress pending model changes warning during development
            optionsBuilder.ConfigureWarnings(warnings =>
                warnings.Ignore(Microsoft.EntityFrameworkCore.Diagnostics.RelationalEventId.PendingModelChangesWarning));
        }

        public DbSet<Tenant> Tenants { get; set; }
        public DbSet<User> Users { get; set; }
        public DbSet<SubscriptionPlan> SubscriptionPlans { get; set; }
        public DbSet<Subscription> Subscriptions { get; set; }
        public DbSet<Product> Products { get; set; }
        public DbSet<PriceChangeLog> PriceChangeLogs { get; set; }
        public DbSet<SupplierCategory> SupplierCategories { get; set; }
        public DbSet<Supplier> Suppliers { get; set; }
        public DbSet<SupplierPayment> SupplierPayments { get; set; }
        public DbSet<SupplierLedgerCredit> SupplierLedgerCredits { get; set; }
        public DbSet<VendorDiscount> VendorDiscounts { get; set; }
        public DbSet<Purchase> Purchases { get; set; }
        public DbSet<PurchaseItem> PurchaseItems { get; set; }
        public DbSet<Sale> Sales { get; set; }
        public DbSet<SaleItem> SaleItems { get; set; }
        public DbSet<Customer> Customers { get; set; }
        public DbSet<Payment> Payments { get; set; }
        public DbSet<Expense> Expenses { get; set; }
        public DbSet<ExpenseCategory> ExpenseCategories { get; set; }
        public DbSet<RecurringExpense> RecurringExpenses { get; set; }
        public DbSet<ProductCategory> ProductCategories { get; set; }
        public DbSet<InventoryTransaction> InventoryTransactions { get; set; }
        public DbSet<AuditLog> AuditLogs { get; set; }
        public DbSet<Setting> Settings { get; set; }
        public DbSet<DamageCategory> DamageCategories { get; set; }
        public DbSet<DamageInventory> DamageInventories { get; set; }
        public DbSet<CreditNote> CreditNotes { get; set; }
        public DbSet<SaleReturn> SaleReturns { get; set; }
        public DbSet<SaleReturnItem> SaleReturnItems { get; set; }
        public DbSet<PurchaseReturn> PurchaseReturns { get; set; }
        public DbSet<PurchaseReturnItem> PurchaseReturnItems { get; set; }
        public DbSet<InvoiceVersion> InvoiceVersions { get; set; }
        public DbSet<PaymentIdempotency> PaymentIdempotencies { get; set; }
        public DbSet<InvoiceTemplate> InvoiceTemplates { get; set; }
        public DbSet<Alert> Alerts { get; set; }
        public DbSet<ErrorLog> ErrorLogs { get; set; }
        // BUG #2.7 FIX: Persistent login lockout tracking
        public DbSet<FailedLoginAttempt> FailedLoginAttempts { get; set; }
        public DbSet<DemoRequest> DemoRequests { get; set; }
        public DbSet<Branch> Branches { get; set; }
        public DbSet<HexaBill.Api.Models.Route> Routes { get; set; }
        public DbSet<RouteCustomer> RouteCustomers { get; set; }
        public DbSet<RouteStaff> RouteStaff { get; set; }
        public DbSet<BranchStaff> BranchStaff { get; set; }
        public DbSet<RouteExpense> RouteExpenses { get; set; }
        public DbSet<CustomerVisit> CustomerVisits { get; set; }
        public DbSet<HeldInvoice> HeldInvoices { get; set; }
        public DbSet<UserSession> UserSessions { get; set; }
        public DbSet<RecurringInvoice> RecurringInvoices { get; set; }
        public DbSet<RecurringInvoiceItem> RecurringInvoiceItems { get; set; }
        public DbSet<VatReturnPeriod> VatReturnPeriods { get; set; }
        public DbSet<PaymentReceipt> PaymentReceipts { get; set; }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);

            // PostgreSQL Sequences
            // All companies start at 0001; Zayorga exception handled in InvoiceNumberService
            modelBuilder.HasSequence<int>("invoice_number_seq").StartsAt(1);

            // Tenant configuration
            modelBuilder.Entity<Tenant>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Name).IsRequired().HasMaxLength(200);
                entity.Property(e => e.Country).IsRequired().HasMaxLength(10).HasDefaultValue("AE");
                entity.Property(e => e.Currency).IsRequired().HasMaxLength(10).HasDefaultValue("AED");
                entity.Property(e => e.Status).HasConversion<string>().HasDefaultValue(TenantStatus.Active);
                entity.Property(e => e.CreatedAt).IsRequired();
                entity.HasIndex(e => e.Subdomain).IsUnique().HasFilter("\"Subdomain\" IS NOT NULL");
                entity.HasIndex(e => e.Domain).IsUnique().HasFilter("\"Domain\" IS NOT NULL");
            });

            // User configuration
            modelBuilder.Entity<User>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Email).IsRequired().HasMaxLength(100);
                entity.HasIndex(e => e.Email).IsUnique();
                entity.Property(e => e.Role).HasConversion<string>();
            });

            // Product configuration - SKU unique per tenant (multi-tenant), not globally
            modelBuilder.Entity<Product>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Sku).IsRequired().HasMaxLength(50);
                entity.HasIndex(e => new { e.TenantId, e.Sku }).IsUnique();
                entity.Property(e => e.UnitType).IsRequired().HasMaxLength(20);
                entity.Property(e => e.CostPrice).HasColumnType("numeric(18,2)");
                entity.Property(e => e.SellPrice).HasColumnType("numeric(18,2)");
                entity.Property(e => e.StockQty).HasColumnType("numeric(18,2)");
                entity.Property(e => e.ConversionToBase).HasColumnType("numeric(18,2)");
                
                // Optimized concurrency for both PostgreSQL (bytea) and SQLite (BLOB)
                entity.Property(e => e.RowVersion)
                    .IsRowVersion()
                    .IsConcurrencyToken()
                    .HasColumnType(Database.IsNpgsql() ? "bytea" : "BLOB")
                    .HasDefaultValue(new byte[] { 0 });
            });

            // SupplierCategory configuration (optional categorization)
            modelBuilder.Entity<SupplierCategory>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Name).IsRequired().HasMaxLength(100);
                entity.Property(e => e.TenantId).IsRequired(false);
                entity.HasIndex(e => new { e.TenantId, e.Name }).IsUnique();
            });

            // Purchase configuration - composite unique (OwnerId, InvoiceNo) for multi-tenant
            modelBuilder.Entity<Purchase>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.SupplierName).IsRequired().HasMaxLength(200);
                entity.Property(e => e.InvoiceNo).IsRequired().HasMaxLength(100);
                entity.Property(e => e.ExternalReference).HasMaxLength(200);
                entity.Property(e => e.ExpenseCategory).HasMaxLength(100);
                entity.Property(e => e.InvoiceFilePath).HasMaxLength(500);
                entity.Property(e => e.InvoiceFileName).HasMaxLength(255);
                entity.HasIndex(e => new { e.OwnerId, e.InvoiceNo }).IsUnique();
                
                // VAT TRACKING FIELDS (nullable for backward compatibility)
                entity.Property(e => e.Subtotal).HasColumnType("decimal(18,2)").IsRequired(false);
                entity.Property(e => e.VatTotal).HasColumnType("decimal(18,2)").IsRequired(false);
                entity.Property(e => e.TotalAmount).HasColumnType("decimal(18,2)");
                entity.Property(e => e.PaymentType).HasMaxLength(20).IsRequired(false);
                entity.Property(e => e.AmountPaid).HasColumnType("decimal(18,2)").IsRequired(false);
                entity.Property(e => e.ReverseChargeVat).HasColumnType("decimal(18,4)").IsRequired(false);
                
                entity.HasOne(e => e.Supplier).WithMany().HasForeignKey(e => e.SupplierId).OnDelete(DeleteBehavior.SetNull);
                entity.HasOne(e => e.CreatedByUser).WithMany().HasForeignKey(e => e.CreatedBy);
            });

            // Supplier configuration - Name unique per tenant; NormalizedName required by DB (unique index)
            // Category/CategoryId: real CLR properties (EF Core rejects shadow navigation "Category")
            modelBuilder.Entity<Supplier>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Name).IsRequired().HasMaxLength(200);
                entity.Property(e => e.NormalizedName).IsRequired().HasMaxLength(200);
                entity.Property(e => e.Phone).HasMaxLength(50);
                entity.Property(e => e.Email).HasMaxLength(200);
                entity.Property(e => e.Address).HasMaxLength(500);
                entity.Property(e => e.CreditLimit).HasColumnType("decimal(18,2)");
                entity.Property(e => e.PaymentTerms).HasMaxLength(100);
                entity.HasIndex(e => new { e.TenantId, e.Name }).IsUnique();
                entity.HasOne(e => e.Category)
                    .WithMany(c => c.Suppliers)
                    .HasForeignKey(e => e.CategoryId)
                    .OnDelete(DeleteBehavior.SetNull)
                    .IsRequired(false);
                entity.Navigation(e => e.Category).AutoInclude(false);
            });

            // SupplierPayment configuration
            modelBuilder.Entity<SupplierPayment>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.SupplierName).IsRequired().HasMaxLength(200);
                entity.Property(e => e.Amount).HasColumnType("decimal(18,2)");
                entity.Property(e => e.Reference).HasMaxLength(200);
                entity.Property(e => e.Notes).HasMaxLength(500);
                entity.Property(e => e.Mode).HasConversion<string>();
                entity.HasIndex(e => new { e.TenantId, e.PaymentDate });
                entity.HasIndex(e => new { e.TenantId, e.SupplierName });
            });

            // SupplierLedgerCredit – reduces supplier outstanding (vendor discounts as credits)
            modelBuilder.Entity<SupplierLedgerCredit>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.SupplierName).IsRequired().HasMaxLength(200);
                entity.Property(e => e.Amount).HasColumnType("decimal(18,2)");
                entity.Property(e => e.CreditType).IsRequired().HasMaxLength(50);
                entity.Property(e => e.Notes).HasMaxLength(500);
                entity.HasIndex(e => new { e.TenantId, e.SupplierName });
                entity.HasIndex(e => e.CreditDate);
            });

            // VendorDiscount configuration - private tracking only; NOT used in ledger, balance, or reports
            modelBuilder.Entity<VendorDiscount>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Amount).HasColumnType("decimal(18,2)");
                entity.Property(e => e.DiscountType).IsRequired().HasMaxLength(50);
                entity.Property(e => e.Reason).IsRequired().HasMaxLength(500);
                entity.HasIndex(e => e.TenantId);
                entity.HasIndex(e => e.SupplierId);
                entity.HasOne(e => e.Supplier).WithMany().HasForeignKey(e => e.SupplierId).OnDelete(DeleteBehavior.Restrict);
                entity.HasOne(e => e.Purchase).WithMany().HasForeignKey(e => e.PurchaseId).OnDelete(DeleteBehavior.SetNull);
                entity.HasOne(e => e.CreatedByUser).WithMany().HasForeignKey(e => e.CreatedBy);
            });

            // PurchaseItem configuration
            modelBuilder.Entity<PurchaseItem>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.UnitType).IsRequired().HasMaxLength(20);
                entity.Property(e => e.Qty).HasColumnType("decimal(18,2)");
                entity.Property(e => e.UnitCost).HasColumnType("decimal(18,2)");
                
                // VAT TRACKING FIELDS (nullable for backward compatibility)
                entity.Property(e => e.UnitCostExclVat).HasColumnType("decimal(18,2)").IsRequired(false);
                entity.Property(e => e.VatAmount).HasColumnType("decimal(18,2)").IsRequired(false);
                
                entity.Property(e => e.LineTotal).HasColumnType("decimal(18,2)");
                entity.HasOne(e => e.Purchase).WithMany(p => p.Items).HasForeignKey(e => e.PurchaseId);
                entity.HasOne(e => e.Product).WithMany().HasForeignKey(e => e.ProductId);
            });

            // Sale configuration
            modelBuilder.Entity<Sale>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.InvoiceNo).IsRequired().HasMaxLength(100);
                // CRITICAL FIX: Composite unique index on (OwnerId, InvoiceNo) for multi-tenant support
                // Each owner can have their own invoice number sequence
                entity.HasIndex(e => new { e.OwnerId, e.InvoiceNo })
                    .IsUnique()
                    .HasFilter("\"IsDeleted\" = false"); // Allow reuse of invoice numbers after deletion
                entity.Property(e => e.ExternalReference).HasMaxLength(200);
                // PostgreSQL requires quoted column names in filter expressions
                entity.HasIndex(e => e.ExternalReference)
                    .IsUnique()
                    .HasFilter("\"ExternalReference\" IS NOT NULL"); // PostgreSQL/SQLite compatible
                entity.Property(e => e.Subtotal).HasColumnType("decimal(18,2)");
                entity.Property(e => e.VatTotal).HasColumnType("decimal(18,2)");
                entity.Property(e => e.Discount).HasColumnType("decimal(18,2)");
                entity.Property(e => e.RoundOff).HasColumnType("decimal(18,2)");
                entity.Property(e => e.GrandTotal).HasColumnType("decimal(18,2)");
                entity.Property(e => e.PaymentStatus).HasConversion<string>(); // SalePaymentStatus enum
                entity.Property(e => e.IsDeleted).HasDefaultValue(false);
                entity.Property(e => e.IsLocked).HasDefaultValue(false);
                entity.Property(e => e.Version).HasDefaultValue(1);
                entity.Property(e => e.EditReason).HasMaxLength(500);
                entity.Property(e => e.VatScenario).HasMaxLength(20);
                // Optimistic concurrency control - prevent duplicate saves
                entity.Property(e => e.RowVersion)
                    .IsRowVersion()
                    .IsConcurrencyToken()
                    .HasColumnType(Database.IsNpgsql() ? "bytea" : "BLOB")
                    .HasDefaultValue(new byte[] { 0 });
                entity.HasOne(e => e.Customer).WithMany().HasForeignKey(e => e.CustomerId);
                entity.HasOne(e => e.Branch).WithMany().HasForeignKey(e => e.BranchId).OnDelete(DeleteBehavior.SetNull);
                entity.HasOne(e => e.Route).WithMany().HasForeignKey(e => e.RouteId).OnDelete(DeleteBehavior.SetNull);
                entity.HasOne(e => e.CreatedByUser).WithMany().HasForeignKey(e => e.CreatedBy);
                entity.HasOne(e => e.LastModifiedByUser).WithMany().HasForeignKey(e => e.LastModifiedBy);
                entity.HasOne(e => e.DeletedByUser).WithMany().HasForeignKey(e => e.DeletedBy);
                entity.HasIndex(e => e.CreatedAt);
                entity.HasIndex(e => e.IsLocked);
                entity.HasIndex(e => e.BranchId);
                entity.HasIndex(e => e.RouteId);
            });
            
            // InvoiceTemplate configuration - Tenant-scoped for multi-tenant isolation
            modelBuilder.Entity<InvoiceTemplate>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.TenantId).IsRequired(false);
                entity.Property(e => e.Name).IsRequired().HasMaxLength(200);
                entity.Property(e => e.Version).HasMaxLength(50);
                entity.Property(e => e.HtmlCode).IsRequired();
                entity.Property(e => e.Description).HasMaxLength(1000);
                entity.HasOne(e => e.CreatedByUser).WithMany().HasForeignKey(e => e.CreatedBy);
                entity.HasIndex(e => e.IsActive);
                entity.HasIndex(e => e.TenantId);
            });

            // Alert configuration
            modelBuilder.Entity<Alert>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Type).IsRequired().HasMaxLength(100);
                entity.Property(e => e.Title).IsRequired().HasMaxLength(200);
                entity.Property(e => e.Message).HasMaxLength(2000);
                entity.Property(e => e.Severity).HasMaxLength(50);
                entity.Property(e => e.Metadata).HasMaxLength(500);
                entity.HasOne(e => e.ResolvedByUser).WithMany().HasForeignKey(e => e.ResolvedBy).OnDelete(DeleteBehavior.SetNull);
                entity.HasIndex(e => e.Type);
                entity.HasIndex(e => e.IsRead);
                entity.HasIndex(e => e.IsResolved);
                entity.HasIndex(e => e.CreatedAt);
            });

            // InvoiceVersion configuration
            modelBuilder.Entity<InvoiceVersion>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.DataJson).IsRequired().HasColumnType(Database.IsNpgsql() ? "jsonb" : "TEXT");
                entity.Property(e => e.EditReason).HasMaxLength(500);
                entity.Property(e => e.DiffSummary).HasMaxLength(1000);
                entity.HasOne(e => e.Sale).WithMany().HasForeignKey(e => e.SaleId);
                entity.HasOne(e => e.CreatedByUser).WithMany().HasForeignKey(e => e.CreatedById);
                entity.HasIndex(e => e.SaleId);
                entity.HasIndex(e => new { e.SaleId, e.VersionNumber });
            });

            // SaleItem configuration
            modelBuilder.Entity<SaleItem>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.UnitType).IsRequired().HasMaxLength(20);
                entity.Property(e => e.Qty).HasColumnType("decimal(18,2)");
                entity.Property(e => e.UnitPrice).HasColumnType("decimal(18,2)");
                entity.Property(e => e.Discount).HasColumnType("decimal(18,2)");
                entity.Property(e => e.VatAmount).HasColumnType("decimal(18,2)");
                entity.Property(e => e.LineTotal).HasColumnType("decimal(18,2)");
                entity.Property(e => e.VatRate).HasColumnType("decimal(18,4)");
                entity.Property(e => e.VatScenario).HasMaxLength(20);
                entity.HasOne(e => e.Sale).WithMany(s => s.Items).HasForeignKey(e => e.SaleId);
                entity.HasOne(e => e.Product).WithMany().HasForeignKey(e => e.ProductId);
            });

            // Customer configuration - Base configuration
            modelBuilder.Entity<Customer>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Name).IsRequired().HasMaxLength(200);
                entity.Property(e => e.Phone).HasMaxLength(20);
                entity.Property(e => e.Email).HasMaxLength(100);
                entity.Property(e => e.Trn).HasMaxLength(50);
                entity.Property(e => e.Address).HasMaxLength(500);
                
                // CRITICAL: All decimal fields must have defaults and cannot be NULL
                entity.Property(e => e.CreditLimit)
                    .HasColumnType("decimal(18,2)")
                    .HasDefaultValue(0m)
                    .IsRequired();
                entity.Property(e => e.Balance)
                    .HasColumnType("decimal(18,2)")
                    .HasDefaultValue(0m)
                    .IsRequired();
                
                // REAL-TIME BALANCE TRACKING FIELDS (added in migration 20251111120000)
                entity.Property(e => e.TotalSales)
                    .HasColumnType("decimal(18,2)")
                    .HasDefaultValue(0m)
                    .IsRequired();
                entity.Property(e => e.TotalPayments)
                    .HasColumnType("decimal(18,2)")
                    .HasDefaultValue(0m)
                    .IsRequired();
                entity.Property(e => e.PendingBalance)
                    .HasColumnType("decimal(18,2)")
                    .HasDefaultValue(0m)
                    .IsRequired();
                entity.Property(e => e.LastPaymentDate).IsRequired(false);
                entity.Property(e => e.LastActivity).IsRequired(false);
                
                // CRITICAL: RowVersion configuration
                entity.Property(e => e.RowVersion)
                    .IsRowVersion()
                    .IsConcurrencyToken()
                    .HasColumnType(Database.IsNpgsql() ? "bytea" : "BLOB")
                    .HasDefaultValue(new byte[] { 0 })
                    .IsRequired(false);
            });

            // Payment configuration
            modelBuilder.Entity<Payment>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Amount).HasColumnType("decimal(18,2)");
                entity.Property(e => e.Mode).HasConversion<string>();
                entity.Property(e => e.Status).HasConversion<string>();
                entity.Property(e => e.Reference).HasMaxLength(200);
                entity.Property(e => e.RowVersion)
                    .IsRowVersion()
                    .IsConcurrencyToken()
                    .HasColumnType(Database.IsNpgsql() ? "bytea" : "BLOB")
                    .IsRequired(false); // Make nullable for PostgreSQL
                entity.HasOne(e => e.Sale).WithMany().HasForeignKey(e => e.SaleId);
                entity.HasOne<SaleReturn>().WithMany().HasForeignKey(e => e.SaleReturnId).IsRequired(false);
                entity.HasOne(e => e.Customer).WithMany().HasForeignKey(e => e.CustomerId);
                entity.HasOne(e => e.CreatedByUser).WithMany().HasForeignKey(e => e.CreatedBy);
            });
            
            // PaymentIdempotency configuration (idempotency)
            modelBuilder.Entity<PaymentIdempotency>(entity =>
            {
                entity.HasKey(e => e.IdempotencyKey);
                entity.Property(e => e.IdempotencyKey).HasMaxLength(100);
                entity.Property(e => e.ResponseSnapshot).HasColumnType(Database.IsNpgsql() ? "jsonb" : "TEXT"); 
                entity.HasIndex(e => e.IdempotencyKey).IsUnique();
                entity.HasOne(e => e.Payment).WithMany().HasForeignKey(e => e.PaymentId);
                entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId);
            });

            modelBuilder.Entity<PaymentReceipt>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.ReceiptNumber).HasMaxLength(30);
                entity.HasIndex(e => new { e.TenantId, e.ReceiptNumber }).IsUnique();
                entity.HasOne(e => e.Payment).WithMany().HasForeignKey(e => e.PaymentId);
                entity.HasOne(e => e.GeneratedByUser).WithMany().HasForeignKey(e => e.GeneratedByUserId);
            });
            
            // Sale - Add paid amount tracking
            modelBuilder.Entity<Sale>(entity =>
            {
                entity.Property(e => e.PaidAmount).HasColumnType("decimal(18,2)").HasDefaultValue(0m);
                entity.Property(e => e.TotalAmount).HasColumnType("decimal(18,2)");
                
                // CRITICAL: RowVersion configuration
                entity.Property(e => e.RowVersion)
                    .IsRowVersion()
                    .IsConcurrencyToken()
                    .HasColumnType(Database.IsNpgsql() ? "bytea" : "BLOB")
                    .HasDefaultValue(new byte[] { 0 })
                    .IsRequired(false);
            });
            
            // Customer - Last activity already configured above

            // ExpenseCategory configuration - Tenant-scoped, unique (TenantId, Name)
            modelBuilder.Entity<ExpenseCategory>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.TenantId).IsRequired(false);
                entity.Property(e => e.Name).IsRequired().HasMaxLength(100);
                entity.HasIndex(e => new { e.TenantId, e.Name }).IsUnique();
            });

            // ProductCategory configuration - UseIdentityByDefaultColumn for PostgreSQL
            modelBuilder.Entity<ProductCategory>(entity =>
            {
                entity.HasKey(e => e.Id);
                if (Database.IsNpgsql())
                    entity.Property(e => e.Id).UseIdentityByDefaultColumn();
                entity.Property(e => e.Name).IsRequired().HasMaxLength(100);
                entity.Property(e => e.Description).HasMaxLength(200);
                entity.Property(e => e.ColorCode).HasMaxLength(7);
                // Unique name per tenant
                entity.HasIndex(e => new { e.TenantId, e.Name }).IsUnique();
                entity.HasMany(e => e.Products)
                    .WithOne(p => p.Category)
                    .HasForeignKey(p => p.CategoryId)
                    .OnDelete(DeleteBehavior.SetNull); // Don't delete products when category is deleted
            });

            // Expense configuration
            modelBuilder.Entity<Expense>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Amount).HasColumnType("decimal(18,2)");
                entity.Property(e => e.VatRate).HasColumnType("decimal(18,4)");
                entity.Property(e => e.VatAmount).HasColumnType("decimal(18,4)");
                entity.Property(e => e.TotalAmount).HasColumnType("decimal(18,4)");
                entity.Property(e => e.PartialCreditPct).HasColumnType("decimal(18,4)");
                entity.Property(e => e.ClaimableVat).HasColumnType("decimal(18,4)");
                entity.Property(e => e.TaxType).HasMaxLength(32);
                entity.Property(e => e.Note).HasMaxLength(500);
                entity.Property(e => e.AttachmentUrl).HasMaxLength(500);
                entity.Property(e => e.RejectionReason).HasMaxLength(500);
                entity.Property(e => e.Status).HasConversion<int>(); // Store enum as int
                entity.HasOne(e => e.Category).WithMany(c => c.Expenses).HasForeignKey(e => e.CategoryId);
                entity.HasOne(e => e.Route).WithMany().HasForeignKey(e => e.RouteId).OnDelete(DeleteBehavior.SetNull);
                entity.HasOne(e => e.RecurringExpense).WithMany(r => r.GeneratedExpenses).HasForeignKey(e => e.RecurringExpenseId).OnDelete(DeleteBehavior.SetNull);
                entity.HasOne(e => e.ApprovedByUser).WithMany().HasForeignKey(e => e.ApprovedBy).OnDelete(DeleteBehavior.SetNull);
                entity.HasOne(e => e.CreatedByUser).WithMany().HasForeignKey(e => e.CreatedBy);
            });

            // InventoryTransaction configuration
            modelBuilder.Entity<InventoryTransaction>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.ChangeQty).HasColumnType("decimal(18,2)");
                entity.Property(e => e.TransactionType).HasConversion<string>();
                entity.HasOne(e => e.Product).WithMany().HasForeignKey(e => e.ProductId);
            });

            // AuditLog configuration
            modelBuilder.Entity<AuditLog>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Action).IsRequired().HasMaxLength(200);
                entity.Property(e => e.EntityType).HasMaxLength(100);
                entity.Property(e => e.EntityId);
                entity.Property(e => e.OldValues).HasColumnType(Database.IsNpgsql() ? "text" : "TEXT");
                entity.Property(e => e.NewValues).HasColumnType(Database.IsNpgsql() ? "text" : "TEXT");
                entity.Property(e => e.IpAddress).HasMaxLength(45);
                entity.Property(e => e.Details).HasColumnType(Database.IsNpgsql() ? "text" : "TEXT");
                entity.Property(e => e.CreatedAt).IsRequired();

                entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId);

                // Indexes for common queries
                entity.HasIndex(e => e.CreatedAt);
                entity.HasIndex(e => e.UserId);
                entity.HasIndex(e => e.TenantId);
                entity.HasIndex(e => new { e.EntityType, e.EntityId });
            });

            modelBuilder.Entity<UserSession>(entity =>
            {
                entity.HasKey(e => e.Id);
                if (Database.IsNpgsql())
                    entity.Property(e => e.Id).UseIdentityByDefaultColumn();
                entity.Property(e => e.UserAgent).HasMaxLength(500);
                entity.Property(e => e.IpAddress).HasMaxLength(45);
                entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId);
                entity.HasIndex(e => e.TenantId);
                entity.HasIndex(e => e.LoginAt);
            });

            modelBuilder.Entity<ErrorLog>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.TraceId).HasMaxLength(64);
                entity.Property(e => e.ErrorCode).HasMaxLength(64);
                entity.Property(e => e.Message).HasMaxLength(2000);
                entity.Property(e => e.Path).HasMaxLength(500);
                entity.Property(e => e.Method).HasMaxLength(16);
                entity.HasIndex(e => e.CreatedAt);
                entity.HasIndex(e => e.TenantId);
                entity.HasIndex(e => e.ResolvedAt);
            });

            // VatReturnPeriod - FTA Form 201 period snapshot and lock
            modelBuilder.Entity<VatReturnPeriod>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.PeriodType).HasMaxLength(10);
                entity.Property(e => e.PeriodLabel).HasMaxLength(20);
                entity.Property(e => e.Status).HasMaxLength(15);
                entity.Property(e => e.Box1a).HasColumnType("decimal(18,4)");
                entity.Property(e => e.Box1b).HasColumnType("decimal(18,4)");
                entity.Property(e => e.Box2).HasColumnType("decimal(18,4)");
                entity.Property(e => e.Box3).HasColumnType("decimal(18,4)");
                entity.Property(e => e.Box4).HasColumnType("decimal(18,4)");
                entity.Property(e => e.Box9b).HasColumnType("decimal(18,4)");
                entity.Property(e => e.Box10).HasColumnType("decimal(18,4)");
                entity.Property(e => e.Box11).HasColumnType("decimal(18,4)");
                entity.Property(e => e.Box12).HasColumnType("decimal(18,4)");
                entity.Property(e => e.Box13a).HasColumnType("decimal(18,4)");
                entity.Property(e => e.Box13b).HasColumnType("decimal(18,4)");
                entity.Property(e => e.PetroleumExcluded).HasColumnType("decimal(18,4)");
                entity.HasIndex(e => new { e.TenantId, e.PeriodStart, e.PeriodEnd }).IsUnique();
                entity.HasIndex(e => e.TenantId);
            });

            // BUG #2.7 FIX: FailedLoginAttempt configuration - persistent login lockout tracking
            modelBuilder.Entity<FailedLoginAttempt>(entity =>
            {
                entity.HasKey(e => e.Id);
                if (Database.IsNpgsql())
                    entity.Property(e => e.Id).UseIdentityByDefaultColumn();
                entity.Property(e => e.Email).IsRequired().HasMaxLength(100);
                entity.Property(e => e.FailedCount).IsRequired().HasDefaultValue(1);
                entity.Property(e => e.LastAttemptAt).IsRequired();
                entity.Property(e => e.CreatedAt).IsRequired();
                // Unique index on Email for fast lookups
                entity.HasIndex(e => e.Email).IsUnique();
                // Index on LockoutUntil for cleanup queries
                entity.HasIndex(e => e.LockoutUntil);
                // Index on LastAttemptAt for pruning old attempts
                entity.HasIndex(e => e.LastAttemptAt);
            });

            modelBuilder.Entity<DemoRequest>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.CompanyName).IsRequired().HasMaxLength(200);
                entity.Property(e => e.ContactName).IsRequired().HasMaxLength(100);
                entity.Property(e => e.WhatsApp).HasMaxLength(20);
                entity.Property(e => e.Email).IsRequired().HasMaxLength(100);
                entity.Property(e => e.Country).HasMaxLength(10);
                entity.Property(e => e.Industry).HasMaxLength(100);
                entity.Property(e => e.MonthlySalesRange).HasMaxLength(50);
                entity.Property(e => e.Status).HasConversion<string>();
                entity.Property(e => e.RejectionReason).HasMaxLength(500);
                entity.HasIndex(e => e.Status);
                entity.HasIndex(e => e.Email);
                entity.HasIndex(e => e.CreatedAt);
            });

            // Setting configuration - Production PostgreSQL has column "Value" (PascalCase); explicit mapping for correct SQL
            modelBuilder.Entity<Setting>(entity =>
            {
                // MULTI-TENANT: Composite key (Key + OwnerId)
                entity.HasKey(e => new { e.Key, e.OwnerId });
                entity.HasIndex(e => e.OwnerId);
                entity.Property(e => e.Value).HasColumnName("Value");
            });

            // PriceChangeLog configuration
            modelBuilder.Entity<PriceChangeLog>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.OldPrice).HasColumnType("decimal(18,2)");
                entity.Property(e => e.NewPrice).HasColumnType("decimal(18,2)");
                entity.Property(e => e.PriceDifference).HasColumnType("decimal(18,2)");
                entity.HasOne(e => e.Product).WithMany().HasForeignKey(e => e.ProductId);
                entity.HasOne(e => e.ChangedByUser).WithMany().HasForeignKey(e => e.ChangedBy);
            });

            // DamageCategory configuration - UseIdentityByDefaultColumn for PostgreSQL
            modelBuilder.Entity<DamageCategory>(entity =>
            {
                entity.HasKey(e => e.Id);
                if (Database.IsNpgsql())
                    entity.Property(e => e.Id).UseIdentityByDefaultColumn();
                entity.Property(e => e.Name).IsRequired().HasMaxLength(100);
                entity.HasIndex(e => e.TenantId);
                entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId);
            });

            // CreditNote configuration (ERP: credit note for returns on paid invoices)
            modelBuilder.Entity<CreditNote>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Amount).HasColumnType("decimal(18,2)");
                entity.Property(e => e.Status).HasMaxLength(20);
                entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId);
                entity.HasOne(e => e.Customer).WithMany().HasForeignKey(e => e.CustomerId);
                entity.HasOne(e => e.LinkedReturn).WithMany().HasForeignKey(e => e.LinkedReturnId);
                entity.HasOne(e => e.CreatedByUser).WithMany().HasForeignKey(e => e.CreatedBy);
                entity.HasIndex(e => e.TenantId);
                entity.HasIndex(e => new { e.TenantId, e.CustomerId });
            });

            // DamageInventory configuration (ERP: damaged return stock tracking)
            modelBuilder.Entity<DamageInventory>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Quantity).HasColumnType("decimal(18,2)");
                entity.HasIndex(e => new { e.TenantId, e.ProductId, e.BranchId });
                entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId);
                entity.HasOne(e => e.Product).WithMany().HasForeignKey(e => e.ProductId);
                entity.HasOne(e => e.Branch).WithMany().HasForeignKey(e => e.BranchId).IsRequired(false);
                entity.HasOne(e => e.SourceReturn).WithMany().HasForeignKey(e => e.SourceReturnId).IsRequired(false);
            });

            // SaleReturn configuration
            modelBuilder.Entity<SaleReturn>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.ReturnNo).IsRequired().HasMaxLength(100);
                entity.HasIndex(e => e.ReturnNo).IsUnique();
                entity.Property(e => e.Subtotal).HasColumnType("decimal(18,2)");
                entity.Property(e => e.VatTotal).HasColumnType("decimal(18,2)");
                entity.Property(e => e.Discount).HasColumnType("decimal(18,2)");
                entity.Property(e => e.GrandTotal).HasColumnType("decimal(18,2)");
                entity.Property(e => e.Status).HasConversion<string>();
                entity.Property(e => e.ReturnType).HasMaxLength(20);
                entity.Property(e => e.RefundStatus).HasMaxLength(20);
                entity.HasOne(e => e.Sale).WithMany().HasForeignKey(e => e.SaleId);
                entity.HasOne(e => e.Customer).WithMany().HasForeignKey(e => e.CustomerId);
                entity.HasOne(e => e.CreatedByUser).WithMany().HasForeignKey(e => e.CreatedBy);
                entity.HasOne(e => e.Branch).WithMany().HasForeignKey(e => e.BranchId).IsRequired(false);
                entity.HasOne(e => e.Route).WithMany().HasForeignKey(e => e.RouteId).IsRequired(false);
                entity.HasIndex(e => e.ReturnDate);
                entity.HasIndex(e => new { e.TenantId, e.ReturnDate });
                entity.HasIndex(e => e.BranchId);
                entity.HasIndex(e => e.RouteId);
            });

            // SaleReturnItem configuration
            modelBuilder.Entity<SaleReturnItem>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.UnitType).IsRequired().HasMaxLength(20);
                entity.Property(e => e.Qty).HasColumnType("decimal(18,2)");
                entity.Property(e => e.UnitPrice).HasColumnType("decimal(18,2)");
                entity.Property(e => e.VatAmount).HasColumnType("decimal(18,2)");
                entity.Property(e => e.LineTotal).HasColumnType("decimal(18,2)");
                entity.HasOne(e => e.SaleReturn).WithMany(s => s.Items).HasForeignKey(e => e.SaleReturnId);
                entity.HasOne(e => e.SaleItem).WithMany().HasForeignKey(e => e.SaleItemId);
                entity.HasOne(e => e.Product).WithMany().HasForeignKey(e => e.ProductId);
                entity.HasOne(e => e.DamageCategory).WithMany().HasForeignKey(e => e.DamageCategoryId).IsRequired(false);
            });

            // PurchaseReturn configuration
            modelBuilder.Entity<PurchaseReturn>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.ReturnNo).IsRequired().HasMaxLength(100);
                entity.HasIndex(e => e.ReturnNo).IsUnique();
                entity.Property(e => e.Subtotal).HasColumnType("decimal(18,2)");
                entity.Property(e => e.VatTotal).HasColumnType("decimal(18,2)");
                entity.Property(e => e.GrandTotal).HasColumnType("decimal(18,2)");
                entity.Property(e => e.Status).HasConversion<string>();
                entity.HasOne(e => e.Purchase).WithMany().HasForeignKey(e => e.PurchaseId);
                entity.HasOne(e => e.CreatedByUser).WithMany().HasForeignKey(e => e.CreatedBy);
            });

            // PurchaseReturnItem configuration
            modelBuilder.Entity<PurchaseReturnItem>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.UnitType).IsRequired().HasMaxLength(20);
                entity.Property(e => e.Qty).HasColumnType("decimal(18,2)");
                entity.Property(e => e.UnitCost).HasColumnType("decimal(18,2)");
                entity.Property(e => e.LineTotal).HasColumnType("decimal(18,2)");
                entity.HasOne(e => e.PurchaseReturn).WithMany(p => p.Items).HasForeignKey(e => e.PurchaseReturnId);
                entity.HasOne(e => e.PurchaseItem).WithMany().HasForeignKey(e => e.PurchaseItemId);
                entity.HasOne(e => e.Product).WithMany().HasForeignKey(e => e.ProductId);
            });

            // Sale - Add soft delete and edit tracking
            modelBuilder.Entity<Sale>(entity =>
            {
                entity.HasOne(e => e.LastModifiedByUser).WithMany().HasForeignKey(e => e.LastModifiedBy).OnDelete(DeleteBehavior.NoAction);
                entity.HasOne(e => e.DeletedByUser).WithMany().HasForeignKey(e => e.DeletedBy).OnDelete(DeleteBehavior.NoAction);
            });

            // Branch configuration (ManagerUserId maps to ManagerId in DB; Manager navigation uses same FK to avoid EF generating ManagerId1)
            modelBuilder.Entity<Branch>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Name).IsRequired().HasMaxLength(200);
                entity.Property(e => e.Address).HasMaxLength(500);
                entity.Property(e => e.ManagerUserId).HasColumnName("ManagerId");
                entity.HasOne(e => e.Tenant).WithMany(t => t.Branches).HasForeignKey(e => e.TenantId);
                entity.HasOne(e => e.Manager).WithMany().HasForeignKey(e => e.ManagerUserId).IsRequired(false);
                entity.HasIndex(e => e.TenantId);
            });

            // Route configuration
            modelBuilder.Entity<HexaBill.Api.Models.Route>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Name).IsRequired().HasMaxLength(200);
                entity.HasOne(e => e.Branch).WithMany(b => b.Routes).HasForeignKey(e => e.BranchId);
                entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId);
                entity.HasOne(e => e.AssignedStaff).WithMany().HasForeignKey(e => e.AssignedStaffId).OnDelete(DeleteBehavior.SetNull);
                entity.HasIndex(e => e.BranchId);
                entity.HasIndex(e => e.TenantId);
            });

            // RouteCustomer configuration - UseIdentityByDefaultColumn for PostgreSQL (same fix as BranchStaff/RouteStaff)
            modelBuilder.Entity<RouteCustomer>(entity =>
            {
                entity.HasKey(e => e.Id);
                if (Database.IsNpgsql())
                    entity.Property(e => e.Id).UseIdentityByDefaultColumn();
                entity.HasOne(e => e.Route).WithMany(r => r.RouteCustomers).HasForeignKey(e => e.RouteId);
                entity.HasOne(e => e.Customer).WithMany().HasForeignKey(e => e.CustomerId);
                entity.HasIndex(e => new { e.RouteId, e.CustomerId }).IsUnique();
            });

            // RouteStaff configuration - UseIdentityByDefaultColumn for PostgreSQL (same fix as BranchStaff)
            modelBuilder.Entity<RouteStaff>(entity =>
            {
                entity.HasKey(e => e.Id);
                if (Database.IsNpgsql())
                    entity.Property(e => e.Id).UseIdentityByDefaultColumn();
                entity.HasOne(e => e.Route).WithMany(r => r.RouteStaff).HasForeignKey(e => e.RouteId);
                entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId);
                entity.HasIndex(e => new { e.RouteId, e.UserId }).IsUnique();
            });

            // BranchStaff configuration - UseIdentityByDefaultColumn for PostgreSQL (fixes "null value in column Id" 500)
            modelBuilder.Entity<BranchStaff>(entity =>
            {
                entity.HasKey(e => e.Id);
                if (Database.IsNpgsql())
                    entity.Property(e => e.Id).UseIdentityByDefaultColumn();
                entity.HasOne(e => e.Branch).WithMany(b => b.BranchStaff).HasForeignKey(e => e.BranchId);
                entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId);
                entity.HasIndex(e => new { e.BranchId, e.UserId }).IsUnique();
            });

            // RouteExpense configuration - UseIdentityByDefaultColumn for PostgreSQL (same fix as BranchStaff/RouteStaff)
            modelBuilder.Entity<RouteExpense>(entity =>
            {
                entity.HasKey(e => e.Id);
                if (Database.IsNpgsql())
                    entity.Property(e => e.Id).UseIdentityByDefaultColumn();
                entity.Property(e => e.Amount).HasColumnType("decimal(18,2)");
                entity.Property(e => e.Description).HasMaxLength(500);
                entity.Property(e => e.Category).HasConversion<string>();
                entity.HasOne(e => e.Route).WithMany(r => r.RouteExpenses).HasForeignKey(e => e.RouteId);
                entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId);
                entity.HasOne(e => e.CreatedByUser).WithMany().HasForeignKey(e => e.CreatedBy);
                entity.HasIndex(e => e.RouteId);
                entity.HasIndex(e => e.TenantId);
                entity.HasIndex(e => e.ExpenseDate);
            });

            // CustomerVisit configuration - UseIdentityByDefaultColumn for PostgreSQL (same fix as BranchStaff/RouteStaff)
            modelBuilder.Entity<CustomerVisit>(entity =>
            {
                entity.HasKey(e => e.Id);
                if (Database.IsNpgsql())
                    entity.Property(e => e.Id).UseIdentityByDefaultColumn();
                entity.Property(e => e.Status).HasConversion<string>().HasDefaultValue(VisitStatus.NotVisited);
                entity.Property(e => e.Notes).HasMaxLength(500);
                entity.Property(e => e.PaymentCollected).HasColumnType("decimal(18,2)");
                entity.HasOne(e => e.Route).WithMany().HasForeignKey(e => e.RouteId);
                entity.HasOne(e => e.Customer).WithMany().HasForeignKey(e => e.CustomerId);
                entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId);
                entity.HasOne(e => e.Staff).WithMany().HasForeignKey(e => e.StaffId).OnDelete(DeleteBehavior.SetNull);
                entity.HasIndex(e => new { e.RouteId, e.CustomerId, e.VisitDate }).IsUnique();
                entity.HasIndex(e => e.TenantId);
                entity.HasIndex(e => e.VisitDate);
            });

            // RecurringExpense configuration - UseIdentityByDefaultColumn for PostgreSQL
            modelBuilder.Entity<RecurringExpense>(entity =>
            {
                entity.HasKey(e => e.Id);
                if (Database.IsNpgsql())
                    entity.Property(e => e.Id).UseIdentityByDefaultColumn();
            });

            // HeldInvoice configuration - UseIdentityByDefaultColumn for PostgreSQL
            modelBuilder.Entity<HeldInvoice>(entity =>
            {
                entity.HasKey(e => e.Id);
                if (Database.IsNpgsql())
                    entity.Property(e => e.Id).UseIdentityByDefaultColumn();
                entity.Property(e => e.RoundOff).HasColumnType("decimal(18,2)");
            });

            // Seed data
            // DISABLED: Seed data moved to Program.cs startup to avoid PostgreSQL migration issues
            // SeedData(modelBuilder);
        }

        private void SeedData(ModelBuilder modelBuilder)
        {
            // MOVED TO Program.cs - Seeding is now done at runtime, not in migrations
            // This prevents DateTime.UtcNow issues in PostgreSQL migrations
        }
    }
}

