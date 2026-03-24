using System.Text.Json;
using System.Text.Json.Serialization;
using Npgsql;

// ZAYOGA GENERAL TRADING - One-off data migration script
// Run from repo root:
//   dotnet run --project backend/HexaBill.Api/Scripts/ZayogaMigration
//
// Reads backend/HexaBill.Api/.env for DATABASE_URL_EXTERNAL (or DB_HOST_EXTERNAL, DB_NAME, DB_USER, DB_PASSWORD)
// and migrates ZAYOGA invoices, customers, purchases, expenses, and products into Render Postgres.

var cwd = Directory.GetCurrentDirectory();
var apiDir = Path.Combine(cwd, "backend", "HexaBill.Api");
var envPath = Path.Combine(apiDir, ".env");

if (!File.Exists(envPath) && File.Exists(Path.Combine(cwd, ".env")))
{
    apiDir = cwd;
    envPath = Path.Combine(cwd, ".env");
}

if (!File.Exists(envPath))
{
    Console.Error.WriteLine("❌ .env not found at " + envPath);
    return 1;
}

// Load .env (same conventions as Scripts/RunSql/Program.cs)
var env = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
foreach (var line in File.ReadAllLines(envPath))
{
    var s = line.Trim();
    if (s.Length == 0 || s.StartsWith('#')) continue;
    var i = s.IndexOf('=');
    if (i > 0)
    {
        var v = s[(i + 1)..].Trim();
        if (v.Length >= 2 && ((v.StartsWith('"') && v.EndsWith('"')) || (v.StartsWith("'") && v.EndsWith("'"))))
            v = v[1..^1];
        env[s[..i].Trim()] = v;
    }
}

string connStr;
var host = env.GetValueOrDefault("DB_HOST_EXTERNAL") ?? env.GetValueOrDefault("DB_HOST_INTERNAL");
var port = env.GetValueOrDefault("DB_PORT") ?? "5432";
var db = env.GetValueOrDefault("DB_NAME");
var user = env.GetValueOrDefault("DB_USER");
var pass = env.GetValueOrDefault("DB_PASSWORD");

if (!string.IsNullOrEmpty(host) && !string.IsNullOrEmpty(db) && !string.IsNullOrEmpty(user) && !string.IsNullOrEmpty(pass))
{
    var sb = new NpgsqlConnectionStringBuilder
    {
        Host = host,
        Port = int.Parse(port),
        Database = db,
        Username = user,
        Password = pass
    };
    connStr = sb.ConnectionString;
}
else
{
    connStr = env.GetValueOrDefault("DATABASE_URL_EXTERNAL") ?? env.GetValueOrDefault("DATABASE_URL") ?? "";
    if (string.IsNullOrWhiteSpace(connStr))
    {
        Console.Error.WriteLine("❌ Missing DB_HOST_EXTERNAL, DB_NAME, DB_USER, DB_PASSWORD or DATABASE_URL in .env");
        return 1;
    }

    if (connStr.StartsWith("postgresql://", StringComparison.OrdinalIgnoreCase) ||
        connStr.StartsWith("postgres://", StringComparison.OrdinalIgnoreCase))
    {
        try
        {
            var uri = new Uri(connStr);
            var seg = uri.AbsolutePath.TrimStart('/');
            var builder = new NpgsqlConnectionStringBuilder
            {
                Host = uri.Host,
                Port = uri.Port > 0 ? uri.Port : 5432,
                Database = string.IsNullOrEmpty(seg) ? "postgres" : seg,
                Username = uri.UserInfo?.Split(':')[0],
                Password = uri.UserInfo?.Contains(':') == true ? string.Join(":", uri.UserInfo.Split(':').Skip(1)) : null
            };
            connStr = builder.ConnectionString;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("❌ Could not parse DATABASE_URL as URI: " + ex.Message);
            return 1;
        }
    }
}

Console.WriteLine("✅ Using PostgreSQL connection from .env");

// CSV invoice AMOUNT is VAT-inclusive (UAE 5%); align with SaleService / VatCalculator rounding.
static (decimal Net, decimal Vat) SplitVatInclusiveUae(decimal grossInclusive)
{
    const decimal r = 0.05m;
    var net = Math.Round(grossInclusive / (1m + r), 2, MidpointRounding.AwayFromZero);
    var vat = Math.Round(grossInclusive - net, 2, MidpointRounding.AwayFromZero);
    return (net, vat);
}

// Load migration JSON
var dataPath = Path.Combine(apiDir, "Scripts", "ZayogaMigration", "ZayogaMigrationData.json");
if (!File.Exists(dataPath))
{
    Console.Error.WriteLine("❌ Migration JSON not found at " + dataPath);
    return 1;
}

Console.WriteLine("📦 Loading migration data from " + dataPath);
var json = await File.ReadAllTextAsync(dataPath);

