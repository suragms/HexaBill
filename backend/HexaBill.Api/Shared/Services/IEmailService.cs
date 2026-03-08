namespace HexaBill.Api.Shared.Services;

public interface IEmailService
{
    /// <summary>Returns true if SMTP is configured and email sending is available.</summary>
    bool IsConfigured { get; }

    /// <summary>Send email with optional attachment.</summary>
    Task SendAsync(string to, string subject, string body, byte[]? attachmentBytes = null, string? attachmentFileName = null, CancellationToken ct = default);
}
