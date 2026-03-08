/*
Purpose: Email service for sending invoices and notifications via SMTP
Author: HexaBill
Date: 2025
*/
using System.Net;
using System.Net.Mail;
using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace HexaBill.Api.Shared.Services;

public class EmailService : IEmailService
{
    private readonly IConfiguration _configuration;
    private readonly ILogger<EmailService> _logger;
    private readonly string? _host;
    private readonly int _port;
    private readonly string? _user;
    private readonly string? _password;
    private readonly string _fromAddress;
    private readonly string _fromName;

    public EmailService(IConfiguration configuration, ILogger<EmailService> logger)
    {
        _configuration = configuration;
        _logger = logger;
        _host = Environment.GetEnvironmentVariable("SMTP_HOST") ?? configuration["EmailSettings:SmtpHost"] ?? configuration["BackupSettings:Email:SmtpServer"];
        _port = int.TryParse(Environment.GetEnvironmentVariable("SMTP_PORT"), out var p) ? p
            : configuration.GetValue<int>("EmailSettings:SmtpPort", configuration.GetValue<int>("BackupSettings:Email:SmtpPort", 587));
        _user = Environment.GetEnvironmentVariable("SMTP_USER") ?? configuration["EmailSettings:SmtpUser"] ?? configuration["BackupSettings:Email:Username"];
        _password = Environment.GetEnvironmentVariable("SMTP_PASS") ?? configuration["EmailSettings:SmtpPassword"] ?? configuration["BackupSettings:Email:Password"];
        _fromAddress = Environment.GetEnvironmentVariable("SMTP_FROM") ?? configuration["EmailSettings:FromAddress"] ?? _user ?? "noreply@hexabill.com";
        _fromName = configuration["EmailSettings:FromName"] ?? "HexaBill";
    }

    public bool IsConfigured => !string.IsNullOrWhiteSpace(_host) && !string.IsNullOrWhiteSpace(_user) && !string.IsNullOrWhiteSpace(_password);

    public async Task SendAsync(string to, string subject, string body, byte[]? attachmentBytes = null, string? attachmentFileName = null, CancellationToken ct = default)
    {
        if (!IsConfigured)
        {
            _logger.LogWarning("Email not sent - SMTP not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS.");
            throw new InvalidOperationException("Email sending is not configured. Please configure SMTP settings in Settings > Email.");
        }

        using var client = new SmtpClient(_host, _port)
        {
            EnableSsl = _port == 465 || _port == 587,
            Credentials = new NetworkCredential(_user, _password)
        };

        var message = new MailMessage
        {
            From = new MailAddress(_fromAddress, _fromName),
            Subject = subject,
            Body = body,
            IsBodyHtml = true,
            BodyEncoding = Encoding.UTF8
        };
        message.To.Add(to);

        if (attachmentBytes != null && attachmentBytes.Length > 0 && !string.IsNullOrWhiteSpace(attachmentFileName))
        {
            var stream = new MemoryStream(attachmentBytes);
            var attachment = new Attachment(stream, attachmentFileName, "application/pdf");
            message.Attachments.Add(attachment);
        }

        await client.SendMailAsync(message, ct);
        _logger.LogInformation("Email sent to {To}, subject: {Subject}", to, subject);
    }
}