var options = new JsonSerializerOptions
{
    PropertyNameCaseInsensitive = true,
    ReadCommentHandling = JsonCommentHandling.Skip,
};

var payload = JsonSerializer.Deserialize<ZayogaPayload>(json, options);
if (payload == null)
{
    Console.Error.WriteLine("❌ Failed to deserialize migration JSON.");
    return 1;
}

const int TenantId = 6;
const int OwnerId = 6;

await using var conn = new NpgsqlConnection(connStr);
await conn.OpenAsync();

Console.WriteLine("✅ Connected to PostgreSQL.");

// Resolve CreatedBy user (Owner)
int createdByUserId;
await using (var cmd = new NpgsqlCommand(
           "SELECT \"Id\" FROM \"Users\" WHERE \"TenantId\"=@tid AND \"Role\"='Owner' ORDER BY \"Id\" LIMIT 1;", conn))
{
    cmd.Parameters.AddWithValue("tid", TenantId);
    var res = await cmd.ExecuteScalarAsync();
    if (res == null)
    {
        Console.Error.WriteLine("❌ No owner user found for TenantId=6. Aborting.");
        return 1;
    }
    createdByUserId = (int)(res);
}

Console.WriteLine($"✅ Owner user resolved: Id={createdByUserId}");

// PREFLIGHT: load existing data into memory
var existingCustomers = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
var existingSales = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
var existingSuppliers = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
var existingProductsBySku = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

// Customers
await using (var cmd = new NpgsqlCommand(
           "SELECT \"Id\", \"Name\" FROM \"Customers\" WHERE \"TenantId\"=@tid;", conn))
{
    cmd.Parameters.AddWithValue("tid", TenantId);
    await using var reader = await cmd.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        var id = reader.GetInt32(0);
        var name = reader.GetString(1).Trim();
        if (!existingCustomers.ContainsKey(name.ToUpperInvariant()))
            existingCustomers[name.ToUpperInvariant()] = id;
    }
}
Console.WriteLine($"👥 Existing customers: {existingCustomers.Count}");

// Sales
await using (var cmd = new NpgsqlCommand(
           "SELECT \"InvoiceNo\" FROM \"Sales\" WHERE \"TenantId\"=@tid;", conn))
{
    cmd.Parameters.AddWithValue("tid", TenantId);
    await using var reader = await cmd.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        existingSales.Add(reader.GetString(0));
    }
}
Console.WriteLine($"🧾 Existing sales invoices: {existingSales.Count}");

// Suppliers
await using (var cmd = new NpgsqlCommand(
           "SELECT \"Id\", \"Name\" FROM \"Suppliers\" WHERE \"TenantId\"=@tid;", conn))
{
    cmd.Parameters.AddWithValue("tid", TenantId);
    await using var reader = await cmd.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        var id = reader.GetInt32(0);
        var name = reader.GetString(1).Trim();
        existingSuppliers[name.ToUpperInvariant()] = id;
    }
}
Console.WriteLine($"🏢 Existing suppliers: {existingSuppliers.Count}");

// Products by SKU
await using (var cmd = new NpgsqlCommand(
           "SELECT \"Id\", \"Sku\" FROM \"Products\" WHERE \"TenantId\"=@tid;", conn))
{
    cmd.Parameters.AddWithValue("tid", TenantId);
    await using var reader = await cmd.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        var id = reader.GetInt32(0);
        var sku = reader.IsDBNull(1) ? "" : reader.GetString(1);
        if (!string.IsNullOrWhiteSpace(sku))
            existingProductsBySku[sku.ToUpperInvariant()] = id;
    }
}
Console.WriteLine($"📦 Existing products (by SKU): {existingProductsBySku.Count}");

// STEP 2 – CUSTOMERS
var allCustomerNames = payload.AllCustomersFromInvoices ?? Array.Empty<string>();
var customersInserted = 0;
var customerNameToId = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

