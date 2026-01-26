# SSL Certificate Setup with Let's Encrypt

This guide explains how to set up SSL certificates for your SmartDeploy application using Let's Encrypt.

## Prerequisites

1. **Domain name** pointing to your EC2 instance's public IP
2. **Port 443 (HTTPS)** open in your AWS Security Group
3. **Port 80 (HTTP)** open in your AWS Security Group (for Let's Encrypt verification)

## Quick Setup

### Step 1: Ensure Security Group Allows HTTPS

Make sure your AWS Security Group allows inbound traffic on:
- Port 80 (HTTP) - for Let's Encrypt verification
- Port 443 (HTTPS) - for SSL traffic

### Step 2: Point Your Domain to Your Server

Update your domain's DNS A record to point to your EC2 instance's public IP:

```
Type: A
Name: @ (or your subdomain)
Value: <your-ec2-public-ip>
```

You can find your public IP by running:
```bash
curl ifconfig.me
```

### Step 3: Run SSL Setup Script

```bash
cd /opt/smartdeploy
sudo chmod +x scripts/setup-ssl.sh
sudo ./scripts/setup-ssl.sh
```

The script will:
1. Install Certbot
2. Configure Nginx for your domain
3. Obtain SSL certificate from Let's Encrypt
4. Configure automatic HTTPS redirect
5. Set up security headers

## Automatic Certificate Renewal

Let's Encrypt certificates expire every 90 days. Certbot automatically renews them, but you can:

### Test Renewal
```bash
sudo certbot renew --dry-run
```

### Manual Renewal
```bash
sudo ./scripts/renew-ssl.sh
```

### Set Up Cron Job (Automatic)
Certbot usually sets up automatic renewal, but you can verify:

```bash
# Check if renewal timer is active
sudo systemctl status certbot.timer

# Or add to crontab
sudo crontab -e
# Add this line:
0 0 * * * /opt/smartdeploy/scripts/renew-ssl.sh
```

## Verify SSL Setup

1. **Check certificate status:**
   ```bash
   sudo certbot certificates
   ```

2. **Test your site:**
   - Visit `https://yourdomain.com`
   - Check browser shows padlock icon
   - Test HTTP redirect: `http://yourdomain.com` should redirect to HTTPS

3. **Check SSL rating:**
   - Visit [SSL Labs](https://www.ssllabs.com/ssltest/) and test your domain

## Troubleshooting

### Certificate Generation Fails

**Issue:** "Failed to obtain certificate"

**Solutions:**
1. Verify DNS is pointing to your server:
   ```bash
   dig yourdomain.com
   # Should show your EC2 IP
   ```

2. Check port 80 is accessible:
   ```bash
   sudo netstat -tlnp | grep :80
   ```

3. Check security group allows port 80 from 0.0.0.0/0

4. Verify Nginx is running:
   ```bash
   sudo systemctl status nginx
   ```

### Certificate Renewal Fails

**Issue:** Auto-renewal not working

**Solutions:**
1. Check Certbot logs:
   ```bash
   sudo tail -f /var/log/letsencrypt/letsencrypt.log
   ```

2. Manually test renewal:
   ```bash
   sudo certbot renew --dry-run
   ```

3. Ensure Certbot timer is active:
   ```bash
   sudo systemctl enable certbot.timer
   sudo systemctl start certbot.timer
   ```

### Mixed Content Warnings

If you see mixed content warnings, ensure your Next.js app uses HTTPS URLs:

1. Update `NEXTAUTH_URL` in `.env`:
   ```
   NEXTAUTH_URL=https://yourdomain.com
   ```

2. Update `NEXT_PUBLIC_WS_URL`:
   ```
   NEXT_PUBLIC_WS_URL=wss://yourdomain.com
   ```

3. Restart containers:
   ```bash
   docker compose restart
   ```

## Security Headers

The SSL setup includes these security headers:
- `Strict-Transport-Security` - Forces HTTPS
- `X-Frame-Options` - Prevents clickjacking
- `X-Content-Type-Options` - Prevents MIME sniffing
- `X-XSS-Protection` - XSS protection

## Additional Resources

- [Let's Encrypt Documentation](https://letsencrypt.org/docs/)
- [Certbot Documentation](https://certbot.eff.org/)
- [Nginx SSL Configuration](https://nginx.org/en/docs/http/configuring_https_servers.html)
