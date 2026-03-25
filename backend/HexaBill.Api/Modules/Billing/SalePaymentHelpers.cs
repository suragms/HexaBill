using HexaBill.Api.Models;

namespace HexaBill.Api.Modules.Billing;

/// <summary>
/// Single place for payment-line cleared vs pending rules and sale payment state from cleared totals only.
/// </summary>
internal static class SalePaymentHelpers
{
    public static PaymentStatus GetPaymentLineStatus(PaymentMode mode)
    {
        return mode == PaymentMode.CHEQUE
            ? PaymentStatus.PENDING
            : (mode == PaymentMode.CASH || mode == PaymentMode.ONLINE || mode == PaymentMode.DEBIT
                ? PaymentStatus.CLEARED
                : PaymentStatus.PENDING);
    }

    public static bool IsClearedMode(PaymentMode mode) => GetPaymentLineStatus(mode) == PaymentStatus.CLEARED;

    /// <summary>
    /// Derives sale PaidAmount and PaymentStatus from the sum of cleared payment lines only.
    /// </summary>
    public static (decimal PaidAmount, SalePaymentStatus Status, DateTime? LastPaymentDate) ComputeSalePaymentStateFromClearedTotal(
        decimal clearedSumTotal,
        decimal grandTotal,
        DateTime? lastClearedPaymentDate)
    {
        clearedSumTotal = Math.Round(clearedSumTotal, 2, MidpointRounding.AwayFromZero);
        grandTotal = Math.Round(grandTotal, 2, MidpointRounding.AwayFromZero);

        if (grandTotal <= 0)
            return (0, SalePaymentStatus.Paid, lastClearedPaymentDate);

        // Match ledger / VAT rounding: treat as fully settled when within small drift (avoids Partial/Pending on full cash)
        const decimal settledEps = 0.05m;
        var shortfall = grandTotal - clearedSumTotal;
        if (shortfall <= settledEps)
            return (grandTotal, SalePaymentStatus.Paid, lastClearedPaymentDate);

        var paidAmount = Math.Min(clearedSumTotal, grandTotal);

        if (clearedSumTotal >= grandTotal)
            return (paidAmount, SalePaymentStatus.Paid, lastClearedPaymentDate);
        if (paidAmount > 0)
            return (paidAmount, SalePaymentStatus.Partial, lastClearedPaymentDate);
        return (0, SalePaymentStatus.Pending, null);
    }

    /// <summary>Compare last payment instants for reconcile (ignore sub-second noise).</summary>
    public static bool LastPaymentDatesMatch(DateTime? a, DateTime? b)
    {
        if (a == null && b == null) return true;
        if (a == null || b == null) return false;
        return Math.Abs((a.Value - b.Value).TotalSeconds) < 1.5;
    }
}