await using (var tx = await conn.BeginTransactionAsync())
{
    foreach (var rawName in allCustomerNames)
    {
        var nameNorm = (rawName ?? string.Empty).Trim();
        if (nameNorm.Length == 0) continue;
        var key = nameNorm.ToUpperInvariant();
        if (existingCustomers.TryGetValue(key, out var existingId))
        {
            customerNameToId[key] = existingId;
            continue;
        }

        await using var insertCmd = new NpgsqlCommand(@"
INSERT INTO ""Customers"" 
(""OwnerId"", ""TenantId"", ""BranchId"", ""RouteId"", ""Name"", ""CustomerType"", ""Phone"", ""Email"", ""Trn"", ""Address"", 
 ""CreditLimit"", ""PaymentTerms"", ""TotalSales"", ""TotalPayments"", ""PendingBalance"", ""Balance"", ""CreatedAt"", ""UpdatedAt"")
VALUES (@ownerId, @tenantId, NULL, NULL, @name, @ctype, NULL, NULL, NULL, NULL,
        0, NULL, 0, 0, 0, 0, NOW(), NOW())
RETURNING ""Id"";", conn, tx);

        insertCmd.Parameters.AddWithValue("ownerId", OwnerId);
        insertCmd.Parameters.AddWithValue("tenantId", TenantId);
        insertCmd.Parameters.AddWithValue("name", nameNorm);
        insertCmd.Parameters.AddWithValue("ctype", 0); // CustomerType.Credit

        var id = (int)(await insertCmd.ExecuteScalarAsync() ?? 0);
        existingCustomers[key] = id;
        customerNameToId[key] = id;
        customersInserted++;
    }

    await tx.CommitAsync();
}

Console.WriteLine($"✅ Customers: checked={allCustomerNames.Length}, inserted={customersInserted}, existing={existingCustomers.Count - customersInserted}");

// STEP 3 – SUPPLIERS (unique vendors from purchases)
var vendors = (payload.Purchases ?? Array.Empty<PurchaseRow>())
    .Select(p => (p.Vendor ?? string.Empty).Trim())
    .Where(v => v.Length > 0)
    .Distinct(StringComparer.OrdinalIgnoreCase)
    .ToList();
var suppliersInserted = 0;
await using (var tx = await conn.BeginTransactionAsync())
{
    foreach (var vendor in vendors)
    {
        var key = vendor.ToUpperInvariant();
        if (existingSuppliers.ContainsKey(key)) continue;

        await using var insertCmd = new NpgsqlCommand(@"
INSERT INTO ""Suppliers"" 
(""TenantId"", ""Name"", ""NormalizedName"", ""Phone"", ""Email"", ""Address"", ""CategoryId"", ""CreditLimit"", ""PaymentTerms"", ""IsActive"", ""CreatedAt"", ""UpdatedAt"")
VALUES (@tenantId, @name, @norm, NULL, NULL, NULL, NULL, 0, NULL, true, NOW(), NOW())
RETURNING ""Id"";", conn, tx);

        insertCmd.Parameters.AddWithValue("tenantId", TenantId);
        insertCmd.Parameters.AddWithValue("name", vendor);
        insertCmd.Parameters.AddWithValue("norm", vendor.ToLowerInvariant());

        var id = (int)(await insertCmd.ExecuteScalarAsync() ?? 0);
        existingSuppliers[key] = id;
        suppliersInserted++;
    }
    await tx.CommitAsync();
}

Console.WriteLine($"✅ Suppliers: checked={vendors.Count}, inserted={suppliersInserted}, existing={existingSuppliers.Count - suppliersInserted}");

// STEP 4 – PRODUCTS (simple SKU generation: P001, P002, ...)
var products = payload.Products ?? Array.Empty<ProductRow>();
var productsInserted = 0;
var skuIndex = 1;
var firstProductId = existingProductsBySku.Values.FirstOrDefault();
await using (var tx = await conn.BeginTransactionAsync())
{
    foreach (var p in products)
    {
        var name = (p.Name ?? string.Empty).Trim();
        if (name.Length == 0) continue;

        // Generate deterministic SKU from index
        string skuCandidate;
        do
        {
            skuCandidate = $"ZP{skuIndex:000}";
            skuIndex++;
        } while (existingProductsBySku.ContainsKey(skuCandidate.ToUpperInvariant()));

        var key = skuCandidate.ToUpperInvariant();

        await using var insertCmd = new NpgsqlCommand(@"
INSERT INTO ""Products""
(""OwnerId"", ""TenantId"", ""Sku"", ""Barcode"", ""NameEn"", ""NameAr"", ""UnitType"", ""ConversionToBase"", ""CostPrice"", ""SellPrice"",
 ""StockQty"", ""ReorderLevel"", ""ExpiryDate"", ""DescriptionEn"", ""DescriptionAr"", ""CategoryId"", ""ImageUrl"", ""IsActive"", ""RowVersion"", ""CreatedAt"", ""UpdatedAt"")
VALUES (@ownerId, @tenantId, @sku, NULL, @name, NULL, 'PIECE', 1, @cost, @sell,
        0, 0, NULL, NULL, NULL, NULL, NULL, true, @rowVersion, NOW(), NOW())
RETURNING ""Id"";", conn, tx);

        insertCmd.Parameters.AddWithValue("ownerId", OwnerId);
        insertCmd.Parameters.AddWithValue("tenantId", TenantId);
        insertCmd.Parameters.AddWithValue("sku", skuCandidate);
        insertCmd.Parameters.AddWithValue("name", name);
        insertCmd.Parameters.AddWithValue("cost", p.LastCost);
        insertCmd.Parameters.AddWithValue("sell", p.LastCost);
        insertCmd.Parameters.AddWithValue("rowVersion", new byte[] { 0 });

        var id = (int)(await insertCmd.ExecuteScalarAsync() ?? 0);
        existingProductsBySku[key] = id;
        productsInserted++;
        if (firstProductId == 0)
            firstProductId = id;
    }

    await tx.CommitAsync();
}

Console.WriteLine($"✅ Products: source={products.Length}, inserted={productsInserted}, existing={existingProductsBySku.Count - productsInserted}");

// Ensure we have at least one product to use for synthetic SaleItems (optional)
if (firstProductId == 0)
{
    Console.WriteLine("⚠️ No products available to use for SaleItems. Sales will be created without line items.");
}

// STEP 5 – SALES (INVOICES) + PAYMENTS
var invoices = payload.Invoices ?? Array.Empty<InvoiceRow>();
var salesInserted = 0;
var paymentsInserted = 0;

await using (var tx = await conn.BeginTransactionAsync())
{
    foreach (var inv in invoices)
    {
        var invNo = (inv.InvNo ?? string.Empty).Trim();
        if (invNo.Length == 0) continue;
        if (existingSales.Contains(invNo)) continue; // skip existing

        var customerName = (inv.Customer ?? string.Empty).Trim();
        var customerKey = customerName.ToUpperInvariant();
        if (!customerNameToId.TryGetValue(customerKey, out var customerId) &&
            !existingCustomers.TryGetValue(customerKey, out customerId))
        {
            throw new Exception($"Customer '{customerName}' not found for invoice {invNo}");
        }

        // Parse date DD-MM-YYYY or YYYY-MM-DD
        DateTime invoiceDate;
        if (!DateTime.TryParseExact(inv.Date ?? "", new[] { "dd-MM-yyyy", "yyyy-MM-dd" },
                System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out invoiceDate))
        {
            throw new Exception($"Invalid date '{inv.Date}' for invoice {invNo}");
        }

        var totalAmount = inv.Amount;
        var amountPaid = inv.ReceivedAmount;
        var balance = inv.BalanceAmount;

        // Payment status
        var paymentStatus = "Pending";
        if (balance == 0 && totalAmount > 0)
            paymentStatus = "Paid";
        else if (amountPaid > 0 && balance > 0)
            paymentStatus = "Partial";

        // Insert Sale: amount is VAT-inclusive; Subtotal=net, VatTotal=VAT, GrandTotal=gross (unchanged)
        var (saleNet, saleVat) = totalAmount > 0 ? SplitVatInclusiveUae(totalAmount) : (0m, 0m);
        await using (var insertSale = new NpgsqlCommand(@"
INSERT INTO ""Sales""
(""OwnerId"", ""TenantId"", ""InvoiceNo"", ""InvoiceDate"", ""CustomerId"", ""BranchId"", ""RouteId"",
 ""Subtotal"", ""VatTotal"", ""Discount"", ""RoundOff"", ""GrandTotal"", ""TotalAmount"",
 ""PaidAmount"", ""PaymentStatus"", ""LastPaymentDate"", ""DueDate"", ""Notes"",
 ""CreatedBy"", ""CreatedAt"", ""LastModifiedBy"", ""LastModifiedAt"", ""IsDeleted"", ""DeletedBy"", ""DeletedAt"",
 ""IsFinalized"", ""IsLocked"", ""LockedAt"", ""EditReason"", ""Version"", ""RowVersion"",
 ""IsZeroInvoice"", ""VatScenario"")
VALUES
(@ownerId, @tenantId, @invNo, @invDate, @customerId, NULL, NULL,
 @subtotal, @vatTotal, 0, 0, @grandTotal, @grandTotal,
 @paidAmount, @paymentStatus, @lastPaymentDate, NULL, NULL,
 @createdBy, NOW(), NULL, NULL, false, NULL, NULL,
 true, false, NULL, NULL, 1, @rowVersion,
 false, 'Standard')
RETURNING ""Id"";", conn, tx))
        {
            insertSale.Parameters.AddWithValue("ownerId", OwnerId);
            insertSale.Parameters.AddWithValue("tenantId", TenantId);
            insertSale.Parameters.AddWithValue("invNo", invNo);
            insertSale.Parameters.AddWithValue("invDate", invoiceDate);
            insertSale.Parameters.AddWithValue("customerId", customerId);
            insertSale.Parameters.AddWithValue("subtotal", saleNet);
            insertSale.Parameters.AddWithValue("vatTotal", saleVat);
            insertSale.Parameters.AddWithValue("grandTotal", totalAmount);
            insertSale.Parameters.AddWithValue("paidAmount", amountPaid);
            insertSale.Parameters.AddWithValue("paymentStatus", paymentStatus);
            insertSale.Parameters.AddWithValue("lastPaymentDate", amountPaid > 0 ? invoiceDate : (object)DBNull.Value);
            insertSale.Parameters.AddWithValue("createdBy", createdByUserId);
            insertSale.Parameters.AddWithValue("rowVersion", new byte[] { 0 });

            var saleId = (int)(await insertSale.ExecuteScalarAsync() ?? 0);
            existingSales.Add(invNo);
            salesInserted++;

            // Optional SaleItem – only if we have a product available
            if (firstProductId != 0 && totalAmount > 0)
            {
                await using var insertItem = new NpgsqlCommand(@"
INSERT INTO ""SaleItems""
(""SaleId"", ""ProductId"", ""UnitType"", ""Qty"", ""UnitPrice"", ""Discount"", ""VatAmount"", ""LineTotal"", ""VatRate"", ""VatScenario"")
VALUES (@saleId, @productId, 'PIECE', 1, @unitPrice, 0, @lineVat, @lineTotal, @vatRate, 'Standard');", conn, tx);
                insertItem.Parameters.AddWithValue("saleId", saleId);
                insertItem.Parameters.AddWithValue("productId", firstProductId);
                insertItem.Parameters.AddWithValue("unitPrice", saleNet);
                insertItem.Parameters.AddWithValue("lineVat", saleVat);
                insertItem.Parameters.AddWithValue("lineTotal", totalAmount);
                insertItem.Parameters.AddWithValue("vatRate", 0.05m);
                await insertItem.ExecuteNonQueryAsync();
            }

            // STEP 6 – PAYMENTS for invoices with rec_amt > 0
            if (amountPaid > 0)
            {
                var mode = string.Equals(inv.Type, "Cash", StringComparison.OrdinalIgnoreCase)
                    ? "CASH"
                    : "CREDIT";

                await using var insertPayment = new NpgsqlCommand(@"
INSERT INTO ""Payments""
(""OwnerId"", ""TenantId"", ""SaleId"", ""SaleReturnId"", ""CustomerId"", ""Amount"", ""Mode"", ""Reference"", ""Status"",
 ""PaymentDate"", ""CreatedBy"", ""CreatedAt"", ""UpdatedAt"", ""RowVersion"")
VALUES
(@ownerId, @tenantId, @saleId, NULL, @customerId, @amount, @mode, @ref, @status,
 @payDate, @createdBy, NOW(), NULL, @rowVersion);", conn, tx);

                insertPayment.Parameters.AddWithValue("ownerId", OwnerId);
                insertPayment.Parameters.AddWithValue("tenantId", TenantId);
                insertPayment.Parameters.AddWithValue("saleId", saleId);
                insertPayment.Parameters.AddWithValue("customerId", customerId);
                insertPayment.Parameters.AddWithValue("amount", amountPaid);
                insertPayment.Parameters.AddWithValue("mode", mode);
                insertPayment.Parameters.AddWithValue("ref", inv.RefNo ?? (object)DBNull.Value);
                insertPayment.Parameters.AddWithValue("status", "CLEARED");
                insertPayment.Parameters.AddWithValue("payDate", invoiceDate);
                insertPayment.Parameters.AddWithValue("createdBy", createdByUserId);
                insertPayment.Parameters.AddWithValue("rowVersion", new byte[] { 0 });

                await insertPayment.ExecuteNonQueryAsync();
                paymentsInserted++;
            }
        }
    }

    await tx.CommitAsync();
}

Console.WriteLine($"✅ Sales: inserted={salesInserted}");
Console.WriteLine($"✅ Payments: inserted={paymentsInserted}");

// STEP 7 – PURCHASES
var purchaseRows = payload.Purchases ?? Array.Empty<PurchaseRow>();
var existingPurchaseInv = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
await using (var cmd = new NpgsqlCommand(
           "SELECT \"InvoiceNo\" FROM \"Purchases\" WHERE \"TenantId\"=@tid AND \"OwnerId\"=@oid;", conn))
{
    cmd.Parameters.AddWithValue("tid", TenantId);
    cmd.Parameters.AddWithValue("oid", OwnerId);
    await using var reader = await cmd.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        existingPurchaseInv.Add(reader.GetString(0));
    }
}

var purchasesInserted = 0;
await using (var tx = await conn.BeginTransactionAsync())
{
    foreach (var p in purchaseRows)
    {
        var invNo = (p.PurNo ?? string.Empty).Trim();
        if (invNo.Length == 0) continue;
        if (existingPurchaseInv.Contains(invNo)) continue;

        var vendorName = (p.Vendor ?? string.Empty).Trim();
        var vendorKey = vendorName.ToUpperInvariant();
        existingSuppliers.TryGetValue(vendorKey, out var supplierId);

        if (!DateTime.TryParseExact(p.Date ?? "", new[] { "dd-MM-yyyy", "yyyy-MM-dd" },
                System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var purDate))
        {
            throw new Exception($"Invalid purchase date '{p.Date}' for {invNo}");
        }

        var totalAmount = p.Amount;
        var subtotal = totalAmount; // keep simple; VATTotal=0
        var vatTotal = 0m;
        var amountPaid = string.Equals(p.Status, "Paid", StringComparison.OrdinalIgnoreCase) ? totalAmount : 0m;

        await using var insertPurchase = new NpgsqlCommand(@"
INSERT INTO ""Purchases""
(""OwnerId"", ""TenantId"", ""SupplierId"", ""SupplierName"", ""InvoiceNo"", ""ExternalReference"", ""ExpenseCategory"",
 ""PurchaseDate"", ""Subtotal"", ""VatTotal"", ""TotalAmount"", ""PaymentType"", ""AmountPaid"", ""DueDate"",
 ""InvoiceFilePath"", ""InvoiceFileName"", ""CreatedBy"", ""CreatedAt"", ""IsTaxClaimable"", ""IsReverseCharge"", ""ReverseChargeVat"")
VALUES
(@ownerId, @tenantId, @supplierId, @supplierName, @invNo, NULL, NULL,
 @date, @subtotal, @vatTotal, @totalAmount, @paymentType, @amountPaid, NULL,
 NULL, NULL, @createdBy, NOW(), @isTaxClaimableInt, 0, NULL);", conn, tx);

        insertPurchase.Parameters.AddWithValue("ownerId", OwnerId);
        insertPurchase.Parameters.AddWithValue("tenantId", TenantId);
        if (supplierId > 0) insertPurchase.Parameters.AddWithValue("supplierId", supplierId);
        else insertPurchase.Parameters.AddWithValue("supplierId", DBNull.Value);
        insertPurchase.Parameters.AddWithValue("supplierName", vendorName);
        insertPurchase.Parameters.AddWithValue("invNo", invNo);
        insertPurchase.Parameters.AddWithValue("date", purDate);
        insertPurchase.Parameters.AddWithValue("subtotal", subtotal);
        insertPurchase.Parameters.AddWithValue("vatTotal", vatTotal);
        insertPurchase.Parameters.AddWithValue("totalAmount", totalAmount);
        insertPurchase.Parameters.AddWithValue("paymentType", p.Type ?? (object)DBNull.Value);
        insertPurchase.Parameters.AddWithValue("amountPaid", amountPaid);
        insertPurchase.Parameters.AddWithValue("createdBy", createdByUserId);
        insertPurchase.Parameters.AddWithValue("isTaxClaimableInt", 1); // column is integer for PostgreSQL

        await insertPurchase.ExecuteNonQueryAsync();
        existingPurchaseInv.Add(invNo);
        purchasesInserted++;
    }

    await tx.CommitAsync();
}
Console.WriteLine($"✅ Purchases: inserted={purchasesInserted}");

// STEP 8 – EXPENSES
var expenseRows = payload.Expenses ?? Array.Empty<ExpenseRow>();

// Ensure an ExpenseCategory 'General' exists for TenantId=6
int expenseCategoryId;
await using (var cmd = new NpgsqlCommand(
           "SELECT \"Id\" FROM \"ExpenseCategories\" WHERE \"TenantId\"=@tid AND \"Name\"='General' ORDER BY \"Id\" LIMIT 1;", conn))
{
    cmd.Parameters.AddWithValue("tid", TenantId);
    var res = await cmd.ExecuteScalarAsync();
    if (res == null)
    {
        await using var insertCat = new NpgsqlCommand(@"
INSERT INTO ""ExpenseCategories""
(""TenantId"", ""Name"", ""ColorCode"", ""IsActive"", ""CreatedAt"", ""DefaultVatRate"", ""DefaultTaxType"", ""DefaultIsTaxClaimable"",
 ""DefaultIsEntertainment"", ""VatDefaultLocked"")
VALUES
(@tenantId, 'General', '#3B82F6', true, NOW(), 0.05, 'Standard', true, false, false)
RETURNING ""Id"";", conn);
        insertCat.Parameters.AddWithValue("tenantId", TenantId);
        expenseCategoryId = (int)(await insertCat.ExecuteScalarAsync() ?? 0);
    }
    else
    {
        expenseCategoryId = (int)res;
    }
}

var expensesInserted = 0;
await using (var tx = await conn.BeginTransactionAsync())
{
    foreach (var e in expenseRows)
    {
        if (!DateTime.TryParseExact(e.Date ?? "", new[] { "dd-MM-yyyy", "yyyy-MM-dd" },
                System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var expDate))
        {
            throw new Exception($"Invalid expense date '{e.Date}' for {e.ExpNo}");
        }

        var amount = e.Amount;
        var vat = e.Vat;
        var total = e.Total;

        await using var insertExp = new NpgsqlCommand(@"
INSERT INTO ""Expenses""
(""OwnerId"", ""TenantId"", ""BranchId"", ""RouteId"", ""CategoryId"", ""Amount"", ""Date"", ""Note"", ""CreatedBy"", ""CreatedAt"",
 ""AttachmentUrl"", ""Status"", ""RecurringExpenseId"", ""ApprovedBy"", ""ApprovedAt"", ""RejectionReason"",
 ""VatRate"", ""VatAmount"", ""TotalAmount"", ""IsTaxClaimable"", ""TaxType"", ""IsEntertainment"", ""PartialCreditPct"", ""ClaimableVat"", ""VatInclusive"")
VALUES
(@ownerId, @tenantId, NULL, NULL, @categoryId, @amount, @date, @note, @createdBy, NOW(),
 NULL, @status, NULL, NULL, NULL, NULL,
 @vatRate, @vatAmount, @totalAmount, @isTaxClaimableInt, 'Standard', @isEntertainmentInt, 100, @claimableVat, true);", conn, tx);

        insertExp.Parameters.AddWithValue("ownerId", OwnerId);
        insertExp.Parameters.AddWithValue("tenantId", TenantId);
        insertExp.Parameters.AddWithValue("categoryId", expenseCategoryId);
        insertExp.Parameters.AddWithValue("amount", amount);
        insertExp.Parameters.AddWithValue("date", expDate);
        insertExp.Parameters.AddWithValue("note", e.ExpNo ?? (object)DBNull.Value);
        insertExp.Parameters.AddWithValue("createdBy", createdByUserId);
        insertExp.Parameters.AddWithValue("status", 1); // ExpenseStatus.Approved
        var vatRate = amount > 0 && vat > 0 ? vat / amount : 0m;
        insertExp.Parameters.AddWithValue("vatRate", vatRate);
        insertExp.Parameters.AddWithValue("vatAmount", vat);
        insertExp.Parameters.AddWithValue("totalAmount", total);
        insertExp.Parameters.AddWithValue("isTaxClaimableInt", vat > 0 ? 1 : 0); // column is INTEGER
        insertExp.Parameters.AddWithValue("isEntertainmentInt", 0); // INTEGER flag
        insertExp.Parameters.AddWithValue("claimableVat", vat > 0 ? vat : 0m);

        await insertExp.ExecuteNonQueryAsync();
        expensesInserted++;
    }

    await tx.CommitAsync();
}
Console.WriteLine($"✅ Expenses: inserted={expensesInserted}");

// STEP 9 – CUSTOMER BALANCE RECALCULATION
Console.WriteLine("🔄 Recalculating customer balances for TenantId=6...");
await using (var cmdRecalc = new NpgsqlCommand(@"
UPDATE ""Customers"" c SET
  ""TotalSales"" = COALESCE((
      SELECT SUM(s.""GrandTotal"") FROM ""Sales"" s
      WHERE s.""CustomerId"" = c.""Id"" AND s.""TenantId"" = @tid AND s.""IsDeleted"" = false
  ), 0),
  ""TotalPayments"" = COALESCE((
      SELECT SUM(p.""Amount"") FROM ""Payments"" p
      WHERE p.""CustomerId"" = c.""Id"" AND p.""TenantId"" = @tid AND p.""Status"" = 'CLEARED' AND p.""SaleReturnId"" IS NULL
  ), 0),
  ""PendingBalance"" = ""TotalSales"" - ""TotalPayments"",
  ""Balance"" = ""TotalSales"" - ""TotalPayments"",
  ""UpdatedAt"" = NOW()
WHERE c.""TenantId"" = @tid;", conn))
{
    cmdRecalc.Parameters.AddWithValue("tid", TenantId);
    await cmdRecalc.ExecuteNonQueryAsync();
}
Console.WriteLine("✅ Customer balances recalculated.");

// VERIFICATION QUERIES
Console.WriteLine();
Console.WriteLine("📊 Running verification queries...");

long GetLong(string sql)
{
    using var cmd = new NpgsqlCommand(sql, conn);
    var obj = cmd.ExecuteScalar();
    return obj is long l ? l : Convert.ToInt64(obj ?? 0);
}

decimal GetDecimal(string sql)
{
    using var cmd = new NpgsqlCommand(sql, conn);
    var obj = cmd.ExecuteScalar();
    return obj is decimal d ? d : Convert.ToDecimal(obj ?? 0);
}

var countSales = GetLong("SELECT COUNT(*) FROM \"Sales\" WHERE \"TenantId\"=6;");
var totalAmountSales = GetDecimal("SELECT ROUND(SUM(\"TotalAmount\")::numeric,2) FROM \"Sales\" WHERE \"TenantId\"=6;");
var totalPaidSales = GetDecimal("SELECT ROUND(SUM(\"PaidAmount\")::numeric,2) FROM \"Sales\" WHERE \"TenantId\"=6;");
var totalOutstanding = GetDecimal("SELECT ROUND(SUM(\"TotalAmount\"-\"PaidAmount\")::numeric,2) FROM \"Sales\" WHERE \"TenantId\"=6;");
var unpaidCount = GetLong("SELECT COUNT(*) FROM \"Sales\" WHERE \"TenantId\"=6 AND \"PaidAmount\"=0 AND \"TotalAmount\">0;");
var partialCount = GetLong("SELECT COUNT(*) FROM \"Sales\" WHERE \"TenantId\"=6 AND \"PaidAmount\">0 AND \"TotalAmount\">\"PaidAmount\";");
var duplicateInvoices = GetLong("SELECT COUNT(*) FROM (SELECT \"InvoiceNo\", COUNT(*) c FROM \"Sales\" WHERE \"TenantId\"=6 GROUP BY \"InvoiceNo\" HAVING COUNT(*)>1) t;");
var countPurchases = GetLong("SELECT COUNT(*) FROM \"Purchases\" WHERE \"TenantId\"=6;");
var countExpenses = GetLong("SELECT COUNT(*) FROM \"Expenses\" WHERE \"TenantId\"=6;");

Console.WriteLine($"Sales count: {countSales} (expected 241)");
Console.WriteLine($"Sales total amount: {totalAmountSales} (expected 56513.16)");
Console.WriteLine($"Sales total paid: {totalPaidSales} (expected 45648.75)");
Console.WriteLine($"Sales outstanding: {totalOutstanding} (expected 10864.41)");
Console.WriteLine($"Unpaid invoices: {unpaidCount} (expected 34)");
Console.WriteLine($"Partial invoices: {partialCount} (expected 29)");
Console.WriteLine($"Duplicate invoices: {duplicateInvoices} (expected 0)");
Console.WriteLine($"Purchases count: {countPurchases} (expected 18)");
Console.WriteLine($"Expenses count: {countExpenses} (expected 21)");

Console.WriteLine();
Console.WriteLine("✅ Migration script completed. Review the above verification output for mismatches.");

return 0;

// DTOs for JSON payload (minimal for now)

public sealed class ZayogaPayload
{
    [JsonPropertyName("all_customers_from_invoices")]
    public string[]? AllCustomersFromInvoices { get; set; }

    [JsonPropertyName("invoices")]
    public InvoiceRow[]? Invoices { get; set; }

    [JsonPropertyName("purchases")]
    public PurchaseRow[]? Purchases { get; set; }

    [JsonPropertyName("expenses")]
    public ExpenseRow[]? Expenses { get; set; }

    [JsonPropertyName("products")]
    public ProductRow[]? Products { get; set; }
}

public sealed class InvoiceRow
{
    [JsonPropertyName("inv_no")] public string? InvNo { get; set; }
    [JsonPropertyName("type")] public string? Type { get; set; }
    [JsonPropertyName("customer")] public string? Customer { get; set; }
    [JsonPropertyName("ref_no")] public string? RefNo { get; set; }
    [JsonPropertyName("date")] public string? Date { get; set; }
    [JsonPropertyName("status")] public string? Status { get; set; }
    [JsonPropertyName("amount")] public decimal Amount { get; set; }
    [JsonPropertyName("rec_amt")] public decimal ReceivedAmount { get; set; }
    [JsonPropertyName("bal_amt")] public decimal BalanceAmount { get; set; }
    [JsonPropertyName("payment_status")] public string? PaymentStatus { get; set; }
}

public sealed class PurchaseRow
{
    [JsonPropertyName("pur_no")] public string? PurNo { get; set; }
    [JsonPropertyName("type")] public string? Type { get; set; }
    [JsonPropertyName("vendor")] public string? Vendor { get; set; }
    [JsonPropertyName("ref")] public string? Ref { get; set; }
    [JsonPropertyName("date")] public string? Date { get; set; }
    [JsonPropertyName("status")] public string? Status { get; set; }
    [JsonPropertyName("amount")] public decimal Amount { get; set; }
}

public sealed class ExpenseRow
{
    [JsonPropertyName("exp_no")] public string? ExpNo { get; set; }
    [JsonPropertyName("method")] public string? Method { get; set; }
    [JsonPropertyName("date")] public string? Date { get; set; }
    [JsonPropertyName("amount")] public decimal Amount { get; set; }
    [JsonPropertyName("vat")] public decimal Vat { get; set; }
    [JsonPropertyName("total")] public decimal Total { get; set; }
}

public sealed class ProductRow
{
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("last_cost")] public decimal LastCost { get; set; }
}

