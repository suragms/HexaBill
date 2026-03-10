/*
 * R2 (S3-compatible) implementation of IStorageService for tenant-isolated logo storage.
 * When R2 is configured, logos persist across Render deploys/restarts.
 * Key format: tenants/{tenantId}/logos/{guid}.png
 */
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Configuration;

namespace HexaBill.Api.Shared.Services;

public class R2StorageService : IStorageService
{
    private readonly IAmazonS3 _s3Client;
    private readonly string _bucketName;
    private readonly ILogger<R2StorageService> _logger;

    public R2StorageService(IConfiguration configuration, ILogger<R2StorageService> logger)
    {
        _logger = logger;
        var r2Endpoint = Environment.GetEnvironmentVariable("R2_ENDPOINT")
            ?? configuration["R2Settings:Endpoint"]
            ?? configuration["CloudflareR2:Endpoint"];
        var r2AccessKey = Environment.GetEnvironmentVariable("R2_ACCESS_KEY")
            ?? configuration["R2Settings:AccessKey"]
            ?? configuration["CloudflareR2:AccessKey"];
        var r2SecretKey = Environment.GetEnvironmentVariable("R2_SECRET_KEY")
            ?? configuration["R2Settings:SecretKey"]
            ?? configuration["CloudflareR2:SecretKey"];
        _bucketName = Environment.GetEnvironmentVariable("R2_BUCKET_NAME")
            ?? configuration["R2Settings:BucketName"]
            ?? configuration["CloudflareR2:BucketName"]
            ?? "hexabill-uploads";

        var config = new AmazonS3Config
        {
            ServiceURL = r2Endpoint,
            ForcePathStyle = true,
            RegionEndpoint = Amazon.RegionEndpoint.USEast1
        };
        _s3Client = new AmazonS3Client(r2AccessKey, r2SecretKey, config);
    }

    public async Task<string> UploadAsync(string key, byte[] data, string contentType)
    {
        if (string.IsNullOrWhiteSpace(key))
            throw new ArgumentException("Storage key cannot be empty.", nameof(key));
        if (!key.Replace("\\", "/").StartsWith("tenants/", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Storage key must start with tenants/{tenantId}/.", nameof(key));

        var s3Key = key.TrimStart('/').Replace("\\", "/");
        using var stream = new MemoryStream(data);
        var putRequest = new PutObjectRequest
        {
            BucketName = _bucketName,
            Key = s3Key,
            InputStream = stream,
            ContentType = contentType ?? "image/png"
        };
        await _s3Client.PutObjectAsync(putRequest);
        _logger.LogDebug("R2Storage: Uploaded key {Key}, size {Size} bytes.", s3Key, data.Length);
        return key;
    }

    public async Task<byte[]> ReadBytesAsync(string key)
    {
        if (string.IsNullOrWhiteSpace(key))
            throw new ArgumentException("Storage key cannot be empty.", nameof(key));

        var s3Key = key.TrimStart('/').Replace("\\", "/");
        try
        {
            var request = new GetObjectRequest
            {
                BucketName = _bucketName,
                Key = s3Key
            };
            using var response = await _s3Client.GetObjectAsync(request);
            using var ms = new MemoryStream();
            await response.ResponseStream.CopyToAsync(ms);
            return ms.ToArray();
        }
        catch (AmazonS3Exception ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            throw new FileNotFoundException("Storage file not found.", key, ex);
        }
    }

    public string GetPublicUrl(string key)
    {
        if (string.IsNullOrWhiteSpace(key)) return string.Empty;
        var normalized = key.TrimStart('/').Replace("\\", "/");
        return $"/api/storage/{normalized}";
    }
}
