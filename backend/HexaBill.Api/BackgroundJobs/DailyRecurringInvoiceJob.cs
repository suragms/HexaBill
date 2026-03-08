/*
Purpose: Daily job to process recurring invoices due for today
Author: HexaBill
Date: 2025
*/
using Microsoft.Extensions.Hosting;
using HexaBill.Api.Modules.Billing;

namespace HexaBill.Api.BackgroundJobs
{
    public class DailyRecurringInvoiceJob : BackgroundService
    {
        private readonly IServiceProvider _serviceProvider;
        private readonly ILogger<DailyRecurringInvoiceJob> _logger;

        public DailyRecurringInvoiceJob(IServiceProvider serviceProvider, ILogger<DailyRecurringInvoiceJob> logger)
        {
            _serviceProvider = serviceProvider;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    var now = DateTime.Now;
                    var nextRun = new DateTime(now.Year, now.Month, now.Day, 0, 5, 0);
                    if (nextRun <= now) nextRun = nextRun.AddDays(1);
                    var delay = nextRun - now;
                    _logger.LogInformation("Recurring invoice job next run: {NextRun}", nextRun);
                    await Task.Delay(delay, stoppingToken);

                    using var scope = _serviceProvider.CreateScope();
                    var service = scope.ServiceProvider.GetRequiredService<IRecurringInvoiceService>();
                    await service.ProcessDueRecurringInvoicesAsync(stoppingToken);
                }
                catch (OperationCanceledException) { break; }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error in recurring invoice job");
                    await Task.Delay(TimeSpan.FromHours(1), stoppingToken);
                }
            }
        }
    }
}
